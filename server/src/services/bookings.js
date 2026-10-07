import { pool } from '../db.js';
import { bookingShape, isValidDuration } from '../lib/booking.js';

// A booking's zones come back nested, so every screen that lists bookings can
// show what the visit actually covers without a second round trip. The lateral
// join keeps one row per booking however many zones it has.
const ITEMS_LATERAL = `
  LEFT JOIN LATERAL (
    SELECT json_agg(
             json_build_object(
               'service_id', i.service_id,
               'slug', s.slug,
               'name_en', s.name_en,
               'name_ru', s.name_ru,
               'name_hy', s.name_hy,
               'duration_minutes', i.duration_minutes,
               'price_at_booking', i.price_at_booking
             ) ORDER BY i.sort_order, i.id
           ) AS items
    FROM booking_items i
    JOIN services s ON s.id = i.service_id
    WHERE i.booking_id = b.id
  ) it ON true`;

const BOOKING_FIELDS = `b.id, b.start_time, b.end_time, b.customer_name, b.customer_phone,
       b.status, b.price_at_booking, COALESCE(it.items, '[]'::json) AS items`;

// Every booking query is for one master: `$1` is always their id, and `where`
// adds to that. `where` is trusted SQL written in the routes, never anything
// from a request; values always arrive as parameters starting at $2.
export function bookingsQuery({ where = '', orderBy = 'b.start_time ASC', extraFields = '' } = {}) {
  return `
    SELECT ${BOOKING_FIELDS}${extraFields ? `, ${extraFields}` : ''}
    FROM bookings b
    ${ITEMS_LATERAL}
    WHERE b.master_id = $1${where ? ` AND (${where})` : ''}
    ORDER BY ${orderBy}`;
}

export async function getBookingWithItems(masterId, id) {
  const { rows } = await pool.query(bookingsQuery({ where: 'b.id = $2' }), [masterId, id]);
  return rows[0] || null;
}

// The guest-notification columns ride along only here, never in the lists the
// admin panel and the phone lookup read: `guest_token` is what proves a request
// comes from the guest who booked, so it must not be handed to anyone who just
// knows a phone number.
const GUEST_FIELDS = `b.master_id, b.guest_token, b.guest_lang, b.guest_chat_id, b.guest_linked_at,
       b.guest_confirmed_at, b.created_at`;

// By the guest's secret token or by booking id, across the whole platform —
// the row carries its `master_id`. This is what lets the Telegram bot, shared
// by every master, find a booking (and so its master) from a "/start <token>"
// or a reminder's button. Callers acting for a guest page must check
// `master_id` against the page's master themselves.
export async function getBookingForGuest({ id, token }) {
  const [where, value] = token ? ['b.guest_token = $1', token] : ['b.id = $1', id];
  const { rows } = await pool.query(
    `SELECT ${BOOKING_FIELDS}, ${GUEST_FIELDS}
     FROM bookings b ${ITEMS_LATERAL}
     WHERE ${where}`,
    [value]
  );
  return rows[0] || null;
}

// Turns what a client asked for into what will actually be stored: the zones in
// the order they were chosen, each with its own duration and price, plus the
// totals the booking itself carries. Everything is priced from the database
// rather than from the request, so a client can't name its own price — and
// only from this master's own price list.
//
// `requireActive` is the difference between a guest booking (only zones on sale)
// and one the master enters themselves (anything in the price list, including
// a zone since hidden).
export async function resolveItems(masterId, rawItems, { requireActive = true } = {}) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return { error: 'missing_items' };
  }
  if (rawItems.length > 12) {
    return { error: 'too_many_items' };
  }

  const ids = rawItems.map((item) => Number(item?.serviceId));
  if (ids.some((id) => !Number.isInteger(id))) {
    return { error: 'invalid_service_id' };
  }
  if (new Set(ids).size !== ids.length) {
    return { error: 'duplicate_service' };
  }

  const { rows } = await pool.query(
    `SELECT s.id, s.duration_minutes, s.price, s.is_active, c.is_hourly
     FROM services s
     JOIN service_categories c ON c.id = s.category_id
     WHERE s.master_id = $1 AND s.id = ANY($2::int[])`,
    [masterId, ids]
  );
  const byId = new Map(rows.map((row) => [row.id, row]));

  const items = [];
  let totalMinutes = 0;
  let totalPrice = 0;

  for (const [index, raw] of rawItems.entries()) {
    const service = byId.get(Number(raw.serviceId));
    if (!service || (requireActive && !service.is_active)) {
      return { error: 'service_not_found' };
    }

    // Only an hourly zone takes a length from the client; a fixed one is as
    // long as it is, whatever the request says.
    let requested = service.duration_minutes;
    if (service.is_hourly) {
      requested = raw.durationMinutes === undefined ? 30 : Number(raw.durationMinutes);
      if (!isValidDuration(requested)) {
        return { error: 'invalid_duration' };
      }
    }

    const { durationMinutes, price } = bookingShape(service, requested);
    items.push({
      service_id: service.id,
      duration_minutes: durationMinutes,
      price_at_booking: price,
      sort_order: index + 1,
    });
    totalMinutes += durationMinutes;
    totalPrice += price;
  }

  return { items, totalMinutes, totalPrice };
}

// The booking and its zones go in together: a booking with no zones would be a
// row nothing can describe, and the overlap constraint may still reject the
// whole thing.
export async function insertBookingWithItems(
  client,
  masterId,
  {
    startTime, endTime, customerName, customerPhone, status, totalPrice, items,
    requestKey, guestToken, guestLang,
  }
) {
  const { rows } = await client.query(
    // The cast is required: without it Postgres types the parameter as text and
    // refuses to assign it to the booking_status enum column.
    `INSERT INTO bookings (master_id, start_time, end_time, customer_name, customer_phone, status,
                           price_at_booking, request_key, guest_token, guest_lang)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6::booking_status, 'confirmed'), $7, $8, $9, $10)
     RETURNING id`,
    [
      masterId, startTime, endTime, customerName, customerPhone, status ?? null, totalPrice,
      requestKey ?? null, guestToken ?? null, guestLang ?? null,
    ]
  );
  const bookingId = rows[0].id;
  await replaceItems(client, masterId, bookingId, items);
  return bookingId;
}

export async function replaceItems(client, masterId, bookingId, items) {
  await client.query('DELETE FROM booking_items WHERE booking_id = $1 AND master_id = $2', [
    bookingId,
    masterId,
  ]);
  for (const item of items) {
    await client.query(
      `INSERT INTO booking_items (booking_id, master_id, service_id, duration_minutes, price_at_booking, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [bookingId, masterId, item.service_id, item.duration_minutes, item.price_at_booking, item.sort_order]
    );
  }
}

// A name in the language asked for, or in whichever language the master did
// fill in — a master working only in Russian leaves the others blank.
export function localName(row, lang, field = 'name') {
  return (
    row?.[`${field}_${lang}`] ||
    row?.[`${field}_ru`] ||
    row?.[`${field}_en`] ||
    row?.[`${field}_hy`] ||
    ''
  );
}

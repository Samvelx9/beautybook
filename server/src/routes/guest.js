import { Router } from 'express';
import { pool } from '../db.js';
import {
  getActiveService,
  getAvailableSlots,
  isSlotWithinAvailability,
  earliestBookable,
} from '../services/availability.js';
import { localToUtc, addMinutes } from '../lib/time.js';
import {
  bookingsQuery,
  getBookingWithItems,
  getBookingForGuest,
  resolveItems,
  insertBookingWithItems,
} from '../services/bookings.js';
import { isValidDuration, MIN_BOOKING_MINUTES } from '../lib/booking.js';
import { notifyMaster } from '../services/telegram.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { cleanString, isValidDate, isValidTime } from '../lib/validate.js';
import { rateLimit } from '../lib/rateLimit.js';
import { getProfileRow, shapeProfile } from '../services/profile.js';
import { hasAccess } from '../services/masters.js';
import { resolveTenant, requireOpenPage } from '../middleware/tenant.js';
import {
  GUEST_LANGS,
  GUEST_TOKEN_PATTERN,
  calendarFileFor,
  newGuestToken,
  notifyGuest,
  telegramLinkFor,
} from '../services/guestNotifications.js';

// Everything a guest does on a master's booking page. `resolveTenant` sets
// `req.master` from the host the page is served on, and every query below is
// scoped to it.
export const guestRouter = Router();
guestRouter.use(resolveTenant);

const EXCLUSION_VIOLATION = '23P01';
const UNIQUE_VIOLATION = '23505';

const bookingLimit = rateLimit({ name: 'booking', windowMs: 10 * 60_000, max: 20 });
const lookupLimit = rateLimit({ name: 'lookup', windowMs: 10 * 60_000, max: 30 });

// The length a booking actually runs for, which for an hourly one is what the
// client chose and for a multi-zone one is the whole visit — never the sum of
// what the zones happen to cost today.
function bookedMinutes(booking) {
  return Math.round((new Date(booking.end_time) - new Date(booking.start_time)) / 60000);
}

// GET /api/site — how this master's page is set up: which languages it
// offers, its currency and timezone (for formatting), and whether it is taking
// bookings at all.
guestRouter.get('/site', (req, res) => {
  const m = req.master;
  res.json({
    slug: m.slug,
    languages: m.languages,
    defaultLang: m.default_lang,
    currency: m.currency,
    timezone: m.timezone,
    minNoticeMinutes: m.min_notice_minutes,
    open: hasAccess(m),
  });
});

// GET /api/profile — everything the landing page says about the master
guestRouter.get('/profile', asyncHandler(async (req, res) => {
  const row = await getProfileRow(req.master.id);
  if (!row) {
    return res.status(404).json({ error: 'profile_not_found' });
  }
  res.json(shapeProfile(row));
}));

// GET /api/profile/photo — the master's photo, served straight from the
// database. The landing page requests it with ?v=<photoVersion>, so a long
// cache lifetime is safe: a new upload changes the URL.
guestRouter.get('/profile/photo', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT photo_mime, photo_data, photo_updated_at FROM salon_profile WHERE master_id = $1',
    [req.master.id]
  );
  const row = rows[0];
  if (!row || !row.photo_data) {
    return res.status(404).json({ error: 'photo_not_found' });
  }

  res.set('Content-Type', row.photo_mime);
  res.set('Cache-Control', 'public, max-age=86400');
  res.set('ETag', `W/"photo-${new Date(row.photo_updated_at).getTime()}"`);
  res.set('X-Content-Type-Options', 'nosniff');
  res.send(row.photo_data);
}));

const GUEST_SERVICE_COLUMNS = `s.id, s.category_id, s.slug, s.name_en, s.name_ru, s.name_hy,
            s.duration_minutes, s.price, c.is_hourly`;

// GET /api/categories — the treatments on the landing page, each with the
// price list (zones) the guest sees after picking one.
guestRouter.get('/categories', asyncHandler(async (req, res) => {
  const { rows: categories } = await pool.query(
    `SELECT id, slug, name_en, name_ru, name_hy,
            description_en, description_ru, description_hy, is_hourly
     FROM service_categories WHERE master_id = $1 AND is_active = true
     ORDER BY sort_order, id`,
    [req.master.id]
  );

  const { rows: services } = await pool.query(
    `SELECT ${GUEST_SERVICE_COLUMNS}
     FROM services s
     JOIN service_categories c ON c.id = s.category_id
     WHERE s.master_id = $1 AND s.is_active = true ORDER BY s.sort_order, s.id`,
    [req.master.id]
  );

  const byCategory = new Map(categories.map((c) => [c.id, []]));
  for (const service of services) {
    byCategory.get(service.category_id)?.push(service);
  }

  res.json(categories.map((c) => ({ ...c, services: byCategory.get(c.id) })));
}));

// GET /api/hours — weekly opening hours, shown next to the address
guestRouter.get('/hours', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT day_of_week, is_open, start_time, end_time, lunch_start, lunch_end
     FROM weekly_hours WHERE master_id = $1 ORDER BY day_of_week`,
    [req.master.id]
  );
  res.json(rows);
}));

// GET /api/services — active services for the guest picker
guestRouter.get('/services', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT ${GUEST_SERVICE_COLUMNS}
     FROM services s
     JOIN service_categories c ON c.id = s.category_id
     WHERE s.master_id = $1 AND s.is_active = true ORDER BY s.sort_order, s.id`,
    [req.master.id]
  );
  res.json(rows);
}));

// GET /api/services/:id/slots — open slots for one zone over the next 7 days.
// ?excludeBookingId=<id> lets the reschedule picker treat that booking's
// current slot as free rather than "taken by itself".
guestRouter.get('/services/:id/slots', asyncHandler(async (req, res) => {
  const serviceId = Number(req.params.id);
  if (!Number.isInteger(serviceId)) {
    return res.status(400).json({ error: 'invalid_service_id' });
  }

  const service = await getActiveService(req.master.id, serviceId);
  if (!service) {
    return res.status(404).json({ error: 'service_not_found' });
  }

  const excludeBookingId = req.query.excludeBookingId
    ? Number(req.query.excludeBookingId)
    : undefined;

  // For an hourly zone the guest's chosen length decides which starts leave
  // enough room; for a fixed one the query is ignored.
  let durationMinutes = service.duration_minutes;
  if (service.is_hourly) {
    durationMinutes =
      req.query.durationMinutes === undefined
        ? MIN_BOOKING_MINUTES
        : Number(req.query.durationMinutes);
    if (!isValidDuration(durationMinutes)) {
      return res.status(400).json({ error: 'invalid_duration' });
    }
  }

  const days = await getAvailableSlots(req.master, { excludeBookingId, durationMinutes });
  res.json({ serviceId, days, durationMinutes });
}));

// GET /api/slots — open starts for a visit of a given length, whatever mix of
// zones makes it up.
const MAX_VISIT_MINUTES = 8 * 60;

guestRouter.get('/slots', asyncHandler(async (req, res) => {
  const durationMinutes = Number(req.query.durationMinutes);
  if (!Number.isInteger(durationMinutes) || durationMinutes < 5 || durationMinutes > MAX_VISIT_MINUTES) {
    return res.status(400).json({ error: 'invalid_duration' });
  }

  const excludeBookingId = req.query.excludeBookingId
    ? Number(req.query.excludeBookingId)
    : undefined;

  const days = await getAvailableSlots(req.master, { excludeBookingId, durationMinutes });
  res.json({ days, durationMinutes });
}));

// `guestToken` and `telegramLink` go only to the guest who just booked — they
// are what the confirmation screen's "Add to calendar" and "Get reminders in
// Telegram" buttons open. `telegramLink` is null where the bot can't take
// guests (no bot configured, or a dev machine without PUBLIC_URL).
async function createdBookingBody(booking) {
  const guest = await getBookingForGuest({ id: booking.id });
  return {
    guestToken: guest?.guest_token ?? null,
    telegramLink: await telegramLinkFor(guest?.guest_token),
    id: booking.id,
    startTime: booking.start_time,
    endTime: booking.end_time,
    status: booking.status,
    customerName: booking.customer_name,
    customerPhone: booking.customer_phone,
    priceAtBooking: booking.price_at_booking,
    items: booking.items,
  };
}

async function bookingForRequestKey(masterId, requestKey) {
  const { rows } = await pool.query(
    'SELECT id FROM bookings WHERE master_id = $1 AND request_key = $2',
    [masterId, requestKey]
  );
  return rows[0] ? getBookingWithItems(masterId, rows[0].id) : null;
}

const REQUEST_KEY_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

// POST /api/bookings — create a booking for an open slot
//
// `requestKey` is a random id the guest page makes for one set of choices. If
// the booking was saved but the answer never reached the guest (a dropped
// connection), pressing confirm again would otherwise be refused as
// `slot_taken` — by their own booking. With the key, the repeat gets back the
// booking that was already made instead.
guestRouter.post('/bookings', bookingLimit, requireOpenPage, asyncHandler(async (req, res) => {
  const master = req.master;
  const date = req.body?.date;
  const time = req.body?.time;
  const customerName = cleanString(req.body?.customerName, 100);
  const customerPhone = cleanString(req.body?.customerPhone, 30);
  const requestKey = req.body?.requestKey ?? null;
  // The language the guest is reading the site in, for their messages later.
  const guestLang = GUEST_LANGS.includes(req.body?.lang) ? req.body.lang : null;

  if (!isValidDate(date) || !isValidTime(time)) {
    return res.status(400).json({ error: 'invalid_request' });
  }
  if (!customerName || !customerPhone) {
    return res.status(400).json({ error: 'missing_customer_details' });
  }
  if (requestKey !== null && !(typeof requestKey === 'string' && REQUEST_KEY_PATTERN.test(requestKey))) {
    return res.status(400).json({ error: 'invalid_request' });
  }

  if (requestKey) {
    const existing = await bookingForRequestKey(master.id, requestKey);
    if (existing) return res.status(201).json(await createdBookingBody(existing));
  }

  // One zone or several — a single-zone booking is just a basket of one.
  const rawItems = req.body?.items ?? [{ serviceId: req.body?.serviceId, durationMinutes: req.body?.durationMinutes }];
  const resolved = await resolveItems(master.id, rawItems, { requireActive: true });
  if (resolved.error) {
    const status = resolved.error === 'service_not_found' ? 404 : 400;
    return res.status(status).json({ error: resolved.error });
  }

  const startTime = localToUtc(date, time, master.timezone);
  const endTime = addMinutes(startTime, resolved.totalMinutes);

  if (startTime < earliestBookable(master)) {
    return res.status(400).json({ error: 'too_soon', minNoticeMinutes: master.min_notice_minutes });
  }

  // A copy of this same request that got in first is what makes the slot look
  // taken, so the key is checked again before refusing.
  const slotTaken = async () => {
    const existing = requestKey && (await bookingForRequestKey(master.id, requestKey));
    if (existing) return res.status(201).json(await createdBookingBody(existing));
    return res.status(409).json({ error: 'slot_taken' });
  };

  if (!(await isSlotWithinAvailability(master, date, startTime, endTime))) {
    return slotTaken();
  }

  const client = await pool.connect();
  let bookingId;
  try {
    await client.query('BEGIN');
    bookingId = await insertBookingWithItems(client, master.id, {
      startTime,
      endTime,
      customerName,
      customerPhone,
      totalPrice: resolved.totalPrice,
      items: resolved.items,
      requestKey,
      guestToken: newGuestToken(),
      guestLang,
    });
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    // Two copies of the same request arriving together: whichever lost trips
    // the key's uniqueness or the overlap rule, and answers with the winner's
    // booking.
    if (err.code === UNIQUE_VIOLATION || err.code === EXCLUSION_VIOLATION) {
      return slotTaken();
    }
    throw err;
  } finally {
    client.release();
  }

  const booking = await getBookingWithItems(master.id, bookingId);
  res.status(201).json(await createdBookingBody(booking));

  // After answering, so the guest's confirmation never waits on Telegram.
  notifyMaster(master, {
    type: 'booking_created',
    booking,
    durationMinutes: resolved.totalMinutes,
  });
}));

const UPCOMING = `b.customer_phone = $2
       AND b.status NOT IN ('cancelled', 'completed')
       AND b.start_time > now()`;

// POST /api/bookings/lookup — all upcoming bookings for a phone number
guestRouter.post('/bookings/lookup', lookupLimit, asyncHandler(async (req, res) => {
  const phone = cleanString(req.body?.phone, 30);
  if (!phone) {
    return res.status(400).json({ error: 'missing_phone' });
  }
  const { rows } = await pool.query(bookingsQuery({ where: UPCOMING }), [req.master.id, phone]);
  res.json(rows);
}));

// The guest's token for a booking of this master, or null. A token from
// another master's booking is treated as not found.
async function guestBookingByToken(master, token) {
  if (typeof token !== 'string' || !GUEST_TOKEN_PATTERN.test(token)) return null;
  const guest = await getBookingForGuest({ token });
  return guest && guest.master_id === master.id ? guest : null;
}

// POST /api/bookings/manage — the booking a guest's Telegram link or calendar
// event points at (`?manage=<guest token>` on the site), plus every upcoming
// booking on the same phone, which is what the manage screen's back button
// shows. `booking` is null once the visit is past or cancelled, and the guest
// lands on that list instead.
guestRouter.post('/bookings/manage', lookupLimit, asyncHandler(async (req, res) => {
  const guest = await guestBookingByToken(req.master, req.body?.token);
  if (!guest) {
    return res.status(404).json({ error: 'booking_not_found' });
  }

  const { rows: upcoming } = await pool.query(bookingsQuery({ where: UPCOMING }), [
    req.master.id,
    guest.customer_phone,
  ]);

  res.json({
    booking: upcoming.find((b) => b.id === guest.id) ?? null,
    bookings: upcoming,
    phone: guest.customer_phone,
    lang: guest.guest_lang,
  });
}));

// A guest may change a booking only if they show they're its guest: the phone
// number it was booked with (what the lookup screen already asked for), or the
// booking's own secret token. A bare id proves nothing — ids are sequential.
async function bookingForGuestRequest(req) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return { status: 400, error: 'invalid_booking_id' };

  const booking = await getBookingWithItems(req.master.id, id);
  if (!booking) return { status: 404, error: 'booking_not_found' };

  const phone = cleanString(req.body?.phone, 30);
  const byPhone = phone && phone === booking.customer_phone;
  const byToken = (await guestBookingByToken(req.master, req.body?.token))?.id === id;
  if (!byPhone && !byToken) return { status: 404, error: 'booking_not_found' };
  return { booking };
}

// POST /api/bookings/:id/cancel — no cutoff, always allowed
guestRouter.post('/bookings/:id/cancel', lookupLimit, asyncHandler(async (req, res) => {
  const { booking, status, error } = await bookingForGuestRequest(req);
  if (error) return res.status(status).json({ error });
  if (booking.status === 'cancelled') {
    return res.status(409).json({ error: 'already_cancelled' });
  }

  await pool.query(
    `UPDATE bookings SET status = 'cancelled' WHERE id = $1 AND master_id = $2`,
    [booking.id, req.master.id]
  );
  res.json({ id: booking.id, status: 'cancelled' });
  notifyMaster(req.master, { type: 'booking_cancelled', booking });
  notifyGuest({ type: 'cancelled', bookingId: booking.id });
}));

// POST /api/bookings/:id/reschedule — same cutoff + slot rules as a new booking
guestRouter.post('/bookings/:id/reschedule', lookupLimit, requireOpenPage, asyncHandler(async (req, res) => {
  const master = req.master;
  const date = req.body?.date;
  const time = req.body?.time;
  if (!isValidDate(date) || !isValidTime(time)) {
    return res.status(400).json({ error: 'invalid_request' });
  }

  const { booking, status, error } = await bookingForGuestRequest(req);
  if (error) return res.status(status).json({ error });
  if (booking.status !== 'confirmed') {
    return res.status(409).json({ error: 'not_reschedulable', status: booking.status });
  }

  const startTime = localToUtc(date, time, master.timezone);
  const endTime = addMinutes(startTime, bookedMinutes(booking));

  // Already at the requested time: a repeat of a move whose answer never
  // reached the guest. It gets the same answer, without a second "moved"
  // message to the master saying the visit moved from a time to that same time.
  if (new Date(booking.start_time).getTime() === startTime.getTime()) {
    return res.json({
      id: booking.id,
      start_time: booking.start_time,
      end_time: booking.end_time,
      status: booking.status,
    });
  }

  if (startTime < earliestBookable(master)) {
    return res.status(400).json({ error: 'too_soon', minNoticeMinutes: master.min_notice_minutes });
  }

  if (!(await isSlotWithinAvailability(master, date, startTime, endTime))) {
    return res.status(409).json({ error: 'slot_taken' });
  }

  let moved;
  try {
    const { rows } = await pool.query(
      `UPDATE bookings SET start_time = $3, end_time = $4 WHERE id = $1 AND master_id = $2
       RETURNING id, start_time, end_time, status`,
      [booking.id, master.id, startTime, endTime]
    );
    moved = rows[0];
  } catch (err) {
    if (err.code === EXCLUSION_VIOLATION) {
      return res.status(409).json({ error: 'slot_taken' });
    }
    throw err;
  }

  res.json(moved);

  // `booking` still holds the pre-move row, which is where the old time comes
  // from; the zones and duration are unchanged by a reschedule.
  notifyMaster(master, {
    type: 'booking_rescheduled',
    booking: { ...booking, start_time: moved.start_time, end_time: moved.end_time },
    previousStartTime: booking.start_time,
    durationMinutes: bookedMinutes(booking),
  });
  notifyGuest({ type: 'moved', bookingId: booking.id, previousStartTime: booking.start_time });
}));

// GET /api/calendar/<guest token>.ics — the visit as a calendar event, for the
// confirmation screen's "Add to calendar". Named by the guest's secret token
// rather than the booking id, so nobody can page through other people's visits.
// Always built from the booking as it is now.
guestRouter.get('/calendar/:token.ics', asyncHandler(async (req, res) => {
  const booking = await guestBookingByToken(req.master, req.params.token);
  if (!booking || booking.status === 'cancelled') {
    return res.status(404).json({ error: 'booking_not_found' });
  }

  res.set('Content-Type', 'text/calendar; charset=utf-8');
  res.set('Content-Disposition', 'inline; filename="visit.ics"');
  res.set('Cache-Control', 'no-store');
  res.send(await calendarFileFor(req.master, booking));
}));

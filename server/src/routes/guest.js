import { Router } from 'express';
import { pool } from '../db.js';
import {
  getActiveService,
  getAvailableSlots,
  isSlotWithinAvailability,
  earliestBookable,
  lastBookableDate,
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
import { RECENT_BOOKINGS_SQL } from '../lib/popularity.js';
import {
  getProfilePhoto,
  getProfileRow,
  masterProfile,
  salonProfile,
  shapeProfile,
} from '../services/profile.js';
import { getMasterById, hasAccess, masterSiteUrl } from '../services/masters.js';
import { resolveTenant, requireOpenPage } from '../middleware/tenant.js';
import {
  GUEST_LANGS,
  GUEST_TOKEN_PATTERN,
  calendarFileFor,
  newGuestToken,
  notifyGuest,
  telegramLinkFor,
} from '../services/guestNotifications.js';

// Everything a guest does on a booking page. `resolveTenant` sets `req.master`
// from the host the page is served on — a master's page, or a salon's with a
// master picked — and every query below is scoped to it. On a salon's page
// with no master picked, `salonPage` (at the end of this file) answers what
// is about the salon as a whole; booking and changing a visit work out the
// master themselves.
export const guestRouter = Router();
guestRouter.use(resolveTenant);
const salonPage = Router();
guestRouter.use(salonPage);

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
    kind: 'master',
    slug: m.slug,
    languages: m.languages,
    defaultLang: m.default_lang,
    currency: m.currency,
    timezone: m.timezone,
    minNoticeMinutes: m.min_notice_minutes,
    bookingWindowDays: m.booking_window_days,
    open: hasAccess(m),
  });
});

// GET /api/profile — everything the landing page says about the master
guestRouter.get('/profile', asyncHandler(async (req, res) => {
  const row = await getProfileRow(masterProfile(req.master.id));
  if (!row) {
    return res.status(404).json({ error: 'profile_not_found' });
  }
  res.json(shapeProfile(row));
}));

// GET /api/profile/photo — the master's photo, served straight from the
// database. The landing page requests it with ?v=<photoVersion>, so a long
// cache lifetime is safe: a new upload changes the URL.
guestRouter.get('/profile/photo', asyncHandler(async (req, res) => {
  sendPhoto(res, await getProfilePhoto(masterProfile(req.master.id)));
}));

function sendPhoto(res, row) {
  if (!row) return res.status(404).json({ error: 'photo_not_found' });
  res.set('Content-Type', row.photo_mime);
  res.set('Cache-Control', 'public, max-age=86400');
  res.set('ETag', `W/"photo-${new Date(row.photo_updated_at).getTime()}"`);
  res.set('X-Content-Type-Options', 'nosniff');
  return res.send(row.photo_data);
}

const GUEST_SERVICE_COLUMNS = `s.id, s.category_id, s.slug, s.name_en, s.name_ru, s.name_hy,
            s.duration_minutes, s.price, c.is_hourly`;

// GET /api/categories — the treatments on the landing page, each with the
// price list (zones) the guest sees after picking one: the salon's shared
// list, narrowed to what this master performs. Zones come most-booked first,
// so the ones most guests are after sit at the top; the price-list order
// breaks ties and places zones nobody has booked lately. A treatment with zones on sale
// that this master does none of isn't theirs to show.
guestRouter.get('/categories', asyncHandler(async (req, res) => {
  const { rows: categories } = await pool.query(
    `SELECT id, slug, name_en, name_ru, name_hy,
            description_en, description_ru, description_hy, is_hourly
     FROM service_categories WHERE organization_id = $1 AND is_active = true
     ORDER BY sort_order, id`,
    [req.master.organization_id]
  );

  const { rows: services } = await pool.query(
    `SELECT ${GUEST_SERVICE_COLUMNS},
            EXISTS (SELECT 1 FROM master_services ms
                     WHERE ms.master_id = $2 AND ms.service_id = s.id) AS performed
     FROM services s
     JOIN service_categories c ON c.id = s.category_id
     LEFT JOIN (${RECENT_BOOKINGS_SQL}) pop ON pop.service_id = s.id
     WHERE s.organization_id = $1 AND s.is_active = true
     ORDER BY COALESCE(pop.recent_bookings, 0) DESC, s.sort_order, s.id`,
    [req.master.organization_id, req.master.id]
  );

  const byCategory = new Map(categories.map((c) => [c.id, { onSale: 0, services: [] }]));
  for (const { performed, ...service } of services) {
    const entry = byCategory.get(service.category_id);
    if (!entry) continue;
    entry.onSale += 1;
    if (performed) entry.services.push(service);
  }

  res.json(
    categories
      .filter((c) => byCategory.get(c.id).onSale === 0 || byCategory.get(c.id).services.length > 0)
      .map((c) => ({ ...c, services: byCategory.get(c.id).services }))
  );
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
     JOIN master_services ms ON ms.service_id = s.id AND ms.master_id = $2
     LEFT JOIN (${RECENT_BOOKINGS_SQL}) pop ON pop.service_id = s.id
     WHERE s.organization_id = $1 AND s.is_active = true
     ORDER BY COALESCE(pop.recent_bookings, 0) DESC, s.sort_order, s.id`,
    [req.master.organization_id, req.master.id]
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

  const service = await getActiveService(req.master, serviceId);
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
    // Who the visit is with — on a salon's page, possibly chosen by the salon.
    masterId: guest?.master_id ?? null,
  };
}

// The booking a request key was already used for, anywhere in the
// organization — on a salon's page the guest doesn't know which master a
// "whichever is free" booking went to.
async function bookingForRequestKey(organizationId, requestKey) {
  const { rows } = await pool.query(
    'SELECT id, master_id FROM bookings WHERE organization_id = $1 AND request_key = $2',
    [organizationId, requestKey]
  );
  return rows[0] ? getBookingWithItems(rows[0].master_id, rows[0].id) : null;
}

const REQUEST_KEY_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

// One attempt at booking `master`: their price list, their notice and window,
// their hours, days off and other bookings. Returns { bookingId, minutes } or
// { status, error, ...details }.
async function bookWith(master, { date, time, customerName, customerPhone, rawItems, requestKey, guestLang }) {
  const resolved = await resolveItems(master, rawItems, { requireActive: true });
  if (resolved.error) {
    return { status: resolved.error === 'service_not_found' ? 404 : 400, error: resolved.error };
  }

  const startTime = localToUtc(date, time, master.timezone);
  const endTime = addMinutes(startTime, resolved.totalMinutes);

  if (startTime < earliestBookable(master)) {
    return { status: 400, error: 'too_soon', minNoticeMinutes: master.min_notice_minutes };
  }
  // The page only offers days inside the window, but the API is open to
  // anyone — so the window is enforced here, not just in the picker.
  if (date > lastBookableDate(master)) {
    return { status: 400, error: 'too_far', bookingWindowDays: master.booking_window_days };
  }
  if (!(await isSlotWithinAvailability(master, date, startTime, endTime))) {
    return { status: 409, error: 'slot_taken' };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const bookingId = await insertBookingWithItems(client, master, {
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
    return { bookingId, minutes: resolved.totalMinutes };
  } catch (err) {
    await client.query('ROLLBACK');
    // Someone else got the slot first, or a copy of this same request did
    // (the key's uniqueness): the caller tells the two apart.
    if (err.code === UNIQUE_VIOLATION || err.code === EXCLUSION_VIOLATION) {
      return { status: 409, error: 'slot_taken' };
    }
    throw err;
  } finally {
    client.release();
  }
}

// On a salon's page with no master chosen: the salon's working masters who
// perform every one of these services, the least booked that day first, so
// "whichever master is free" spreads the work.
async function mastersFor(salon, serviceIds, date) {
  const { rows } = await pool.query(
    `SELECT m.id
     FROM masters m
     WHERE m.organization_id = $1 AND m.deactivated_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM unnest($2::int[]) AS wanted(service_id)
         WHERE NOT EXISTS (SELECT 1 FROM master_services ms
                            WHERE ms.master_id = m.id AND ms.service_id = wanted.service_id))
     ORDER BY (SELECT COUNT(*) FROM bookings b
                WHERE b.master_id = m.id AND b.status <> 'cancelled'
                  AND (b.start_time AT TIME ZONE m.timezone)::date = $3::date),
              m.id`,
    [salon.id, serviceIds, date ?? '1970-01-01']
  );
  const masters = [];
  for (const { id } of rows) masters.push(await getMasterById(id));
  return masters;
}

// POST /api/bookings — create a booking for an open slot
//
// On a master's page (or a salon's, with ?master=<id>), with that master. On a
// salon's page without one, with whichever master who performs everything
// chosen is free then — tried least busy first.
//
// `requestKey` is a random id the guest page makes for one set of choices. If
// the booking was saved but the answer never reached the guest (a dropped
// connection), pressing confirm again would otherwise be refused as
// `slot_taken` — by their own booking. With the key, the repeat gets back the
// booking that was already made instead.
guestRouter.post('/bookings', bookingLimit, requireOpenPage, asyncHandler(async (req, res) => {
  const organizationId = req.master?.organization_id ?? req.salon.id;
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

  const existingFor = async () => requestKey && (await bookingForRequestKey(organizationId, requestKey));
  const already = await existingFor();
  if (already) return res.status(201).json(await createdBookingBody(already));

  // One zone or several — a single-zone booking is just a basket of one.
  const rawItems = req.body?.items ?? [{ serviceId: req.body?.serviceId, durationMinutes: req.body?.durationMinutes }];
  const input = { date, time, customerName, customerPhone, rawItems, requestKey, guestLang };

  let candidates;
  if (req.master) {
    candidates = [req.master];
  } else {
    const serviceIds = Array.isArray(rawItems) ? rawItems.map((item) => Number(item?.serviceId)) : [];
    if (serviceIds.length === 0 || serviceIds.some((id) => !Number.isInteger(id))) {
      return res.status(400).json({ error: 'invalid_service_id' });
    }
    candidates = await mastersFor(req.salon, serviceIds, date);
    if (candidates.length === 0) return res.status(404).json({ error: 'service_not_found' });
  }

  // With one master, their answer is the answer. With several, a master who's
  // busy or too soon is passed over; the guest hears "taken" unless every one
  // of them said the same other thing.
  let master = null;
  let result = null;
  const refusals = [];
  for (const candidate of candidates) {
    result = await bookWith(candidate, input);
    if (result.bookingId) {
      master = candidate;
      break;
    }
    refusals.push(result);
    if (!['slot_taken', 'too_soon', 'too_far'].includes(result.error)) break;
  }

  if (!master) {
    // A copy of this same request that got in first is what makes the slot
    // look taken, so the key is checked again before refusing.
    const existing = await existingFor();
    if (existing) return res.status(201).json(await createdBookingBody(existing));
    const { status, ...body } =
      refusals.length > 1 && !refusals.every((r) => r.error === refusals[0].error)
        ? { status: 409, error: 'slot_taken' }
        : refusals[0];
    return res.status(status).json(body);
  }

  const booking = await getBookingWithItems(master.id, result.bookingId);
  res.status(201).json(await createdBookingBody(booking));

  // After answering, so the guest's confirmation never waits on Telegram.
  notifyMaster(master, {
    type: 'booking_created',
    booking,
    durationMinutes: result.minutes,
  });
}));

const UPCOMING = `b.customer_phone = $2
       AND b.status NOT IN ('cancelled', 'completed')
       AND b.start_time > now()`;

// A phone's upcoming visits on this page: with this master, or on a salon's
// page with any of its masters — each carrying its `master_id`.
function upcomingFor(req, phone) {
  const [scope, id] = req.master ? ['master', req.master.id] : ['organization', req.salon.id];
  return pool
    .query(bookingsQuery({ where: UPCOMING, scope, extraFields: 'b.master_id' }), [id, phone])
    .then((r) => r.rows);
}

// POST /api/bookings/lookup — all upcoming bookings for a phone number
guestRouter.post('/bookings/lookup', lookupLimit, asyncHandler(async (req, res) => {
  const phone = cleanString(req.body?.phone, 30);
  if (!phone) {
    return res.status(400).json({ error: 'missing_phone' });
  }
  res.json(await upcomingFor(req, phone));
}));

// The guest's token for a booking on this page — this master's, or on a
// salon's page any of its masters' — or null. A token from another page's
// booking is treated as not found.
async function guestBookingByToken(req, token) {
  if (typeof token !== 'string' || !GUEST_TOKEN_PATTERN.test(token)) return null;
  const guest = await getBookingForGuest({ token });
  if (!guest) return null;
  const ours = req.master ? guest.master_id === req.master.id : guest.organization_id === req.salon.id;
  return ours ? guest : null;
}

// POST /api/bookings/manage — the booking a guest's Telegram link or calendar
// event points at (`?manage=<guest token>` on the site), plus every upcoming
// booking on the same phone, which is what the manage screen's back button
// shows. `booking` is null once the visit is past or cancelled, and the guest
// lands on that list instead.
guestRouter.post('/bookings/manage', lookupLimit, asyncHandler(async (req, res) => {
  const guest = await guestBookingByToken(req, req.body?.token);
  if (!guest) {
    return res.status(404).json({ error: 'booking_not_found' });
  }

  const upcoming = await upcomingFor(req, guest.customer_phone);

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
  const byToken = (await guestBookingByToken(req, req.body?.token))?.id === id;
  if (!byPhone && !byToken) return { status: 404, error: 'booking_not_found' };
  return { booking };
}

// On a salon's page a guest changes a visit without naming its master: the
// visit's own master, if it is one of this salon's, is the page's master from
// here on.
guestRouter.use('/bookings/:id', asyncHandler(async (req, res, next) => {
  if (req.master) return next();
  const id = Number(req.params.id);
  const { rows } = Number.isInteger(id)
    ? await pool.query('SELECT master_id FROM bookings WHERE id = $1 AND organization_id = $2', [id, req.salon.id])
    : { rows: [] };
  if (!rows[0]) return res.status(404).json({ error: 'booking_not_found' });
  req.master = await getMasterById(rows[0].master_id);
  next();
}));

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
  // The page only offers days inside the window, but the API is open to
  // anyone — so the window is enforced here, not just in the picker.
  if (date > lastBookableDate(master)) {
    return res.status(400).json({ error: 'too_far', bookingWindowDays: master.booking_window_days });
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
  const booking = await guestBookingByToken(req, req.params.token);
  if (!booking || booking.status === 'cancelled') {
    return res.status(404).json({ error: 'booking_not_found' });
  }
  const master = req.master ?? (await getMasterById(booking.master_id));

  res.set('Content-Type', 'text/calendar; charset=utf-8');
  res.set('Content-Disposition', 'inline; filename="visit.ics"');
  res.set('Cache-Control', 'no-store');
  res.send(await calendarFileFor(master, booking));
}));

// ---------------------------------------------------------------------------
// A salon's page, before the guest picks a master
// ---------------------------------------------------------------------------

// Only on a salon's page with no master picked; anything else carries on to
// the routes above.
salonPage.use((req, res, next) => (req.salon && !req.master ? next() : next('router')));

// The salon's working masters, with what the page shows of each.
async function salonMasters(salon) {
  const { rows } = await pool.query(
    `SELECT m.id, m.slug, m.custom_domain, m.custom_domain_status, m.min_notice_minutes, m.booking_window_days,
            p.owner_name_en, p.owner_name_ru, p.owner_name_hy, p.photo_updated_at
     FROM masters m
     LEFT JOIN salon_profile p ON p.master_id = m.id
     WHERE m.organization_id = $1 AND m.deactivated_at IS NULL
     ORDER BY m.created_at, m.id`,
    [salon.id]
  );
  return rows;
}

// GET /api/site — the salon's page: its locale, whether it takes bookings,
// and its masters. A guest may book any of them, or whichever is free.
salonPage.get('/site', asyncHandler(async (req, res) => {
  const o = req.salon;
  const masters = await salonMasters(o);
  res.json({
    kind: 'salon',
    slug: o.slug,
    name: o.name,
    languages: o.languages,
    defaultLang: o.default_lang,
    currency: o.currency,
    timezone: o.timezone,
    // The loosest of the masters', so the page offers whatever one of them can take.
    minNoticeMinutes: Math.min(...masters.map((m) => m.min_notice_minutes), 24 * 60),
    bookingWindowDays: Math.max(...masters.map((m) => m.booking_window_days), 7),
    open: hasAccess(o) && masters.length > 0,
    masters: masters.map((m) => ({
      id: m.id,
      slug: m.slug,
      name_en: m.owner_name_en ?? '',
      name_ru: m.owner_name_ru ?? '',
      name_hy: m.owner_name_hy ?? '',
      siteUrl: masterSiteUrl(m),
      photoVersion: m.photo_updated_at ? new Date(m.photo_updated_at).getTime() : null,
    })),
  });
}));

// GET /api/profile — the salon's landing page.
salonPage.get('/profile', asyncHandler(async (req, res) => {
  const row = await getProfileRow(salonProfile(req.salon.id));
  if (!row) return res.status(404).json({ error: 'profile_not_found' });
  res.json(shapeProfile(row));
}));

salonPage.get('/profile/photo', asyncHandler(async (req, res) => {
  sendPhoto(res, await getProfilePhoto(salonProfile(req.salon.id)));
}));

// The salon's services that at least one working master performs, each with
// the masters who do (`masterIds`) — what the page needs to offer "any master"
// or to narrow the masters to those who do everything in the basket.
async function salonServices(salon) {
  const { rows } = await pool.query(
    `SELECT ${GUEST_SERVICE_COLUMNS},
            array_agg(m.id ORDER BY m.created_at, m.id) AS master_ids
     FROM services s
     JOIN service_categories c ON c.id = s.category_id
     JOIN master_services ms ON ms.service_id = s.id
     JOIN masters m ON m.id = ms.master_id AND m.deactivated_at IS NULL
     LEFT JOIN (${RECENT_BOOKINGS_SQL}) pop ON pop.service_id = s.id
     WHERE s.organization_id = $1 AND s.is_active = true
     GROUP BY s.id, c.is_hourly, pop.recent_bookings
     ORDER BY COALESCE(pop.recent_bookings, 0) DESC, s.sort_order, s.id`,
    [salon.id]
  );
  return rows.map(({ master_ids: masterIds, ...service }) => ({ ...service, masterIds }));
}

// GET /api/categories — the salon's treatments, with the zones its masters perform.
salonPage.get('/categories', asyncHandler(async (req, res) => {
  const { rows: categories } = await pool.query(
    `SELECT id, slug, name_en, name_ru, name_hy,
            description_en, description_ru, description_hy, is_hourly
     FROM service_categories WHERE organization_id = $1 AND is_active = true
     ORDER BY sort_order, id`,
    [req.salon.id]
  );
  const services = await salonServices(req.salon);
  res.json(
    categories
      .map((c) => ({ ...c, services: services.filter((s) => s.category_id === c.id) }))
      .filter((c) => c.services.length > 0)
  );
}));

salonPage.get('/services', asyncHandler(async (req, res) => {
  res.json(await salonServices(req.salon));
}));

// GET /api/hours — when the salon is open: on each weekday, from its earliest
// master's start to its latest master's finish.
salonPage.get('/hours', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT h.day_of_week, bool_or(h.is_open) AS is_open,
            MIN(h.start_time) FILTER (WHERE h.is_open) AS start_time,
            MAX(h.end_time) FILTER (WHERE h.is_open) AS end_time,
            NULL::time AS lunch_start, NULL::time AS lunch_end
     FROM weekly_hours h
     JOIN masters m ON m.id = h.master_id AND m.deactivated_at IS NULL
     WHERE m.organization_id = $1
     GROUP BY h.day_of_week
     ORDER BY h.day_of_week`,
    [req.salon.id]
  );
  res.json(rows);
}));

salonPage.get('/services/:id/slots', (req, res) => {
  res.status(400).json({ error: 'master_required' });
});

// GET /api/slots?durationMinutes=&serviceIds=1,2 — "whichever master is
// free": a start is open when at least one working master who performs every
// chosen service has it open. A start nobody can take shows the reason the
// first of them gave.
salonPage.get('/slots', asyncHandler(async (req, res) => {
  const durationMinutes = Number(req.query.durationMinutes);
  if (!Number.isInteger(durationMinutes) || durationMinutes < 5 || durationMinutes > MAX_VISIT_MINUTES) {
    return res.status(400).json({ error: 'invalid_duration' });
  }
  const serviceIds = String(req.query.serviceIds ?? '').split(',').filter(Boolean).map(Number);
  if (serviceIds.length === 0 || serviceIds.length > 12 || serviceIds.some((id) => !Number.isInteger(id))) {
    return res.status(400).json({ error: 'invalid_service_id' });
  }

  const byDate = new Map();
  for (const master of await mastersFor(req.salon, serviceIds)) {
    for (const day of await getAvailableSlots(master, { durationMinutes })) {
      const entry = byDate.get(day.date) ?? { open: new Set(), reasons: new Map() };
      for (const time of day.slots) entry.open.add(time);
      for (const { time, reason } of day.unavailable) {
        if (!entry.reasons.has(time)) entry.reasons.set(time, reason);
      }
      byDate.set(day.date, entry);
    }
  }

  const days = [...byDate.keys()].sort().map((date) => {
    const { open, reasons } = byDate.get(date);
    return {
      date,
      slots: [...open].sort(),
      unavailable: [...reasons]
        .filter(([time]) => !open.has(time))
        .map(([time, reason]) => ({ time, reason }))
        .sort((a, b) => a.time.localeCompare(b.time)),
    };
  });
  res.json({ days, durationMinutes });
}));


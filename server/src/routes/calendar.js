import { Router, raw } from 'express';
import { pool } from '../db.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { cleanString, isValidDate, isValidTime } from '../lib/validate.js';
import { todayDateStr, addDaysToDateStr, localToUtc, splitLocalDateTime } from '../lib/time.js';
import {
  bookingsQuery,
  getBookingWithItems,
  resolveItems,
  insertBookingWithItems,
  replaceItems,
} from '../services/bookings.js';
import {
  PROFILE_TEXT_COLUMNS,
  getProfileRow,
  shapeProfile,
  maxLengthFor,
  toCamel,
} from '../services/profile.js';
import { notifyGuest } from '../services/guestNotifications.js';
import { getMasterById } from '../services/masters.js';
import { BOOKING_WINDOW_CHOICES, MIN_NOTICE_CHOICES } from '../services/availability.js';

// One master's calendar: their landing page, working hours, days off and
// bookings. Mounted twice — at /api/admin for a login's own calendar, and at
// /api/salon/masters/:masterId for a salon owner managing any of their
// masters. Whoever mounts it has already set `req.master` to the calendar the
// request may touch, and every query below is scoped to `req.master.id`; an
// id in a URL or body only ever names a row *within* that master's data.
export const calendarRouter = Router({ mergeParams: true });

const CHECK_VIOLATION = '23514';
const EXCLUSION_VIOLATION = '23P01';
const BOOKING_STATUSES = ['confirmed', 'completed', 'cancelled', 'no_show'];
const PHOTO_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const idParam = (req) => {
  const id = Number(req.params.id);
  return Number.isInteger(id) ? id : null;
};

// ---------------------------------------------------------------------------
// Profile (the guest landing page's content)
// ---------------------------------------------------------------------------

calendarRouter.get('/profile', asyncHandler(async (req, res) => {
  const row = await getProfileRow(req.master.id);
  if (!row) return res.status(404).json({ error: 'profile_not_found' });
  res.json(shapeProfile(row));
}));

// Every field is optional and may legitimately be blank — this is free-form
// copy, not validated business data — so a field simply omitted from the body
// keeps its current value, and one sent empty is cleared.
calendarRouter.put('/profile', asyncHandler(async (req, res) => {
  const assignments = [];
  const values = [];

  for (const column of PROFILE_TEXT_COLUMNS) {
    const sent = req.body?.[toCamel(column)];
    if (sent === undefined) continue;
    values.push(cleanString(sent, maxLengthFor(column)));
    assignments.push(`${column} = $${values.length}`);
  }

  if (assignments.length === 0) {
    return res.status(400).json({ error: 'no_fields_to_update' });
  }

  assignments.push('updated_at = now()');
  values.push(req.master.id);
  await pool.query(
    `UPDATE salon_profile SET ${assignments.join(', ')} WHERE master_id = $${values.length}`,
    values
  );

  res.json(shapeProfile(await getProfileRow(req.master.id)));
}));

// The image arrives as a raw body with its own Content-Type rather than as
// multipart — one file, no other fields.
calendarRouter.put(
  '/profile/photo',
  raw({ type: PHOTO_MIME_TYPES, limit: '4mb' }),
  asyncHandler(async (req, res) => {
    const mime = req.get('content-type');
    if (!Buffer.isBuffer(req.body) || req.body.length === 0 || !PHOTO_MIME_TYPES.includes(mime)) {
      return res.status(400).json({ error: 'invalid_image', accepts: PHOTO_MIME_TYPES });
    }

    await pool.query(
      `UPDATE salon_profile
       SET photo_mime = $1, photo_data = $2, photo_updated_at = now(), updated_at = now()
       WHERE master_id = $3`,
      [mime, req.body, req.master.id]
    );

    res.json(shapeProfile(await getProfileRow(req.master.id)));
  })
);

calendarRouter.delete('/profile/photo', asyncHandler(async (req, res) => {
  await pool.query(
    `UPDATE salon_profile
     SET photo_mime = NULL, photo_data = NULL, photo_updated_at = NULL, updated_at = now()
     WHERE master_id = $1`,
    [req.master.id]
  );
  res.json(shapeProfile(await getProfileRow(req.master.id)));
}));

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

const WEEKLY_COLUMNS = 'day_of_week, is_open, start_time, end_time, lunch_start, lunch_end';

// Shared by the single-day and whole-week endpoints: a day is either closed
// (times cleared) or open with a start before its end, optionally with a lunch
// break that has to sit inside those hours. Returns { error } or { values }.
function readWeeklyDay(body, dayOfWeek) {
  const isOpen = Boolean(body?.isOpen);
  if (!isOpen) return { values: [dayOfWeek, false, null, null, null, null] };

  const startTime = body?.startTime;
  const endTime = body?.endTime;
  if (!isValidTime(startTime) || !isValidTime(endTime) || startTime >= endTime) {
    return { error: 'invalid_hours' };
  }

  const hasLunch = Boolean(body?.hasLunch ?? (body?.lunchStart && body?.lunchEnd));
  if (!hasLunch) return { values: [dayOfWeek, true, startTime, endTime, null, null] };

  const lunchStart = body?.lunchStart;
  const lunchEnd = body?.lunchEnd;
  if (!isValidTime(lunchStart) || !isValidTime(lunchEnd) || lunchStart >= lunchEnd) {
    return { error: 'invalid_lunch' };
  }
  if (lunchStart < startTime || lunchEnd > endTime) {
    return { error: 'lunch_outside_hours' };
  }
  return { values: [dayOfWeek, true, startTime, endTime, lunchStart, lunchEnd] };
}

async function weeklyHours(masterId) {
  const { rows } = await pool.query(
    `SELECT ${WEEKLY_COLUMNS} FROM weekly_hours WHERE master_id = $1 ORDER BY day_of_week`,
    [masterId]
  );
  return rows;
}

// Each day is upserted, so a master whose week was somehow never seeded still
// ends up with one.
const UPSERT_DAY = `INSERT INTO weekly_hours
    (master_id, day_of_week, is_open, start_time, end_time, lunch_start, lunch_end)
  VALUES ($1, $2, $3, $4, $5, $6, $7)
  ON CONFLICT (master_id, day_of_week) DO UPDATE SET
    is_open = EXCLUDED.is_open, start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time,
    lunch_start = EXCLUDED.lunch_start, lunch_end = EXCLUDED.lunch_end
  RETURNING ${WEEKLY_COLUMNS}`;

calendarRouter.get('/availability/weekly', asyncHandler(async (req, res) => {
  res.json(await weeklyHours(req.master.id));
}));

// The admin screen edits the whole week at once behind a single Save, so the
// seven rows go up together and land in one transaction.
calendarRouter.put('/availability/weekly', asyncHandler(async (req, res) => {
  const days = req.body?.days;
  if (!Array.isArray(days) || days.length === 0) {
    return res.status(400).json({ error: 'missing_days' });
  }

  const updates = [];
  const seen = new Set();
  for (const day of days) {
    const dayOfWeek = Number(day?.dayOfWeek);
    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6 || seen.has(dayOfWeek)) {
      return res.status(400).json({ error: 'invalid_day_of_week' });
    }
    seen.add(dayOfWeek);

    const parsed = readWeeklyDay(day, dayOfWeek);
    if (parsed.error) return res.status(400).json({ error: parsed.error, dayOfWeek });
    updates.push(parsed.values);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const values of updates) {
      await client.query(UPSERT_DAY, [req.master.id, ...values]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  res.json(await weeklyHours(req.master.id));
}));

calendarRouter.put('/availability/weekly/:dayOfWeek', asyncHandler(async (req, res) => {
  const dayOfWeek = Number(req.params.dayOfWeek);
  if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
    return res.status(400).json({ error: 'invalid_day_of_week' });
  }
  const parsed = readWeeklyDay(req.body, dayOfWeek);
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  const { rows } = await pool.query(UPSERT_DAY, [req.master.id, ...parsed.values]);
  res.json(rows[0]);
}));

calendarRouter.get('/availability/blocks', asyncHandler(async (req, res) => {
  const from = isValidDate(req.query.from) ? req.query.from : todayDateStr(req.master.timezone);
  const to = isValidDate(req.query.to) ? req.query.to : addDaysToDateStr(from, 365);

  const { rows } = await pool.query(
    `SELECT id, date, start_time, end_time, note FROM availability_blocks
     WHERE master_id = $1 AND date BETWEEN $2 AND $3 ORDER BY date, start_time NULLS FIRST`,
    [req.master.id, from, to]
  );
  res.json(rows);
}));

calendarRouter.post('/availability/blocks', asyncHandler(async (req, res) => {
  const date = req.body?.date;
  const startTime = req.body?.startTime ?? null;
  const endTime = req.body?.endTime ?? null;
  const note = cleanString(req.body?.note, 300) || null;

  if (!isValidDate(date)) return res.status(400).json({ error: 'invalid_date' });
  if ((startTime === null) !== (endTime === null)) {
    return res.status(400).json({ error: 'provide_both_times_or_neither' });
  }
  if (startTime !== null && (!isValidTime(startTime) || !isValidTime(endTime) || startTime >= endTime)) {
    return res.status(400).json({ error: 'invalid_times' });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO availability_blocks (master_id, date, start_time, end_time, note)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, date, start_time, end_time, note`,
      [req.master.id, date, startTime, endTime, note]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === CHECK_VIOLATION) return res.status(400).json({ error: 'invalid_times' });
    throw err;
  }
}));

calendarRouter.delete('/availability/blocks/:id', asyncHandler(async (req, res) => {
  const id = idParam(req);
  if (id === null) return res.status(400).json({ error: 'invalid_block_id' });

  const { rowCount } = await pool.query(
    'DELETE FROM availability_blocks WHERE id = $1 AND master_id = $2',
    [id, req.master.id]
  );
  if (rowCount === 0) return res.status(404).json({ error: 'block_not_found' });
  res.status(204).end();
}));

// How far ahead guests must book at the least, and may book at the most —
// the calendar's own, so a salon's owner sets them for each master too.
calendarRouter.get('/availability/settings', (req, res) => {
  res.json({
    minNoticeMinutes: req.master.min_notice_minutes,
    bookingWindowDays: req.master.booking_window_days,
  });
});

calendarRouter.patch('/availability/settings', asyncHandler(async (req, res) => {
  const fields = [];
  const values = [];
  const set = (column, value) => {
    values.push(value);
    fields.push(`${column} = $${values.length}`);
  };
  if (req.body?.minNoticeMinutes !== undefined) {
    const minutes = Number(req.body.minNoticeMinutes);
    if (!MIN_NOTICE_CHOICES.includes(minutes)) return res.status(400).json({ error: 'invalid_min_notice' });
    set('min_notice_minutes', minutes);
  }
  if (req.body?.bookingWindowDays !== undefined) {
    const days = Number(req.body.bookingWindowDays);
    if (!BOOKING_WINDOW_CHOICES.includes(days)) return res.status(400).json({ error: 'invalid_booking_window' });
    set('booking_window_days', days);
  }
  if (fields.length === 0) return res.status(400).json({ error: 'no_fields_to_update' });

  values.push(req.master.id);
  const { rows } = await pool.query(
    `UPDATE masters SET ${fields.join(', ')} WHERE id = $${values.length}
     RETURNING min_notice_minutes, booking_window_days`,
    values
  );
  res.json({ minNoticeMinutes: rows[0].min_notice_minutes, bookingWindowDays: rows[0].booking_window_days });
}));

// ---------------------------------------------------------------------------
// Bookings
// ---------------------------------------------------------------------------

calendarRouter.get('/bookings', asyncHandler(async (req, res) => {
  const tz = req.master.timezone;
  const today = todayDateStr(tz);
  const from = isValidDate(req.query.from) ? req.query.from : addDaysToDateStr(today, -30);
  const to = isValidDate(req.query.to) ? req.query.to : addDaysToDateStr(today, 60);
  const status = req.query.status;

  if (status && !BOOKING_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'invalid_status' });
  }

  const params = [req.master.id, localToUtc(from, '00:00', tz), localToUtc(addDaysToDateStr(to, 1), '00:00', tz)];
  let where = 'b.start_time >= $2 AND b.start_time < $3';
  if (status) {
    params.push(status);
    where += ' AND b.status = $4';
  }

  const { rows } = await pool.query(bookingsQuery({ where }), params);
  res.json(rows);
}));

// A booking the master takes themselves — over the phone, or a walk-in written
// down after the fact. Deliberately looser than the guest flow: no cutoff and
// no opening-hours check, because a master is allowed to squeeze someone in
// early, late, or on a day off. The one rule that still holds is the overlap
// constraint, enforced by the database. Allowed even after the trial ends:
// the master's records are theirs.
calendarRouter.post('/bookings', asyncHandler(async (req, res) => {
  const master = req.master;
  const date = req.body?.date;
  const time = req.body?.time;
  const customerName = cleanString(req.body?.customerName, 100);
  const customerPhone = cleanString(req.body?.customerPhone, 30);
  const status = req.body?.status ?? 'confirmed';

  if (!isValidDate(date) || !isValidTime(time)) {
    return res.status(400).json({ error: 'invalid_request' });
  }
  if (!customerName || !customerPhone) {
    return res.status(400).json({ error: 'missing_customer_details' });
  }
  if (!BOOKING_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'invalid_status' });
  }

  // A master may book a zone they've since hidden — the price list moving on
  // shouldn't stop them recording what they actually did.
  const rawItems = req.body?.items ?? [{ serviceId: req.body?.serviceId, durationMinutes: req.body?.durationMinutes }];
  const resolved = await resolveItems(master, rawItems, { requireActive: false });
  if (resolved.error) {
    const httpStatus = resolved.error === 'service_not_found' ? 404 : 400;
    return res.status(httpStatus).json({ error: resolved.error });
  }

  const startTime = localToUtc(date, time, master.timezone);
  const endTime = new Date(startTime.getTime() + resolved.totalMinutes * 60_000);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const bookingId = await insertBookingWithItems(client, master, {
      startTime,
      endTime,
      customerName,
      customerPhone,
      status,
      totalPrice: resolved.totalPrice,
      items: resolved.items,
    });
    await client.query('COMMIT');
    res.status(201).json(await getBookingWithItems(master.id, bookingId));
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === EXCLUSION_VIOLATION) return res.status(409).json({ error: 'slot_taken' });
    throw err;
  } finally {
    client.release();
  }
}));

// Editing a booking that already exists. Same latitude as creating one by
// hand: no opening-hours or cutoff check, but the database still refuses an
// overlap. Every field is optional; whatever is left out keeps its value.
calendarRouter.patch('/bookings/:id', asyncHandler(async (req, res) => {
  const master = req.master;
  const id = idParam(req);
  if (id === null) return res.status(400).json({ error: 'invalid_booking_id' });

  const existing = await getBookingWithItems(master.id, id);
  if (!existing) return res.status(404).json({ error: 'booking_not_found' });

  const fields = [];
  const values = [];
  const set = (column, value) => {
    values.push(value);
    fields.push(`${column} = $${values.length}`);
  };

  if (req.body?.customerName !== undefined) {
    const name = cleanString(req.body.customerName, 100);
    if (!name) return res.status(400).json({ error: 'missing_customer_details' });
    set('customer_name', name);
  }
  if (req.body?.customerPhone !== undefined) {
    const phone = cleanString(req.body.customerPhone, 30);
    if (!phone) return res.status(400).json({ error: 'missing_customer_details' });
    set('customer_phone', phone);
  }
  if (req.body?.status !== undefined) {
    if (!BOOKING_STATUSES.includes(req.body.status)) {
      return res.status(400).json({ error: 'invalid_status' });
    }
    set('status', req.body.status);
  }

  // A salon's owner may hand the visit to another of the salon's masters
  // (`masterId`). The database still refuses it if that master is busy then.
  let target = master;
  if (req.body?.masterId !== undefined && Number(req.body.masterId) !== master.id) {
    if (req.user.role !== 'owner') return res.status(403).json({ error: 'not_owner' });
    const targetId = Number(req.body.masterId);
    target = Number.isInteger(targetId) ? await getMasterById(targetId) : null;
    if (!target || target.organization_id !== master.organization_id || target.deactivated_at) {
      return res.status(400).json({ error: 'invalid_master' });
    }
    set('master_id', target.id);
  }

  // Zones and time interact: changing the zones changes how long the visit
  // runs, so the end time is always recomputed from whichever of the two the
  // request touched.
  let resolved = null;
  if (req.body?.items !== undefined) {
    resolved = await resolveItems(master, req.body.items, { requireActive: false });
    if (resolved.error) {
      const httpStatus = resolved.error === 'service_not_found' ? 404 : 400;
      return res.status(httpStatus).json({ error: resolved.error });
    }
    set('price_at_booking', resolved.totalPrice);
  }

  const movingTime = req.body?.date !== undefined || req.body?.time !== undefined;
  if (movingTime || resolved) {
    const { dateStr, timeStr } = splitLocalDateTime(existing.start_time, master.timezone);
    const date = req.body?.date ?? dateStr;
    const time = req.body?.time ?? timeStr;
    if (!isValidDate(date) || !isValidTime(time)) {
      return res.status(400).json({ error: 'invalid_request' });
    }
    const minutes =
      resolved?.totalMinutes ??
      Math.round((new Date(existing.end_time) - new Date(existing.start_time)) / 60000);
    const startTime = localToUtc(date, time, master.timezone);
    set('start_time', startTime);
    set('end_time', new Date(startTime.getTime() + minutes * 60_000));
  }

  if (fields.length === 0) return res.status(400).json({ error: 'no_fields_to_update' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    values.push(id, master.id);
    await client.query(
      `UPDATE bookings SET ${fields.join(', ')}
       WHERE id = $${values.length - 1} AND master_id = $${values.length}`,
      values
    );
    if (resolved) await replaceItems(client, target, id, resolved.items);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === EXCLUSION_VIOLATION) return res.status(409).json({ error: 'slot_taken' });
    throw err;
  } finally {
    client.release();
  }

  const updated = await getBookingWithItems(target.id, id);
  res.json(updated);
  tellGuestAboutChange(existing, updated);
}));

// A guest who turned on Telegram reminders hears when the master moves or
// cancels their visit. Marking a visit completed or a no-show, or changing its
// zones, isn't news to them.
function tellGuestAboutChange(before, after) {
  if (!after) return;
  if (after.status === 'cancelled' && before.status !== 'cancelled') {
    notifyGuest({ type: 'cancelled', bookingId: after.id });
  } else if (
    after.status === 'confirmed' &&
    new Date(after.start_time).getTime() !== new Date(before.start_time).getTime()
  ) {
    notifyGuest({ type: 'moved', bookingId: after.id, previousStartTime: before.start_time });
  }
}

// Bulk delete, for clearing out cancelled bookings. Only cancelled rows can go:
// a confirmed booking is a commitment and a completed one is a line in the
// financial history.
calendarRouter.delete('/bookings', asyncHandler(async (req, res) => {
  const ids = req.body?.ids;
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'missing_ids' });
  if (ids.length > 500) return res.status(400).json({ error: 'too_many_ids' });
  const numericIds = ids.map(Number);
  if (numericIds.some((id) => !Number.isInteger(id))) {
    return res.status(400).json({ error: 'invalid_booking_id' });
  }

  const { rows } = await pool.query(
    `DELETE FROM bookings WHERE master_id = $1 AND id = ANY($2::int[]) AND status = 'cancelled'
     RETURNING id`,
    [req.master.id, numericIds]
  );

  const deleted = new Set(rows.map((r) => r.id));
  res.json({ deleted: deleted.size, skipped: numericIds.filter((id) => !deleted.has(id)) });
}));

calendarRouter.patch('/bookings/:id/status', asyncHandler(async (req, res) => {
  const id = idParam(req);
  const status = req.body?.status;
  if (id === null) return res.status(400).json({ error: 'invalid_booking_id' });
  if (!BOOKING_STATUSES.includes(status)) return res.status(400).json({ error: 'invalid_status' });

  const { rows: previous } = await pool.query(
    'SELECT status FROM bookings WHERE id = $1 AND master_id = $2',
    [id, req.master.id]
  );
  const { rows } = await pool.query(
    `UPDATE bookings SET status = $3 WHERE id = $1 AND master_id = $2
     RETURNING id, status, start_time, end_time`,
    [id, req.master.id, status]
  );

  if (!rows[0]) return res.status(404).json({ error: 'booking_not_found' });
  res.json(rows[0]);
  if (previous[0]) tellGuestAboutChange({ ...rows[0], status: previous[0].status }, rows[0]);
}));


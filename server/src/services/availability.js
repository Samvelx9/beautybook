import { pool } from '../db.js';
import {
  todayDateStr,
  addDaysToDateStr,
  dayOfWeek,
  localToUtc,
  utcToLocalTimeStr,
  addMinutes,
} from '../lib/time.js';

export const DAYS_AHEAD = 7;
export const SLOT_INTERVAL_MINUTES = 30;

// The minimum notice a master asks for (masters.min_notice_minutes), as the
// earliest instant a guest may book from right now.
export const MIN_NOTICE_CHOICES = [0, 15, 30, 45, 60, 90, 120, 180, 240, 360, 720, 1440, 2880];
export function earliestBookable(master, now = new Date()) {
  return addMinutes(now, master.min_notice_minutes ?? 90);
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

// Checks a single candidate [startUtc, endUtc) against the master's weekly
// hours and date-specific blocks — the same rules getAvailableSlots uses to
// build the slot list, but for one specific slot. Used to validate
// create/reschedule requests, since the EXCLUDE constraint only guards against
// double-booking, not against booking outside business hours or into a
// blocked window.
export async function isSlotWithinAvailability(master, date, startUtc, endUtc) {
  const tz = master.timezone;
  const { rows: hoursRows } = await pool.query(
    `SELECT is_open, start_time, end_time, lunch_start, lunch_end FROM weekly_hours
     WHERE master_id = $1 AND day_of_week = $2`,
    [master.id, dayOfWeek(date)]
  );
  const hours = hoursRows[0];
  if (!hours || !hours.is_open) return false;

  const dayStart = localToUtc(date, hours.start_time, tz);
  const dayEnd = localToUtc(date, hours.end_time, tz);
  if (startUtc < dayStart || endUtc > dayEnd) return false;

  // The lunch break closes the middle of the day exactly like a block does.
  if (hours.lunch_start) {
    const lunchStart = localToUtc(date, hours.lunch_start, tz);
    const lunchEnd = localToUtc(date, hours.lunch_end, tz);
    if (overlaps(startUtc, endUtc, lunchStart, lunchEnd)) return false;
  }

  const { rows: blocks } = await pool.query(
    'SELECT start_time, end_time FROM availability_blocks WHERE master_id = $1 AND date = $2',
    [master.id, date]
  );
  for (const b of blocks) {
    if (b.start_time === null && b.end_time === null) return false;
    const blockStart = localToUtc(date, b.start_time, tz);
    const blockEnd = localToUtc(date, b.end_time, tz);
    if (overlaps(startUtc, endUtc, blockStart, blockEnd)) return false;
  }

  return true;
}

// `is_hourly` comes from the zone's treatment: it decides whether the row's
// price is a flat price or an hourly rate, so every caller that prices or
// times a booking needs it alongside the service itself.
export async function getActiveService(masterId, serviceId) {
  const { rows } = await pool.query(
    `SELECT s.id, s.slug, s.name_en, s.name_ru, s.name_hy, s.duration_minutes,
            s.price, c.is_hourly
     FROM services s
     JOIN service_categories c ON c.id = s.category_id
     WHERE s.master_id = $1 AND s.id = $2 AND s.is_active = true`,
    [masterId, serviceId]
  );
  return rows[0] || null;
}

// Computes open slots over the next DAYS_AHEAD days of the master's own
// calendar, from availability (weekly hours minus date-specific blocks) minus
// existing non-cancelled bookings minus the cutoff window. Always queried
// fresh (no caching) to keep the double-booking race window small.
//
// Each day also carries `unavailable`: the times on the same grid that can't be
// taken, and why. The picker shows those greyed out rather than dropping them,
// so a guest can see that 15:00 exists and is spoken for — a list that silently
// skips from 14:30 to 16:00 reads like a glitch.
export async function getAvailableSlots(master, { excludeBookingId, durationMinutes }) {
  const tz = master.timezone;
  const startDate = todayDateStr(tz);
  const endDate = addDaysToDateStr(startDate, DAYS_AHEAD - 1);
  const rangeStartUtc = localToUtc(startDate, '00:00', tz);
  const rangeEndUtc = localToUtc(addDaysToDateStr(endDate, 1), '00:00', tz);
  const cutoffInstant = earliestBookable(master);

  const { rows: weeklyHours } = await pool.query(
    `SELECT day_of_week, is_open, start_time, end_time, lunch_start, lunch_end
     FROM weekly_hours WHERE master_id = $1`,
    [master.id]
  );
  const hoursByDow = new Map(weeklyHours.map((h) => [h.day_of_week, h]));

  const { rows: blocks } = await pool.query(
    `SELECT date, start_time, end_time FROM availability_blocks
     WHERE master_id = $1 AND date BETWEEN $2 AND $3`,
    [master.id, startDate, endDate]
  );
  const blocksByDate = new Map();
  for (const b of blocks) {
    if (!blocksByDate.has(b.date)) blocksByDate.set(b.date, []);
    blocksByDate.get(b.date).push(b);
  }

  const bookingParams = [master.id, rangeStartUtc, rangeEndUtc];
  let bookingQuery = `SELECT start_time, end_time FROM bookings
     WHERE master_id = $1 AND status <> 'cancelled' AND start_time < $3 AND end_time > $2`;
  if (excludeBookingId) {
    bookingParams.push(excludeBookingId);
    bookingQuery += ` AND id <> $4`;
  }
  const { rows: existingBookings } = await pool.query(bookingQuery, bookingParams);

  const days = [];
  for (let i = 0; i < DAYS_AHEAD; i += 1) {
    const date = addDaysToDateStr(startDate, i);
    const hours = hoursByDow.get(dayOfWeek(date));
    const slots = [];
    const unavailable = [];

    if (hours && hours.is_open) {
      const dayBlocks = blocksByDate.get(date) || [];
      const fullyBlocked = dayBlocks.some((b) => b.start_time === null && b.end_time === null);

      if (!fullyBlocked) {
        const partialBlocks = dayBlocks
          .filter((b) => b.start_time !== null)
          .map((b) => [localToUtc(date, b.start_time, tz), localToUtc(date, b.end_time, tz)]);

        // The weekday's lunch break behaves as one more blocked window.
        if (hours.lunch_start) {
          partialBlocks.push([
            localToUtc(date, hours.lunch_start, tz),
            localToUtc(date, hours.lunch_end, tz),
          ]);
        }

        const dayStart = localToUtc(date, hours.start_time, tz);
        const dayEnd = localToUtc(date, hours.end_time, tz);

        // Walks every start on the grid, not only the ones that fit: a start
        // that doesn't work is reported with its reason instead of vanishing.
        for (
          let slotStart = dayStart;
          slotStart < dayEnd;
          slotStart = addMinutes(slotStart, SLOT_INTERVAL_MINUTES)
        ) {
          const slotEnd = addMinutes(slotStart, durationMinutes);
          const time = utcToLocalTimeStr(slotStart, tz);

          if (slotStart < cutoffInstant) {
            unavailable.push({ time, reason: 'past' });
          } else if (slotEnd > dayEnd) {
            // Would run past closing — true of every later start too, but the
            // guest still needs to see the times exist.
            unavailable.push({ time, reason: 'closing' });
          } else if (partialBlocks.some(([bs, be]) => overlaps(slotStart, slotEnd, bs, be))) {
            unavailable.push({ time, reason: 'blocked' });
          } else if (
            existingBookings.some((b) => overlaps(slotStart, slotEnd, b.start_time, b.end_time))
          ) {
            unavailable.push({ time, reason: 'booked' });
          } else {
            slots.push(time);
          }
        }
      }
    }

    days.push({ date, slots, unavailable });
  }

  return days;
}

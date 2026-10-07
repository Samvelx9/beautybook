// Every master works in their own timezone (masters.timezone, an IANA name such
// as "Asia/Yerevan" or "Europe/Moscow"). Bookings are stored as UTC instants;
// working hours, blocks and the dates a guest picks are wall-clock times in
// that zone. These helpers convert between the two with Intl, which knows each
// zone's offsets and daylight-saving rules, so no timezone library is needed.
//
// `shared/time.js` holds the client-side half; the backend can't import it
// (its Docker image is built from `server/` alone).

export const DEFAULT_TIMEZONE = 'Asia/Yerevan';

const formatters = new Map();
function partsFormatter(tz) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(tz, f);
  }
  return f;
}

export function isValidTimeZone(tz) {
  if (typeof tz !== 'string' || !tz) return false;
  try {
    partsFormatter(tz);
    return true;
  } catch {
    return false;
  }
}

// The wall-clock reading in `tz` at `instant`, as numbers.
function wallClock(instant, tz) {
  const out = {};
  for (const { type, value } of partsFormatter(tz).formatToParts(new Date(instant))) {
    if (type !== 'literal') out[type] = Number(value);
  }
  return out;
}

// Minutes `tz` is ahead of UTC at `instant`.
function offsetMinutes(instant, tz) {
  const w = wallClock(instant, tz);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return Math.round((asUtc - Math.floor(new Date(instant).getTime() / 1000) * 1000) / 60000);
}

const pad = (n) => String(n).padStart(2, '0');

// A wall-clock instant shifted so its UTC fields read as local time — handy
// for date arithmetic on the local calendar.
export function nowLocal(tz) {
  return new Date(Date.now() + offsetMinutes(Date.now(), tz) * 60000);
}

export function todayDateStr(tz) {
  return nowLocal(tz).toISOString().slice(0, 10);
}

export function addDaysToDateStr(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function dayOfWeek(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

// A local date + "HH:MM" in `tz` → the UTC instant it names. Guessing with the
// offset at the naive instant and correcting once handles daylight-saving
// changes; a time that doesn't exist (skipped by a spring-forward) lands just
// after the gap.
export function localToUtc(dateStr, timeStr, tz) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  const naive = Date.UTC(y, m - 1, d, hh, mm);
  const first = offsetMinutes(naive, tz);
  let utc = naive - first * 60000;
  const second = offsetMinutes(utc, tz);
  if (second !== first) utc = naive - second * 60000;
  return new Date(utc);
}

export function utcToLocalTimeStr(instant, tz) {
  const w = wallClock(instant, tz);
  return `${pad(w.hour)}:${pad(w.minute)}`;
}

// The local calendar date and wall-clock time an instant falls on in `tz`.
export function splitLocalDateTime(instant, tz) {
  const w = wallClock(instant, tz);
  return {
    dateStr: `${w.year}-${pad(w.month)}-${pad(w.day)}`,
    timeStr: `${pad(w.hour)}:${pad(w.minute)}`,
  };
}

// Day, month (0-based), weekday and time of an instant in `tz`, for messages.
export function localParts(instant, tz) {
  const { dateStr, timeStr } = splitLocalDateTime(instant, tz);
  const [y, m, d] = dateStr.split('-').map(Number);
  return { day: d, month: m - 1, year: y, weekday: dayOfWeek(dateStr), time: timeStr };
}

// "05.10.2026 14:30" — the format of the master's Telegram notifications.
export function formatLocalDateTime(instant, tz) {
  const p = localParts(instant, tz);
  return `${pad(p.day)}.${pad(p.month + 1)}.${p.year} ${p.time}`;
}

export function localHour(instant, tz) {
  return wallClock(instant, tz).hour;
}

export function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60000);
}

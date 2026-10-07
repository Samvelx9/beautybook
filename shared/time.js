// Bookings come from the API as UTC instants; they're shown in the master's
// own timezone (masters.timezone), whatever timezone the viewer's device is
// in. Each app calls setTimeZone() once it knows whose page or panel it is.
// The server keeps the matching half in server/src/lib/time.js.
let timeZone = 'Asia/Yerevan';

export function setTimeZone(tz) {
  if (typeof tz === 'string' && tz) timeZone = tz;
}

export function getTimeZone() {
  return timeZone;
}

const formatters = new Map();
function partsOf(instant) {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  const out = {};
  for (const { type, value } of f.formatToParts(new Date(instant))) {
    if (type !== 'literal') out[type] = Number(value);
  }
  return out;
}

const pad = (n) => String(n).padStart(2, '0');

// An instant → the master's calendar date (as a browser-local-midnight Date,
// safe for getDay()/getDate() whatever the viewer's own timezone) and
// wall-clock time.
export function splitLocalDateTime(isoString) {
  const p = partsOf(isoString);
  return {
    dateObj: new Date(p.year, p.month - 1, p.day),
    time: `${pad(p.hour)}:${pad(p.minute)}`,
  };
}

// Today's date in the master's timezone, as 'YYYY-MM-DD'.
export function todayLocalStr() {
  const p = partsOf(Date.now());
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

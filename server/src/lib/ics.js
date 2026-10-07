// A minimal iCalendar (RFC 5545) file for one visit — what the guest's "Add to
// calendar" button downloads. Phones open a `text/calendar` response straight
// into their calendar app, and the alarms below make the phone itself remind
// the guest, whether or not they also turned on Telegram reminders. (Google
// Calendar ignores alarms in an imported file and uses its own default.)

function escapeText(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

function utcStamp(date) {
  return new Date(date).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

// Lines longer than 75 octets must be folded, and the zone names and address
// are often Armenian or Russian — two bytes a letter — so the split is counted
// in bytes and never lands inside a character.
function fold(line) {
  const parts = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const size = Buffer.byteLength(ch);
    const limit = parts.length === 0 ? 75 : 74; // continuation lines start with a space
    if (bytes + size > limit) {
      parts.push(current);
      current = '';
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

export function buildIcs({ prodId = 'beautybook', uid, start, end, summary, description, location, url, alarms = [] }) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//${prodId}//booking//EN`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${utcStamp(new Date())}`,
    `DTSTART:${utcStamp(start)}`,
    `DTEND:${utcStamp(end)}`,
    `SUMMARY:${escapeText(summary)}`,
  ];
  if (description) lines.push(`DESCRIPTION:${escapeText(description)}`);
  if (location) lines.push(`LOCATION:${escapeText(location)}`);
  if (url) lines.push(`URL:${url}`);
  for (const alarm of alarms) {
    lines.push(
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `TRIGGER:${alarm.trigger}`,
      `DESCRIPTION:${escapeText(summary)}`,
      'END:VALARM'
    );
  }
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

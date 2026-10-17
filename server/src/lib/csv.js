// CSV the way spreadsheets read it: comma-separated, every field quoted when
// it holds a comma, quote or line break, lines ending CRLF, and a byte-order
// mark first so Excel opens Armenian and Cyrillic text as UTF-8. A field that
// starts like a formula (= + - @) is prefixed with an apostrophe, so a client
// named "=HYPERLINK(...)" stays text in whoever opens the file.
function field(value) {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header, rows) {
  return '﻿' + [header, ...rows].map((row) => row.map(field).join(',')).join('\r\n') + '\r\n';
}

export function sendCsv(res, filename, header, rows) {
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${filename}"`);
  res.set('Cache-Control', 'no-store');
  res.send(toCsv(header, rows));
}

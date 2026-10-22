import { splitLocalDateTime, todayLocalStr } from 'salon-shared/time';
import { localName } from '../i18n.js';
import { MasterDot, masterColor, masterTint } from '../masterColors.jsx';

// One day as a timeline, a column per master side by side: bookings are blocks
// in the master's colour, and the time a master isn't working (outside their
// hours, their lunch, a day off or a blocked stretch) is hatched — so free
// gaps and who could take a walk-in show at a glance. Clicking a booking opens
// it; clicking free time in a column starts a booking for that master then.
//
// `columns`: [{ id, name, color, hours, blocks }] — `hours` the weekly_hours
// row for this weekday (null while loading), `blocks` that day's
// availability_blocks. `bookings` carry `master_id` when there are several.

const PX_PER_MIN = 1.2;
const SNAP_MIN = 15;
const toMin = (t) => {
  const [h, m] = String(t).slice(0, 5).split(':').map(Number);
  return h * 60 + m;
};
const toTime = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

// Start and end of a booking in minutes after midnight, in the calendar's
// timezone. A visit running past midnight is cut at the end of the day.
function span(booking, date) {
  const start = splitLocalDateTime(booking.start_time);
  const end = splitLocalDateTime(booking.end_time);
  const endKey = `${end.dateObj.getFullYear()}-${String(end.dateObj.getMonth() + 1).padStart(2, '0')}-${String(end.dateObj.getDate()).padStart(2, '0')}`;
  return { start: toMin(start.time), end: endKey === date ? toMin(end.time) : 24 * 60 };
}

// The stretches of the day a master isn't taking bookings.
function closedStretches(hours, blocks, from, to) {
  if (!hours) return [];
  if (!hours.is_open || blocks.some((b) => b.start_time === null)) return [[from, to]];
  const out = [[from, toMin(hours.start_time)], [toMin(hours.end_time), to]];
  if (hours.lunch_start) out.push([toMin(hours.lunch_start), toMin(hours.lunch_end)]);
  for (const b of blocks) out.push([toMin(b.start_time), toMin(b.end_time)]);
  return out.map(([a, b]) => [Math.max(a, from), Math.min(b, to)]).filter(([a, b]) => b > a);
}

const HATCH = 'repeating-linear-gradient(135deg, var(--line) 0 2px, transparent 2px 8px)';

export default function DayTimeline({ T, lang, date, columns, bookings, onPickBooking, onPickSlot }) {
  const spans = new Map(bookings.map((b) => [b.id, span(b, date)]));

  // The axis covers everyone's working hours and every booking, on whole
  // hours; an empty day off still shows a normal working day's frame.
  const edges = [];
  for (const c of columns) {
    if (c.hours?.is_open) edges.push(toMin(c.hours.start_time), toMin(c.hours.end_time));
  }
  for (const s of spans.values()) edges.push(s.start, s.end);
  const from = edges.length ? Math.floor(Math.min(...edges) / 60) * 60 : 9 * 60;
  const to = edges.length ? Math.min(24 * 60, Math.ceil(Math.max(...edges) / 60) * 60) : 19 * 60;
  const height = (to - from) * PX_PER_MIN;
  const hourMarks = [];
  for (let m = from; m <= to; m += 60) hourMarks.push(m);

  const isToday = date === todayLocalStr();
  const nowMin = isToday ? toMin(splitLocalDateTime(new Date().toISOString()).time) : null;

  function pickSlot(event, column) {
    if (!onPickSlot) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const minute = from + Math.floor((event.clientY - rect.top) / PX_PER_MIN / SNAP_MIN) * SNAP_MIN;
    onPickSlot(column.id, toTime(Math.min(Math.max(minute, from), to - SNAP_MIN)));
  }

  return (
    <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `44px repeat(${columns.length}, minmax(150px, 1fr))`,
          minWidth: 44 + columns.length * 150,
        }}
      >
        {/* Header: who each column is, and how many visits they have. */}
        <span style={{ borderBottom: '1px solid var(--line)' }} />
        {columns.map((c) => {
          const count = bookings.filter((b) => columns.length === 1 || b.master_id === c.id).length;
          return (
            <div
              key={c.id ?? 'own'}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                padding: '10px 10px 8px',
                borderBottom: `3px solid ${masterColor(c.color)}`,
                borderLeft: '1px solid var(--line)',
                minWidth: 0,
              }}
            >
              <MasterDot color={c.color} />
              <span style={{ fontSize: 13.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {c.name}
              </span>
              <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 'auto' }}>{count}</span>
            </div>
          );
        })}

        {/* The hour gutter. */}
        <div style={{ position: 'relative', height }}>
          {hourMarks.map((m) => (
            <span
              key={m}
              style={{
                position: 'absolute',
                // Just under its hour line, so the first one clears the header.
                top: (m - from) * PX_PER_MIN + 2,
                right: 6,
                fontSize: 11,
                color: 'var(--muted)',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {m < to ? toTime(m) : ''}
            </span>
          ))}
        </div>

        {columns.map((c) => {
          const own = bookings.filter((b) => columns.length === 1 || b.master_id === c.id);
          return (
            <div
              key={c.id ?? 'own'}
              onClick={(e) => pickSlot(e, c)}
              title={onPickSlot ? T.timelineAddHint : undefined}
              style={{
                position: 'relative',
                height,
                borderLeft: '1px solid var(--line)',
                cursor: onPickSlot ? 'copy' : 'default',
                backgroundImage: `repeating-linear-gradient(to bottom, var(--line) 0 1px, transparent 1px ${60 * PX_PER_MIN}px)`,
              }}
            >
              {closedStretches(c.hours, c.blocks ?? [], from, to).map(([a, b], i) => (
                <div
                  key={i}
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    top: (a - from) * PX_PER_MIN,
                    height: (b - a) * PX_PER_MIN,
                    backgroundImage: HATCH,
                    backgroundColor: 'var(--bg)',
                    opacity: 0.8,
                  }}
                />
              ))}
              {own.map((b) => {
                const s = spans.get(b.id);
                const zones = (b.items ?? []).map((z) => localName(z, lang)).join(' · ');
                const label = `${toTime(s.start)}–${toTime(s.end)} · ${b.customer_name} · ${zones}`;
                return (
                  <button
                    key={b.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      onPickBooking(b);
                    }}
                    title={label}
                    aria-label={label}
                    style={{
                      position: 'absolute',
                      left: 4,
                      right: 4,
                      top: (s.start - from) * PX_PER_MIN + 1,
                      height: Math.max((s.end - s.start) * PX_PER_MIN - 2, 20),
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'flex-start',
                      gap: 1,
                      padding: '3px 7px',
                      overflow: 'hidden',
                      textAlign: 'left',
                      borderRadius: 7,
                      background: masterTint(c.color),
                      borderLeft: `4px solid ${masterColor(c.color)}`,
                      // A no-show keeps its place, faded; it still held the time.
                      opacity: b.status === 'no_show' ? 0.55 : 1,
                      cursor: 'pointer',
                      color: 'var(--ink)',
                    }}
                  >
                    <span style={{ fontSize: 11.5, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                      {toTime(s.start)}–{toTime(s.end)}
                      {b.status === 'completed' && ' ✓'}
                      {b.status === 'no_show' && ` · ${T.statusNoShow}`}
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>{b.customer_name}</span>
                    <span style={{ fontSize: 11.5, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{zones}</span>
                  </button>
                );
              })}
              {nowMin !== null && nowMin >= from && nowMin <= to && (
                <div
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    top: (nowMin - from) * PX_PER_MIN,
                    borderTop: '2px solid var(--terracotta)',
                    pointerEvents: 'none',
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { splitLocalDateTime, todayLocalStr } from 'salon-shared/time';
import { dayLabel, localName } from '../i18n.js';
import { MasterDot, masterColor, masterTint } from '../masterColors.jsx';

// One day as a timeline, a column per master side by side: bookings are blocks
// in the master's colour, and the time a master isn't working (outside their
// hours, their lunch, a day off or a blocked stretch) is hatched — so free
// gaps and who could take a walk-in show at a glance. Clicking a booking opens
// it; clicking free time in a column starts a booking for that master then.
//
// A confirmed booking can be dragged to another time, or to another master's
// column (`onMoveBooking`). While it's dragged, only the columns of masters
// who can take it (`canTake`: they perform everything in it) stay live; the
// rest are dimmed and refuse the drop, and so does a spot that would overlap
// another booking. A press that barely moves is still a click. To move it to
// another day, a strip of days appears while dragging: holding the booking
// over one (`onChangeDay`) turns the timeline to that day, and the drag goes on.
//
// `columns`: [{ id, name, color, hours, blocks }] — `hours` the weekly_hours
// row for this weekday (null while loading), `blocks` that day's
// availability_blocks. `bookings` carry `master_id` when there are several.

const PX_PER_MIN = 1.2;
const SNAP_MIN = 15;
const DRAG_THRESHOLD_PX = 5;
const DAY_HOVER_MS = 450;
const addDays = (dateStr, n) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
};
const columnKey = (c) => c.id ?? 'own';
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

export default function DayTimeline({ T, lang, date, columns, bookings, onPickBooking, onPickSlot, onMoveBooking, canTake, onChangeDay, hint }) {
  const spans = new Map(bookings.map((b) => [b.id, span(b, date)]));
  const columnEls = useRef(new Map());
  const scroller = useRef(null);
  // The drag under way: the booking, where it was grabbed, which columns may
  // take it, and once it has really moved, where it would land.
  // Kept in a ref as well, so pointer events arriving before the next render
  // still see the latest state.
  const [drag, setDragState] = useState(null);
  const dragRef = useRef(null);
  const setDrag = (next) => {
    dragRef.current = next;
    setDragState(next);
  };
  // A drag ends with a click; that click mustn't open a form. It comes straight
  // after the pointer is released, so the flag only lives until then.
  const justDragged = useRef(false);
  // The day chips shown while dragging, and the one being held over.
  const dayChips = useRef(new Map());
  const dayHover = useRef(null);
  const stopDayHover = () => {
    clearTimeout(dayHover.current?.timer);
    dayHover.current = null;
  };
  const inColumn = (c) => (b) => columns.length === 1 || b.master_id === c.id;

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
    if (!onPickSlot || justDragged.current) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const minute = from + Math.floor((event.clientY - rect.top) / PX_PER_MIN / SNAP_MIN) * SNAP_MIN;
    onPickSlot(column.id, toTime(Math.min(Math.max(minute, from), to - SNAP_MIN)));
  }

  function startDrag(event, booking, column) {
    if (!onMoveBooking || booking.status !== 'confirmed' || event.button > 0) return;
    const rect = columnEls.current.get(columnKey(column)).getBoundingClientRect();
    const s = spans.get(booking.id);
    // Keeps the moves coming to this block wherever the pointer goes. Can fail
    // for a pointer the browser no longer tracks; the drag works without it
    // while the pointer stays over the block's column.
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* not capturable */
    }
    setDrag({
      booking,
      // Where it was: compared at the drop, whatever day is on screen by then.
      originDate: date,
      originStart: s.start,
      length: s.end - s.start,
      grabMin: (event.clientY - rect.top) / PX_PER_MIN + from - s.start,
      x: event.clientX,
      y: event.clientY,
      live: new Set(columns.filter((c) => canTake(booking, c.id)).map(columnKey)),
      moved: false,
      target: null,
    });
  }

  function moveDrag(event) {
    const drag = dragRef.current;
    if (!drag) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < DRAG_THRESHOLD_PX) return;
    // Over a day chip: after a moment there, that day comes up.
    const chip = [...dayChips.current].find(([, el]) => {
      const r = el.getBoundingClientRect();
      return event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom;
    })?.[0];
    if (chip) {
      if (dayHover.current?.date !== chip) {
        stopDayHover();
        dayHover.current = chip === date ? { date: chip } : { date: chip, timer: setTimeout(() => onChangeDay(chip), DAY_HOVER_MS) };
      }
      setDrag({ ...drag, moved: true, target: null });
      return;
    }
    stopDayHover();
    // Near either edge of a timeline wider than the screen, it scrolls, so a
    // master whose column is out of view can still be reached.
    const box = scroller.current?.getBoundingClientRect();
    if (box) {
      if (event.clientX > box.right - 40) scroller.current.scrollLeft += 24;
      else if (event.clientX < box.left + 84) scroller.current.scrollLeft -= 24;
    }
    // The column under the pointer, or the nearest one past either edge.
    let column = null;
    let best = Infinity;
    for (const c of columns) {
      const rect = columnEls.current.get(columnKey(c))?.getBoundingClientRect();
      if (!rect) continue;
      const distance = event.clientX < rect.left ? rect.left - event.clientX : event.clientX > rect.right ? event.clientX - rect.right : 0;
      if (distance < best) {
        best = distance;
        column = { c, rect };
      }
    }
    if (!column) return;
    const raw = (event.clientY - column.rect.top) / PX_PER_MIN + from - drag.grabMin;
    const start = Math.min(Math.max(Math.round(raw / SNAP_MIN) * SNAP_MIN, from), to - Math.min(drag.length, to - from));
    const end = start + drag.length;
    const key = columnKey(column.c);
    const clash = bookings.some((b) => {
      if (b.id === drag.booking.id || !inColumn(column.c)(b)) return false;
      const o = spans.get(b.id);
      return o.start < end && start < o.end;
    });
    // Why a spot refuses the drop, said on the ghost: not this master's work,
    // or the time is taken.
    const refusal = !drag.live.has(key) ? 'dropNotTheirs' : clash ? 'dropNotHere' : null;
    setDrag({ ...drag, moved: true, target: { column: column.c, key, start, ok: !refusal, refusal } });
  }

  function endDrag() {
    const drag = dragRef.current;
    if (!drag) return;
    stopDayHover();
    const { booking, moved, target } = drag;
    setDrag(null);
    if (!moved) return;
    justDragged.current = true;
    setTimeout(() => {
      justDragged.current = false;
    }, 0);
    const sameColumn = columns.length === 1 || target?.column.id === booking.master_id;
    if (target?.ok && (date !== drag.originDate || target.start !== drag.originStart || !sameColumn)) {
      onMoveBooking(booking, { masterId: target.column.id, time: toTime(target.start), date });
    }
  }

  // While a booking is held, the pointer is followed on the whole window: the
  // block it started on is gone once another day comes up. Registered afresh
  // each render, so the handlers see that day's columns and bookings.
  useEffect(() => {
    if (!drag) return undefined;
    const cancel = () => {
      stopDayHover();
      setDrag(null);
    };
    window.addEventListener('pointermove', moveDrag);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', cancel);
    return () => {
      window.removeEventListener('pointermove', moveDrag);
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', cancel);
    };
  });

  const dragging = drag?.moved ? drag : null;
  const chipDates = dragging && onChangeDay ? Array.from({ length: 7 }, (_, i) => addDays(dragging.originDate, i - 3)) : [];
  const parseDate = (d) => {
    const [y, m, day] = d.split('-').map(Number);
    return new Date(y, m - 1, day);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
    {/* One row, the same height either way so the timeline never jumps under
        the pointer: the hint, or while dragging, the days to hold it over. */}
    {chipDates.length === 0 ? (
      hint && (
        <div style={{ minHeight: 46, display: 'flex', alignItems: 'center' }}>
          <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>{hint}</span>
        </div>
      )
    ) : (
      <div style={{ minHeight: 46, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12.5, color: 'var(--muted)', marginRight: 4 }}>{T.dragToDay}</span>
        {chipDates.map((d) => {
          const current = d === date;
          const held = dayHover.current?.date === d && !current;
          return (
            <span
              key={d}
              ref={(el) => (el ? dayChips.current.set(d, el) : dayChips.current.delete(d))}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                minWidth: 58,
                padding: '6px 8px',
                borderRadius: 10,
                fontSize: 12,
                fontWeight: 600,
                border: current ? '1.5px solid var(--sage)' : held ? '1.5px dashed var(--sage)' : '1px solid var(--line)',
                background: current ? 'var(--sage-light)' : 'var(--surface)',
                userSelect: 'none',
              }}
            >
              {/* The weekday (an index past "today"/"tomorrow" gives the plain name). */}
              <span>{dayLabel(parseDate(d), 2, lang)}</span>
              <span style={{ fontSize: 14 }}>{parseDate(d).getDate()}</span>
            </span>
          );
        })}
      </div>
    )}
    <div ref={scroller} className="card" style={{ padding: 0, overflowX: 'auto' }}>
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
          const count = bookings.filter(inColumn(c)).length;
          return (
            <div
              key={c.id ?? 'own'}
              style={{
                opacity: dragging && !dragging.live.has(columnKey(c)) ? 0.35 : 1,
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
          const own = bookings.filter(inColumn(c));
          const key = columnKey(c);
          const live = !dragging || dragging.live.has(key);
          const target = dragging?.target?.key === key ? dragging.target : null;
          return (
            <div
              key={key}
              ref={(el) => (el ? columnEls.current.set(key, el) : columnEls.current.delete(key))}
              onClick={(e) => !dragging && pickSlot(e, c)}
              title={onPickSlot && !dragging ? T.timelineAddHint : undefined}
              style={{
                position: 'relative',
                height,
                borderLeft: '1px solid var(--line)',
                cursor: dragging ? (live ? 'grabbing' : 'not-allowed') : onPickSlot ? 'copy' : 'default',
                // The columns that can take the dragged booking are outlined in
                // their master's colour; the rest fade back.
                boxShadow: dragging && live ? `inset 0 0 0 2px ${masterColor(c.color)}` : 'none',
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
                    onPointerDown={(e) => startDrag(e, b, c)}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (justDragged.current) {
                        justDragged.current = false;
                        return;
                      }
                      onPickBooking(b);
                    }}
                    title={label}
                    aria-label={label}
                    style={{
                      // Touch: the press drags the block rather than the page.
                      touchAction: onMoveBooking && b.status === 'confirmed' ? 'none' : 'auto',
                      zIndex: 1,
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
                      // The one being dragged stays faint where it was.
                      opacity: dragging?.booking.id === b.id ? 0.3 : b.status === 'no_show' ? 0.55 : 1,
                      cursor: onMoveBooking && b.status === 'confirmed' ? 'grab' : 'pointer',
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
              {!live && (
                <div
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    inset: 0,
                    zIndex: 2,
                    background: 'var(--bg)',
                    opacity: 0.7,
                    backgroundImage: HATCH,
                  }}
                />
              )}
              {target && (
                <div
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    left: 4,
                    right: 4,
                    zIndex: 3,
                    top: (target.start - from) * PX_PER_MIN + 1,
                    // Room for the reason too, on a short booking.
                    height: Math.max(dragging.length * PX_PER_MIN - 2, target.ok ? 20 : 46),
                    borderRadius: 7,
                    border: `2px dashed ${target.ok ? masterColor(c.color) : 'var(--terracotta)'}`,
                    background: target.ok ? masterTint(c.color) : 'var(--terracotta-light)',
                    padding: '3px 7px',
                    fontSize: 11.5,
                    fontWeight: 700,
                    fontVariantNumeric: 'tabular-nums',
                    pointerEvents: 'none',
                  }}
                >
                  {toTime(target.start)}–{toTime(target.start + dragging.length)}
                  {!target.ok && <span style={{ display: 'block', fontWeight: 600, color: 'var(--terracotta)' }}>{T[target.refusal]}</span>}
                </div>
              )}
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
    </div>
  );
}

import { dayLabel, parseLocalDate } from '../i18n.js';

// A taken time is shown, struck through and unclickable, rather than left out:
// a grid that jumps from 14:30 to 16:00 looks broken, while a greyed 15:00 says
// plainly that the hour exists and is spoken for. Red marks the ones somebody
// else has booked; the rest — already past, inside a break, or too late in the
// day for a booking this long — are plain grey, since there's nothing personal
// about them.
const REASON_STYLE = {
  booked: { color: 'var(--terracotta)', border: 'var(--terracotta-light)', background: 'var(--terracotta-light)' },
  blocked: { color: 'var(--muted)', border: 'var(--line)', background: 'var(--bg)' },
  past: { color: 'var(--muted)', border: 'var(--line)', background: 'var(--bg)' },
  closing: { color: 'var(--muted)', border: 'var(--line)', background: 'var(--bg)' },
};

export default function SlotPicker({ T, lang, slotsData, slotsLoading, selectedDayIndex, selectedSlot, selectDay, selectSlot }) {
  const days = slotsData?.days ?? [];
  const day = days[selectedDayIndex];
  const isTodaySelected = selectedDayIndex === 0;

  // One grid in clock order, free and taken together.
  const daySlots = [
    ...(day?.slots ?? []).map((time) => ({ time, reason: null })),
    ...(day?.unavailable ?? []),
  ].sort((a, b) => a.time.localeCompare(b.time));
  const anyBooked = daySlots.some((s) => s.reason === 'booked');
  const anyFree = daySlots.some((s) => s.reason === null);

  return (
    <div className="scrollarea" style={{ flex: 1, overflowY: 'auto', padding: '4px 0 8px' }}>
      <div className="scrollarea" style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '8px 24px 4px' }}>
        {days.map((d, index) => {
          const dateObj = parseLocalDate(d.date);
          const selected = index === selectedDayIndex;
          return (
            <button
              key={d.date}
              onClick={() => selectDay(index)}
              style={{
                flexShrink: 0,
                minWidth: 48,
                padding: '10px 8px',
                borderRadius: 14,
                border: selected ? '1.5px solid var(--sage)' : '1px solid var(--line)',
                background: selected ? 'var(--sage)' : 'var(--surface)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <span style={{ fontSize: 11, color: selected ? 'var(--white)' : 'var(--ink)', opacity: 0.8, whiteSpace: 'nowrap' }}>
                {dayLabel(dateObj, index, lang)}
              </span>
              <span style={{ fontSize: 15, fontWeight: 600, color: selected ? 'var(--white)' : 'var(--ink)' }}>
                {dateObj.getDate()}
              </span>
            </button>
          );
        })}
      </div>

      <div style={{ padding: '18px 24px 8px' }}>
        <span style={{ fontSize: 13, color: 'var(--muted)' }}>{T.onlyRealOpenings}</span>
      </div>

      {isTodaySelected && (
        <div style={{ padding: '0 24px 8px' }}>
          <span style={{ fontSize: 12.5, color: 'var(--muted)', fontStyle: 'italic' }}>{T.sameDayNotice}</span>
        </div>
      )}

      {slotsLoading ? (
        <div style={{ padding: '4px 24px 24px' }}>
          <span style={{ fontSize: 14, color: 'var(--muted)' }}>{T.loading}</span>
        </div>
      ) : daySlots.length > 0 ? (
        <>
          {/* "Fully booked" only when it really is somebody else's booking that
              fills the day — on today the remaining times are usually just past
              the cutoff, which is a different thing to say. */}
          {!anyFree && (
            <div style={{ padding: '0 24px 10px' }}>
              <span style={{ fontSize: 13, color: anyBooked ? 'var(--terracotta)' : 'var(--muted)' }}>
                {anyBooked ? T.dayFullyBooked : T.noOpenings}
              </span>
            </div>
          )}
          <div style={{ padding: '4px 24px 8px', display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
            {daySlots.map(({ time, reason }) => {
              const selected = time === selectedSlot;
              const style = reason ? REASON_STYLE[reason] ?? REASON_STYLE.blocked : null;
              return (
                <button
                  key={time}
                  onClick={() => !reason && selectSlot(time)}
                  disabled={Boolean(reason)}
                  aria-label={reason === 'booked' ? `${time} — ${T.slotTakenTag}` : time}
                  style={{
                    padding: '12px 0',
                    borderRadius: 12,
                    fontSize: 14,
                    fontWeight: 500,
                    cursor: reason ? 'default' : 'pointer',
                    textDecoration: reason ? 'line-through' : 'none',
                    border: style
                      ? `1px solid ${style.border}`
                      : selected
                        ? '1.5px solid var(--terracotta)'
                        : '1px solid var(--line)',
                    background: style ? style.background : selected ? 'var(--terracotta)' : 'var(--surface)',
                    color: style ? style.color : selected ? 'var(--white)' : 'var(--ink)',
                  }}
                >
                  {time}
                </button>
              );
            })}
          </div>
          {anyBooked && (
            <div style={{ padding: '0 24px 24px', display: 'flex', alignItems: 'center', gap: 7 }}>
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 3,
                  background: 'var(--terracotta-light)',
                  border: '1px solid var(--terracotta)',
                  flexShrink: 0,
                }}
              />
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>{T.slotTakenTag}</span>
            </div>
          )}
        </>
      ) : (
        <div
          style={{
            margin: '8px 24px 24px',
            padding: 24,
            borderRadius: 16,
            background: 'var(--surface)',
            border: '1px dashed var(--line)',
            textAlign: 'center',
          }}
        >
          <span style={{ fontSize: 14, color: 'var(--muted)' }}>{T.noOpenings}</span>
        </div>
      )}
    </div>
  );
}

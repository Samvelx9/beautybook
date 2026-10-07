import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { WEEKDAY_FULL, parseLocalDate, formatDate, formatNotice, formatWindow } from '../i18n.js';
import { todayLocalStr } from 'salon-shared/time';

// Today in the master's own timezone, not the browser's.
const todayStr = todayLocalStr;
function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export default function AvailabilityScreen({ T, lang, onAuthError, account, refreshAccount }) {
  const [hours, setHours] = useState([]);
  const [blocks, setBlocks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [newBlock, setNewBlock] = useState({ date: '', allDay: true, startTime: '10:00', endTime: '11:00', note: '' });
  const [addingBlock, setAddingBlock] = useState(false);
  // The week is edited as one unit: `draft` holds the seven rows while editing
  // and is null the rest of the time, so `hours` always shows what's saved.
  const [draft, setDraft] = useState(null);
  const [savingHours, setSavingHours] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [hoursData, blocksData] = await Promise.all([
        api.getWeeklyHours(),
        api.getBlocks(todayStr(), addDays(todayStr(), 365)),
      ]);
      setHours(hoursData);
      setBlocks(blocksData);
    } catch (err) {
      if (!onAuthError(err)) setError('genericError');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateRow(dayOfWeek, fields) {
    setDraft((prev) => prev.map((h) => (h.day_of_week === dayOfWeek ? { ...h, ...fields } : h)));
  }

  function startEditHours() {
    setDraft(hours.map((h) => ({ ...h })));
    setError(null);
  }

  function cancelEditHours() {
    setDraft(null);
    setError(null);
  }

  async function saveHours() {
    const days = draft.map((row) => ({
      dayOfWeek: row.day_of_week,
      isOpen: row.is_open,
      startTime: (row.start_time || '').slice(0, 5),
      endTime: (row.end_time || '').slice(0, 5),
      hasLunch: Boolean(row.lunch_start),
      lunchStart: (row.lunch_start || '').slice(0, 5),
      lunchEnd: (row.lunch_end || '').slice(0, 5),
    }));
    // Caught here as well as server-side so an open day with no end time names
    // itself instead of failing the whole week with a generic message.
    const invalid = days.find((d) => d.isOpen && (!d.startTime || !d.endTime || d.startTime >= d.endTime));
    if (invalid) {
      setError('invalidHoursError');
      return;
    }
    const badLunch = days.find(
      (d) =>
        d.isOpen &&
        d.hasLunch &&
        (!d.lunchStart ||
          !d.lunchEnd ||
          d.lunchStart >= d.lunchEnd ||
          d.lunchStart < d.startTime ||
          d.lunchEnd > d.endTime)
    );
    if (badLunch) {
      setError('invalidLunchError');
      return;
    }

    setSavingHours(true);
    setError(null);
    try {
      const saved = await api.updateWeeklyHoursAll(days);
      setHours(saved);
      setDraft(null);
    } catch (err) {
      if (!onAuthError(err)) setError('genericError');
    } finally {
      setSavingHours(false);
    }
  }

  async function submitBlock(e) {
    e.preventDefault();
    if (!newBlock.date) return;
    setAddingBlock(true);
    setError(null);
    try {
      await api.createBlock({
        date: newBlock.date,
        startTime: newBlock.allDay ? null : newBlock.startTime,
        endTime: newBlock.allDay ? null : newBlock.endTime,
        note: newBlock.note.trim() || undefined,
      });
      setNewBlock({ date: '', allDay: true, startTime: '10:00', endTime: '11:00', note: '' });
      await load();
    } catch (err) {
      if (!onAuthError(err)) setError('genericError');
    } finally {
      setAddingBlock(false);
    }
  }

  async function removeBlock(id) {
    try {
      await api.deleteBlock(id);
      await load();
    } catch (err) {
      if (!onAuthError(err)) setError('genericError');
    }
  }

  if (loading) return <p style={{ color: 'var(--muted)' }}>{T.loading}</p>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      <h2 style={{ fontSize: 22, fontWeight: 500 }}>{T.availabilityTitle}</h2>
      {error && <p style={{ margin: 0, fontSize: 13, color: 'var(--terracotta)' }}>{T[error]}</p>}

      <NoticeSection T={T} lang={lang} account={account} refreshAccount={refreshAccount} onAuthError={onAuthError} />

      <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600 }}>{T.weeklyHoursSection}</h3>
          {draft === null ? (
            <button className="btn-outline" onClick={startEditHours}>
              {T.editHoursBtn}
            </button>
          ) : (
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-primary" onClick={saveHours} disabled={savingHours}>
                {T.saveHoursBtn}
              </button>
              <button className="btn-outline" onClick={cancelEditHours} disabled={savingHours}>
                {T.cancelBtn}
              </button>
            </div>
          )}
        </div>
        {(draft ?? hours).map((row) => (
          <div
            key={row.day_of_week}
            className="card"
            style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}
          >
            <span style={{ minWidth: 110, fontWeight: 600, fontSize: 14 }}>{WEEKDAY_FULL[lang][row.day_of_week]}</span>
            {draft === null ? (
              <span style={{ fontSize: 13.5, color: row.is_open ? 'inherit' : 'var(--muted)' }}>
                {row.is_open
                  ? `${(row.start_time || '').slice(0, 5)} – ${(row.end_time || '').slice(0, 5)}`
                  : T.closedLabel}
                {row.is_open && row.lunch_start && (
                  <span style={{ color: 'var(--muted)' }}>
                    {' '}
                    · {T.lunchLabel} {(row.lunch_start || '').slice(0, 5)}–{(row.lunch_end || '').slice(0, 5)}
                  </span>
                )}
              </span>
            ) : (
              <>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={row.is_open}
                    onChange={(e) =>
                      updateRow(row.day_of_week, {
                        is_open: e.target.checked,
                        start_time: e.target.checked ? row.start_time || '09:00' : null,
                        end_time: e.target.checked ? row.end_time || '18:00' : null,
                      })
                    }
                  />
                  {row.is_open ? T.openLabel : T.closedLabel}
                </label>
                {row.is_open && (
                  <>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                      {T.startTimeLabel}
                      <input
                        className="field-input"
                        style={{ width: 110 }}
                        type="time"
                        value={(row.start_time || '').slice(0, 5)}
                        onChange={(e) => updateRow(row.day_of_week, { start_time: e.target.value })}
                      />
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                      {T.endTimeLabel}
                      <input
                        className="field-input"
                        style={{ width: 110 }}
                        type="time"
                        value={(row.end_time || '').slice(0, 5)}
                        onChange={(e) => updateRow(row.day_of_week, { end_time: e.target.value })}
                      />
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                      <input
                        type="checkbox"
                        checked={Boolean(row.lunch_start)}
                        onChange={(e) =>
                          updateRow(row.day_of_week, {
                            lunch_start: e.target.checked ? row.lunch_start || '13:00' : null,
                            lunch_end: e.target.checked ? row.lunch_end || '14:00' : null,
                          })
                        }
                      />
                      {T.lunchLabel}
                    </label>
                    {row.lunch_start && (
                      <>
                        <input
                          className="field-input"
                          style={{ width: 110 }}
                          type="time"
                          value={(row.lunch_start || '').slice(0, 5)}
                          onChange={(e) => updateRow(row.day_of_week, { lunch_start: e.target.value })}
                        />
                        <span style={{ fontSize: 13, color: 'var(--muted)' }}>–</span>
                        <input
                          className="field-input"
                          style={{ width: 110 }}
                          type="time"
                          value={(row.lunch_end || '').slice(0, 5)}
                          onChange={(e) => updateRow(row.day_of_week, { lunch_end: e.target.value })}
                        />
                      </>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        ))}
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h3 style={{ fontSize: 16, fontWeight: 600 }}>{T.dateBlocksSection}</h3>

        <form onSubmit={submitBlock} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 12, color: 'var(--muted)' }}>{T.blockDateLabel}</label>
              <input
                className="field-input"
                type="date"
                value={newBlock.date}
                onChange={(e) => setNewBlock({ ...newBlock, date: e.target.value })}
                required
              />
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, marginTop: 20 }}>
              <input
                type="checkbox"
                checked={newBlock.allDay}
                onChange={(e) => setNewBlock({ ...newBlock, allDay: e.target.checked })}
              />
              {T.blockAllDay}
            </label>
            {!newBlock.allDay && (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: 12, color: 'var(--muted)' }}>{T.startTimeLabel}</label>
                  <input
                    className="field-input"
                    type="time"
                    value={newBlock.startTime}
                    onChange={(e) => setNewBlock({ ...newBlock, startTime: e.target.value })}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: 12, color: 'var(--muted)' }}>{T.endTimeLabel}</label>
                  <input
                    className="field-input"
                    type="time"
                    value={newBlock.endTime}
                    onChange={(e) => setNewBlock({ ...newBlock, endTime: e.target.value })}
                  />
                </div>
              </>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 12, color: 'var(--muted)' }}>{T.blockNoteLabel}</label>
              <input
                className="field-input"
                placeholder={T.blockNotePlaceholder}
                value={newBlock.note}
                onChange={(e) => setNewBlock({ ...newBlock, note: e.target.value })}
              />
            </div>
          </div>
          <button type="submit" className="btn-primary" style={{ alignSelf: 'flex-start' }} disabled={addingBlock}>
            {T.addBlockBtn}
          </button>
        </form>

        {blocks.length === 0 ? (
          <p style={{ color: 'var(--muted)', fontSize: 13.5 }}>{T.noBlocks}</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {blocks.map((b) => (
              <div key={b.id} className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>
                    {formatDate(parseLocalDate(b.date), lang)}
                    {b.start_time ? ` · ${b.start_time.slice(0, 5)}–${b.end_time.slice(0, 5)}` : ` · ${T.blockAllDay}`}
                  </span>
                  {b.note && <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>{b.note}</span>}
                </div>
                <button className="btn-danger-outline" onClick={() => removeBlock(b.id)}>
                  {T.deleteBtn}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// The same lists the server accepts (MIN_NOTICE_CHOICES and
// BOOKING_WINDOW_CHOICES in services/availability.js).
const NOTICE_CHOICES = [0, 15, 30, 45, 60, 90, 120, 180, 240, 360, 720, 1440, 2880];
const WINDOW_CHOICES = [7, 14, 21, 30, 60, 90];

// When guests may book: how far ahead at the least, and how far into the
// future at the most. Each saves as soon as it's picked.
function NoticeSection({ T, lang, account, refreshAccount, onAuthError }) {
  const { minNoticeMinutes, bookingWindowDays } = account.master;
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null); // 'settingsSaved' | 'genericError'

  async function choose(fields) {
    setSaving(true);
    setMessage(null);
    try {
      await api.updateSettings(fields);
      await refreshAccount();
      setMessage('settingsSaved');
    } catch (err) {
      if (!onAuthError(err)) setMessage('genericError');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <h3 style={{ fontSize: 16, fontWeight: 600 }}>{T.noticeSection}</h3>
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', alignItems: 'center', gap: '10px 12px', fontSize: 14, maxWidth: 560 }}>
          <label htmlFor="min-notice">{T.noticeLabel}</label>
          <select
            id="min-notice"
            className="field-input"
            value={minNoticeMinutes}
            disabled={saving}
            onChange={(e) => choose({ minNoticeMinutes: Number(e.target.value) })}
          >
            {NOTICE_CHOICES.map((m) => (
              <option key={m} value={m}>
                {m === 0 ? T.noticeNone : T.noticeBefore(formatNotice(m, lang))}
              </option>
            ))}
          </select>
          <label htmlFor="booking-window">{T.windowLabel}</label>
          <select
            id="booking-window"
            className="field-input"
            value={bookingWindowDays}
            disabled={saving}
            onChange={(e) => choose({ bookingWindowDays: Number(e.target.value) })}
          >
            {WINDOW_CHOICES.map((d) => (
              <option key={d} value={d}>{T.windowChoice(formatWindow(d, lang))}</option>
            ))}
          </select>
        </div>
        {message && (
          <span role="status" style={{ fontSize: 13, color: message === 'settingsSaved' ? 'var(--sage)' : 'var(--terracotta)' }}>
            {T[message]}
          </span>
        )}
        <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: 'var(--muted)' }}>{T.noticeHint}</p>
      </div>
    </section>
  );
}


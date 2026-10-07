import { useEffect, useState } from 'react';
import { api, ApiError } from '../api.js';
import { formatPrice, formatDate, pluralize, WEEKDAY_SHORT, MONTH_FULL, localName } from '../i18n.js';
import { splitLocalDateTime, todayLocalStr } from 'salon-shared/time';
import { DURATION_CHOICES, MIN_BOOKING_MINUTES, formatDuration } from 'salon-shared/booking';
import { isDateStr, isMonthStr, routeParam, setRouteParams } from '../route.js';

// Today in the master's own timezone, not the browser's.
const todayStr = todayLocalStr;
function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}
function pad(n) {
  return String(n).padStart(2, '0');
}
function monthStart(year, month) {
  return `${year}-${pad(month)}-01`;
}
function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}
// The calendar runs Monday-first, the way a wall calendar does here; the
// weekday tables are Sunday-first (matching Postgres' day_of_week), so this
// maps a column index onto them.
const MONDAY_FIRST = [1, 2, 3, 4, 5, 6, 0];

// A booking's Yerevan calendar day as 'YYYY-MM-DD' — the same key the day
// cells and the day list are grouped by.
function dateKeyOf(booking) {
  const { dateObj } = splitLocalDateTime(booking.start_time);
  return `${dateObj.getFullYear()}-${pad(dateObj.getMonth() + 1)}-${pad(dateObj.getDate())}`;
}

const STATUS_KEY = {
  confirmed: 'statusConfirmed',
  completed: 'statusCompleted',
  cancelled: 'statusCancelled',
  no_show: 'statusNoShow',
};
const STATUS_COLOR = {
  confirmed: 'var(--sage)',
  completed: 'var(--ink)',
  cancelled: 'var(--terracotta)',
  no_show: 'var(--muted)',
};

const EMPTY_BOOKING_FORM = {
  // Each entry is { serviceId, durationMinutes } — the length only matters for
  // a zone whose treatment is priced by the hour.
  items: [],
  date: '',
  time: '10:00',
  customerName: '',
  customerPhone: '',
  status: 'confirmed',
};

export default function BookingsScreen({ T, lang, onAuthError }) {
  // The calendar position starts from the URL, so a reload reopens the same
  // month, day and filter — see route.js.
  const [view, setView] = useState(() => routeParam('view', (v) => v === 'year', 'month')); // 'month' | 'year'
  const [cursor, setCursor] = useState(() => routeParam('month', isMonthStr, todayStr().slice(0, 7)) + '-01');
  const [selectedDate, setSelectedDate] = useState(() =>
    routeParam('day', (d) => isDateStr(d) && d.slice(0, 7) === cursor.slice(0, 7), todayStr())
  );
  const [selectedMonth, setSelectedMonth] = useState(() => Number(cursor.slice(5, 7)));
  const [statusFilter, setStatusFilter] = useState(() => routeParam('status', (v) => v in STATUS_KEY, ''));
  const [bookings, setBookings] = useState([]);
  const [services, setServices] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [deleting, setDeleting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  // null when the form is closed, 'new' when adding, or the id being edited.
  const [editingBookingId, setEditingBookingId] = useState(null);
  const [bookingForm, setBookingForm] = useState(EMPTY_BOOKING_FORM);
  const [savingBooking, setSavingBooking] = useState(false);

  const year = Number(cursor.slice(0, 4));
  const month = Number(cursor.slice(5, 7));

  // Filtering to cancelled is the clean-up view: a flat list spanning a year
  // either side, where a backlog can be cleared in one pass instead of month
  // by month. Every other filter shows the calendar.
  const cleanupView = statusFilter === 'cancelled';
  const range = cleanupView
    ? { from: addDays(todayStr(), -365), to: addDays(todayStr(), 365) }
    : view === 'year'
      ? { from: monthStart(year, 1), to: `${year}-12-31` }
      : { from: monthStart(year, month), to: `${year}-${pad(month)}-${daysInMonth(year, month)}` };

  async function load() {
    setLoading(true);
    try {
      const data = await api.getBookings({ from: range.from, to: range.to, status: statusFilter || undefined });
      setBookings(data);
      // Anything that just left the view can't stay selected.
      setSelected((prev) => {
        const visible = new Set(data.map((b) => b.id));
        return new Set([...prev].filter((id) => visible.has(id)));
      });
    } catch (err) {
      if (!onAuthError(err)) setError('genericError');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.from, range.to, statusFilter]);

  useEffect(() => {
    const today = todayStr();
    setRouteParams({
      view: view === 'year' ? 'year' : null,
      month: cursor.slice(0, 7) === today.slice(0, 7) ? null : cursor.slice(0, 7),
      day: selectedDate === today ? null : selectedDate,
      status: statusFilter,
    });
  }, [view, cursor, selectedDate, statusFilter]);

  // The price list only matters for the "add booking" form, so it's fetched
  // once rather than on every month change.
  useEffect(() => {
    (async () => {
      try {
        const [serviceRows, categoryRows] = await Promise.all([api.getServices(), api.getCategories()]);
        setServices(serviceRows.filter((s) => s.is_active));
        setCategories(categoryRows);
      } catch (err) {
        onAuthError(err);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function changeStatus(id, status) {
    try {
      await api.updateBookingStatus(id, status);
      await load();
    } catch (err) {
      if (!onAuthError(err)) setError('genericError');
    }
  }

  const byDate = new Map();
  for (const b of bookings) {
    const key = dateKeyOf(b);
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key).push(b);
  }
  const sortByTime = (rows) => [...rows].sort((a, b) => new Date(a.start_time) - new Date(b.start_time));

  // What the list under the grid — and the delete controls with it — acts on:
  // the clean-up list, the open month in year view, or the open day.
  const monthPrefix = `${year}-${pad(selectedMonth)}-`;
  const listed = cleanupView
    ? sortByTime(bookings)
    : view === 'year'
      ? sortByTime(bookings.filter((b) => dateKeyOf(b).startsWith(monthPrefix)))
      : sortByTime(byDate.get(selectedDate) || []);
  const cancelledListed = listed.filter((b) => b.status === 'cancelled');
  const allCancelledSelected = cancelledListed.length > 0 && cancelledListed.every((b) => selected.has(b.id));

  function toggleOne(id) {
    setConfirming(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllCancelled() {
    setConfirming(false);
    setSelected(allCancelledSelected ? new Set() : new Set(cancelledListed.map((b) => b.id)));
  }

  async function deleteSelected() {
    if (selected.size === 0) return;
    setDeleting(true);
    setError(null);
    try {
      await api.deleteBookings([...selected]);
      setSelected(new Set());
      setConfirming(false);
      await load();
    } catch (err) {
      if (!onAuthError(err)) setError('genericError');
    } finally {
      setDeleting(false);
    }
  }

  function openAddBooking() {
    setBookingForm({
      ...EMPTY_BOOKING_FORM,
      items: [],
      date: cleanupView ? todayStr() : selectedDate || todayStr(),
    });
    setError(null);
    setEditingBookingId('new');
  }

  // Editing starts from what the booking actually is, zones and all, so saving
  // without touching anything changes nothing.
  function openEditBooking(booking) {
    const { dateObj, time } = splitLocalDateTime(booking.start_time);
    setBookingForm({
      items: (booking.items ?? []).map((item) => ({
        serviceId: String(item.service_id),
        durationMinutes: String(item.duration_minutes),
      })),
      date: `${dateObj.getFullYear()}-${pad(dateObj.getMonth() + 1)}-${pad(dateObj.getDate())}`,
      time,
      customerName: booking.customer_name,
      customerPhone: booking.customer_phone,
      status: booking.status,
    });
    setError(null);
    setEditingBookingId(booking.id);
  }

  async function saveBooking() {
    const payload = {
      items: bookingForm.items.map((item) => ({
        serviceId: Number(item.serviceId),
        durationMinutes: Number(item.durationMinutes) || MIN_BOOKING_MINUTES,
      })),
      date: bookingForm.date,
      time: bookingForm.time,
      customerName: bookingForm.customerName.trim(),
      customerPhone: bookingForm.customerPhone.trim(),
      status: bookingForm.status,
    };
    if (
      payload.items.length === 0 ||
      !payload.date ||
      !payload.time ||
      !payload.customerName ||
      !payload.customerPhone
    ) {
      setError('missingBookingFields');
      return;
    }

    setSavingBooking(true);
    setError(null);
    try {
      if (editingBookingId === 'new') {
        await api.createBooking(payload);
        // Jump to wherever the new booking landed, so it's visible straight away.
        setStatusFilter('');
        setView('month');
        setCursor(payload.date.slice(0, 7) + '-01');
        setSelectedDate(payload.date);
      } else {
        await api.updateBooking(editingBookingId, payload);
      }
      setEditingBookingId(null);
      await load();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'slot_taken') {
        setError('slotTakenError');
      } else if (!onAuthError(err)) {
        setError('genericError');
      }
    } finally {
      setSavingBooking(false);
    }
  }

  function goToMonth(y, m) {
    setCursor(monthStart(y, m));
    setConfirming(false);
    // The list under the year grid belongs to the open month, and the cursor
    // follows it, so switching to month view lands on the month just picked.
    setSelectedMonth(m);
    // The day list under the grid belongs to the month on screen, so moving
    // month moves the open day with it — to today when today is in that month,
    // otherwise to the 1st.
    const today = todayStr();
    setSelectedDate(today.slice(0, 7) === `${y}-${pad(m)}` ? today : `${y}-${pad(m)}-01`);
  }

  function stepCursor(delta) {
    if (view === 'year') {
      // A new year opens on today's month when today is in it, else January.
      const y = year + delta;
      const today = todayStr();
      goToMonth(y, today.slice(0, 4) === String(y) ? Number(today.slice(5, 7)) : 1);
      return;
    }
    const next = month + delta;
    if (next < 1) goToMonth(year - 1, 12);
    else if (next > 12) goToMonth(year + 1, 1);
    else goToMonth(year, next);
  }

  const periodLabel = view === 'year' ? String(year) : `${MONTH_FULL[lang][month - 1]} ${year}`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <h2 style={{ fontSize: 22, fontWeight: 500 }}>{T.bookingsTitle}</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {!cleanupView && (
            <>
              <button
                className="btn-outline"
                onClick={() => setView(view === 'year' ? 'month' : 'year')}
                aria-pressed={view === 'year'}
              >
                {view === 'year' ? T.viewMonth : T.viewYear}
              </button>
              <button className="btn-outline" onClick={() => stepCursor(-1)} aria-label={T.prevWeek}>
                ←
              </button>
              <span style={{ minWidth: 140, textAlign: 'center', fontSize: 14, fontWeight: 600 }}>{periodLabel}</span>
              <button className="btn-outline" onClick={() => stepCursor(1)} aria-label={T.nextWeek}>
                →
              </button>
              <button
                className="btn-outline"
                onClick={() => {
                  goToMonth(Number(todayStr().slice(0, 4)), Number(todayStr().slice(5, 7)));
                  setView('month');
                }}
              >
                {T.today}
              </button>
            </>
          )}
          <select
            className="field-input"
            style={{ width: 160 }}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">{T.filterAll}</option>
            {Object.entries(STATUS_KEY).map(([value, key]) => (
              <option key={value} value={value}>
                {T[key]}
              </option>
            ))}
          </select>
          <button className="btn-primary" onClick={openAddBooking} disabled={editingBookingId !== null || services.length === 0}>
            {T.addBookingBtn}
          </button>
        </div>
      </div>

      {error && <p style={{ margin: 0, fontSize: 13, color: 'var(--terracotta)' }}>{T[error]}</p>}

      {editingBookingId === 'new' && (
        <BookingForm
          T={T}
          lang={lang}
          title={T.newBookingTitle}
          form={bookingForm}
          setForm={setBookingForm}
          services={services}
          categories={categories}
          saving={savingBooking}
          onSave={saveBooking}
          onCancel={() => {
            setEditingBookingId(null);
            setError(null);
          }}
        />
      )}

      {cleanupView && <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>{T.cancelledViewNote}</p>}

      {loading ? (
        <p style={{ color: 'var(--muted)' }}>{T.loading}</p>
      ) : (
        <>
          {!cleanupView &&
            (view === 'year' ? (
              <YearGrid
                T={T}
                lang={lang}
                bookings={bookings}
                selectedMonth={selectedMonth}
                onPickMonth={(m) => goToMonth(year, m)}
              />
            ) : (
              <MonthGrid
                T={T}
                lang={lang}
                year={year}
                month={month}
                byDate={byDate}
                selectedDate={selectedDate}
                onPickDay={(dateStr) => {
                  setConfirming(false);
                  setSelectedDate(dateStr);
                }}
              />
            ))}

          {cancelledListed.length > 0 && (
            <div
              className="card"
              style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', padding: '10px 14px' }}
            >
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                <input type="checkbox" checked={allCancelledSelected} onChange={toggleAllCancelled} />
                {T.selectAllCancelled}
              </label>
              <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>{T.onlyCancelledDeletable}</span>
              {confirming ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginLeft: 'auto', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, color: 'var(--terracotta)' }}>{T.confirmDeleteBookings}</span>
                  <button className="btn-danger-outline" onClick={deleteSelected} disabled={deleting}>
                    {T.confirmDeleteBtn} ({selected.size})
                  </button>
                  <button className="btn-outline" onClick={() => setConfirming(false)} disabled={deleting}>
                    {T.cancelBtn}
                  </button>
                </div>
              ) : (
                <button
                  className="btn-danger-outline"
                  style={{ marginLeft: 'auto' }}
                  onClick={() => setConfirming(true)}
                  disabled={selected.size === 0}
                >
                  {T.deleteSelectedBtn} ({selected.size})
                </button>
              )}
            </div>
          )}

          {!cleanupView && (
            <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              {view === 'year' ? `${MONTH_FULL[lang][selectedMonth - 1]} ${year}` : formatDate(parseDay(selectedDate), lang)}
            </h3>
          )}

          {listed.length === 0 ? (
            <p style={{ color: 'var(--muted)', fontSize: 13.5 }}>
              {cleanupView ? T.noBookingsThisPeriod : view === 'year' ? T.noBookingsThisMonth : T.noBookingsThisDay}
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {listed.map((b) => (
                <div key={b.id} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <BookingRow
                    T={T}
                    lang={lang}
                    booking={b}
                    showDate={cleanupView || view === 'year'}
                    selected={selected.has(b.id)}
                    isEditing={editingBookingId === b.id}
                    onToggle={() => toggleOne(b.id)}
                    onEdit={() => openEditBooking(b)}
                    onChangeStatus={(status) => changeStatus(b.id, status)}
                  />
                  {editingBookingId === b.id && (
                    <BookingForm
                      T={T}
                      lang={lang}
                      title={T.editBookingTitle}
                      form={bookingForm}
                      setForm={setBookingForm}
                      services={services}
                      categories={categories}
                      saving={savingBooking}
                      onSave={saveBooking}
                      onCancel={() => {
                        setEditingBookingId(null);
                        setError(null);
                      }}
                      nested
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function parseDay(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// The month at a glance: every day of the month with how much is booked on it,
// and the open day highlighted. Picking a day fills the list underneath.
function MonthGrid({ T, lang, year, month, byDate, selectedDate, onPickDay }) {
  const total = daysInMonth(year, month);
  const firstWeekday = (new Date(year, month - 1, 1).getDay() + 6) % 7; // Monday-first
  const cells = [...Array(firstWeekday).fill(null), ...Array.from({ length: total }, (_, i) => i + 1)];
  const today = todayStr();

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
        {MONDAY_FIRST.map((dow) => (
          <span
            key={dow}
            style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textAlign: 'center', textTransform: 'uppercase' }}
          >
            {WEEKDAY_SHORT[lang][dow]}
          </span>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
        {cells.map((day, i) => {
          if (day === null) return <span key={`pad-${i}`} />;
          const dateStr = `${year}-${pad(month)}-${pad(day)}`;
          const count = (byDate.get(dateStr) || []).length;
          const isSelected = dateStr === selectedDate;
          const isToday = dateStr === today;
          return (
            <button
              key={dateStr}
              onClick={() => onPickDay(dateStr)}
              aria-label={`${day}, ${count} ${pluralize(count, lang, 'bookings')}`}
              aria-pressed={isSelected}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 3,
                minHeight: 54,
                padding: 4,
                borderRadius: 10,
                cursor: 'pointer',
                border: isToday ? '1.5px solid var(--sage)' : '1px solid var(--line)',
                background: isSelected ? 'var(--sage-light)' : 'var(--white)',
              }}
            >
              <span style={{ fontSize: 13.5, fontWeight: isSelected || isToday ? 700 : 500 }}>{day}</span>
              {count > 0 && (
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: 'var(--white)',
                    background: 'var(--terracotta)',
                    borderRadius: 999,
                    padding: '1px 6px',
                    lineHeight: 1.5,
                  }}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// The year at a glance: one card per month with what it earned, the open month
// highlighted. Picking a month fills the list underneath, the way picking a day
// does in month view. Income counts completed bookings only — the same rule the
// dashboard's figures use, so the two never disagree.
function YearGrid({ T, lang, bookings, selectedMonth, onPickMonth }) {
  const stats = Array.from({ length: 12 }, () => ({ count: 0, completed: 0, income: 0 }));
  for (const b of bookings) {
    const { dateObj } = splitLocalDateTime(b.start_time);
    const s = stats[dateObj.getMonth()];
    s.count += 1;
    if (b.status === 'completed') {
      s.completed += 1;
      s.income += b.price_at_booking;
    }
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 10 }}>
      {stats.map((s, i) => {
        const isSelected = i + 1 === selectedMonth;
        return (
          <button
            key={i}
            className="card"
            onClick={() => onPickMonth(i + 1)}
            aria-pressed={isSelected}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              textAlign: 'left',
              cursor: 'pointer',
              border: isSelected ? '1.5px solid var(--sage)' : '1px solid var(--line)',
              background: isSelected ? 'var(--sage-light)' : 'var(--white)',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{ fontFamily: "'Newsreader',serif", fontSize: 16 }}>{MONTH_FULL[lang][i]}</span>
              <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>
                {s.count} {pluralize(s.count, lang, 'bookings')} · {T.completedCountLabel} {s.completed}
              </span>
            </div>
            <span style={{ fontSize: 13.5, fontWeight: 700, color: s.income > 0 ? 'var(--sage)' : 'var(--muted)' }}>
              {formatPrice(s.income, lang)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function BookingRow({ T, lang, booking, showDate, selected, isEditing, onToggle, onEdit, onChangeStatus }) {
  const { dateObj, time } = splitLocalDateTime(booking.start_time);
  return (
    <div
      className="card"
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {/* Only cancelled bookings can be deleted, so only they get a checkbox. */}
        {booking.status === 'cancelled' && (
          <input type="checkbox" checked={selected} onChange={onToggle} aria-label={T.selectBooking} />
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontFamily: "'Newsreader',serif", fontSize: 15 }}>
            {showDate ? `${formatDate(dateObj, lang)} · ` : ''}
            {time} · {(booking.items ?? []).map((z) => localName(z, lang)).join(' · ')}
          </span>
          <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>
            {booking.customer_name} · {booking.customer_phone} · {formatPrice(booking.price_at_booking, lang)}
          </span>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: STATUS_COLOR[booking.status] }}>
          {T[STATUS_KEY[booking.status]]}
        </span>
        <button className="btn-outline" onClick={onEdit} disabled={isEditing}>
          {T.editBtn}
        </button>
        <select
          className="field-input"
          style={{ width: 150 }}
          value=""
          onChange={(e) => {
            if (e.target.value) onChangeStatus(e.target.value);
          }}
        >
          <option value="">{T.markAs}</option>
          {Object.entries(STATUS_KEY)
            .filter(([value]) => value !== booking.status)
            .map(([value, key]) => (
              <option key={value} value={value}>
                {T[key]}
              </option>
            ))}
        </select>
      </div>
    </div>
  );
}

// One form for both jobs: adding a booking by hand and editing one that exists.
// Zones are chips with an "add" picker rather than a list of checkboxes — the
// price list runs to two dozen rows, which would bury the rest of the form.
function BookingForm({ T, lang, title, form, setForm, services, categories, saving, onSave, onCancel, nested }) {
  const byId = new Map(services.map((s) => [String(s.id), s]));
  const chosenIds = form.items.map((i) => i.serviceId);

  const addService = (serviceId) => {
    if (!serviceId || chosenIds.includes(serviceId)) return;
    setForm({
      ...form,
      items: [...form.items, { serviceId, durationMinutes: String(MIN_BOOKING_MINUTES) }],
    });
  };
  const removeService = (serviceId) =>
    setForm({ ...form, items: form.items.filter((i) => i.serviceId !== serviceId) });
  const setItemMinutes = (serviceId, minutes) =>
    setForm({
      ...form,
      items: form.items.map((i) => (i.serviceId === serviceId ? { ...i, durationMinutes: minutes } : i)),
    });

  const totals = form.items.reduce(
    (acc, item) => {
      const service = byId.get(item.serviceId);
      if (!service) return acc;
      const minutes = service.is_hourly ? Number(item.durationMinutes) || MIN_BOOKING_MINUTES : service.duration_minutes;
      const price = service.is_hourly
        ? Math.round((service.price * minutes) / 60)
        : service.price;
      return { minutes: acc.minutes + minutes, price: acc.price + price };
    },
    { minutes: 0, price: 0 }
  );

  return (
    <div
      className="card"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        ...(nested
          ? { marginLeft: 16, borderLeft: '3px solid var(--terracotta)', background: 'var(--bg)' }
          : { borderLeft: '3px solid var(--sage)' }),
      }}
    >
      <h3 style={{ fontSize: 16, fontWeight: 600 }}>{title}</h3>
      <p style={{ margin: 0, fontSize: 12.5, color: 'var(--muted)', maxWidth: 680 }}>{T.manualBookingHint}</p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <label style={{ fontSize: 12, color: 'var(--muted)' }}>{T.bookingServiceLabel}</label>
        {form.items.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {form.items.map((item) => {
              const service = byId.get(item.serviceId);
              if (!service) return null;
              return (
                <div
                  key={item.serviceId}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    flexWrap: 'wrap',
                    padding: '8px 12px',
                    borderRadius: 999,
                    border: '1px solid var(--line)',
                    background: 'var(--white)',
                  }}
                >
                  <span style={{ fontSize: 13.5 }}>{localName(service, lang)}</span>
                  {service.is_hourly ? (
                    <select
                      className="field-input"
                      style={{ width: 170, padding: '4px 8px' }}
                      value={item.durationMinutes}
                      onChange={(e) => setItemMinutes(item.serviceId, e.target.value)}
                    >
                      {DURATION_CHOICES.map((m) => (
                        <option key={m} value={m}>
                          {formatDuration(m, T.hourUnit, T.minUnit)} ·{' '}
                          {formatPrice(Math.round((service.price * m) / 60), lang)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>
                      {service.duration_minutes} {T.minUnit} · {formatPrice(service.price, lang)}
                    </span>
                  )}
                  <button
                    onClick={() => removeService(item.serviceId)}
                    aria-label={T.removeZone}
                    style={{ marginLeft: 'auto', fontSize: 16, lineHeight: 1, color: 'var(--muted)' }}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        )}
        <select className="field-input" value="" onChange={(e) => addService(e.target.value)}>
          <option value="">{T.addZone}</option>
          {categories.map((c) => {
            const rows = services.filter((s) => s.category_id === c.id && !chosenIds.includes(String(s.id)));
            if (rows.length === 0) return null;
            return (
              <optgroup key={c.id} label={localName(c, lang)}>
                {rows.map((s) => (
                  <option key={s.id} value={String(s.id)}>
                    {localName(s, lang)} ·{' '}
                    {s.is_hourly
                      ? `${formatPrice(s.price, lang)} ${T.perHourSuffix}`
                      : `${s.duration_minutes} ${T.minUnit} · ${formatPrice(s.price, lang)}`}
                  </option>
                ))}
              </optgroup>
            );
          })}
        </select>
        {form.items.length > 0 && (
          <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>
            {formatDuration(totals.minutes, T.hourUnit, T.minUnit)} ·{' '}
            <strong style={{ color: 'var(--terracotta)' }}>{formatPrice(totals.price, lang)}</strong>
          </span>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <Field label={T.dateLabel} type="date" value={form.date} onChange={(v) => setForm({ ...form, date: v })} />
        <Field label={T.timeLabel} type="time" value={form.time} onChange={(v) => setForm({ ...form, time: v })} />
        <Field
          label={T.customerNameLabel}
          value={form.customerName}
          onChange={(v) => setForm({ ...form, customerName: v })}
        />
        <Field
          label={T.customerPhoneLabel}
          value={form.customerPhone}
          onChange={(v) => setForm({ ...form, customerPhone: v })}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: 12, color: 'var(--muted)' }}>{T.bookingStatusLabel}</label>
          <select
            className="field-input"
            value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value })}
          >
            {Object.entries(STATUS_KEY).map(([value, key]) => (
              <option key={value} value={value}>
                {T[key]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <button className="btn-primary" onClick={onSave} disabled={saving}>
          {T.saveBtn}
        </button>
        <button className="btn-outline" onClick={onCancel} disabled={saving}>
          {T.cancelBtn}
        </button>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = 'text' }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ fontSize: 12, color: 'var(--muted)' }}>{label}</label>
      <input className="field-input" type={type} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

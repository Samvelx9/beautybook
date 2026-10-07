import LangSwitcher from './LangSwitcher.jsx';
import ZoneList from './ZoneList.jsx';
import { CalendarIcon, SendIcon } from './Icons.jsx';
import { formatDateAt, formatPrice } from '../i18n.js';
import { splitLocalDateTime } from '../lib/time.js';

export default function ConfirmationScreen(f) {
  const { T, lang, activeBooking } = f;
  const { dateObj, time } = splitLocalDateTime(activeBooking.startTime);
  const dateTimeSummary = formatDateAt(dateObj, time, lang);

  return (
    <>
      <div style={{ padding: '16px 24px 0', display: 'flex', justifyContent: 'flex-end', position: 'relative', zIndex: 2 }}>
        <LangSwitcher lang={f.lang} langMenuOpen={f.langMenuOpen} toggleLangMenu={f.toggleLangMenu} setLang={f.setLang} bg="var(--white)" />
      </div>
      <div className="scrollarea" style={{ flex: 1, overflowY: 'auto', padding: '24px 24px 24px', position: 'relative' }}>
        <div
          style={{
            position: 'absolute',
            top: -54,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 260,
            height: 260,
            borderRadius: '50%',
            background: 'var(--sage-light)',
            opacity: 0.55,
            zIndex: 0,
          }}
        />
        <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 16 }}>
          <svg width="60" height="60" viewBox="0 0 24 24" fill="none" style={{ stroke: 'var(--sage)', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }}>
            <circle cx="12" cy="12" r="9.4"></circle>
            <path d="M8 12.4L10.5 15L16 9"></path>
          </svg>
          <div>
            <h2 style={{ fontSize: 24, fontWeight: 500 }}>{T.allSet}</h2>
            <p style={{ margin: '8px 0 0', fontSize: 13.5, color: 'var(--muted)' }}>{T.confirmationNotified}</p>
          </div>

          <div style={{ width: '100%', textAlign: 'left', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 16, padding: 18, display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 13, color: 'var(--muted)' }}>{T.summaryService}</span>
              <ZoneList items={activeBooking.items} lang={lang} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 13, color: 'var(--muted)' }}>{T.summaryWhen}</span>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{dateTimeSummary}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 13, color: 'var(--muted)' }}>{T.summaryName}</span>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{activeBooking.customerName}</span>
            </div>
            <div style={{ height: 1, background: 'var(--line)', margin: '2px 0' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 13, color: 'var(--muted)' }}>{T.summaryPrice}</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--terracotta)' }}>{formatPrice(activeBooking.priceAtBooking, lang)}</span>
            </div>
          </div>

          <Reminders f={f} />

          <div style={{ width: '100%', display: 'flex', gap: 10 }}>
            <button
              onClick={f.goRescheduleFromConfirmation}
              style={{ flex: 1, padding: 14, borderRadius: 999, border: '1.5px solid var(--sage)', background: 'none', color: 'var(--sage)', fontSize: 14, fontWeight: 600 }}
            >
              {T.reschedule}
            </button>
            <button
              onClick={f.goCancelFromConfirmation}
              style={{ flex: 1, padding: 14, borderRadius: 999, border: '1.5px solid var(--terracotta)', background: 'none', color: 'var(--terracotta)', fontSize: 14, fontWeight: 600 }}
            >
              {T.cancelBooking}
            </button>
          </div>
        </div>
      </div>

      <div style={{ padding: '14px 24px 20px', borderTop: '1px solid var(--line)', background: 'var(--surface)' }}>
        <button
          onClick={f.bookAnother}
          style={{ width: '100%', padding: 16, borderRadius: 999, background: 'none', border: '1.5px solid var(--line)', color: 'var(--muted)', fontSize: 14, fontWeight: 600 }}
        >
          {T.bookAnother}
        </button>
      </div>
    </>
  );
}

const reminderButton = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  width: '100%',
  padding: '13px 16px',
  borderRadius: 14,
  border: '1px solid var(--line)',
  background: 'var(--surface)',
  color: 'var(--ink)',
  fontSize: 14,
  fontWeight: 600,
  textAlign: 'left',
  textDecoration: 'none',
};

// The two ways a guest can be reminded of the visit: their own calendar, and
// the platform's bot. Both are plain links — the calendar file opens in the phone's
// calendar app, the Telegram one in the Telegram app — and either is left out
// when the server didn't hand back what it needs (the bot only takes guests on
// the live site).
function Reminders({ f }) {
  const { T, calendarUrl, activeBooking, telegramOpened } = f;
  const telegramLink = activeBooking.telegramLink;
  if (!calendarUrl && !telegramLink) return null;

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8, textAlign: 'left' }}>
      <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600, letterSpacing: 0.3 }}>{T.stayReminded}</span>
      {calendarUrl && (
        <a href={calendarUrl} style={reminderButton}>
          <CalendarIcon />
          <span>{T.addToCalendar}</span>
        </a>
      )}
      {telegramLink && (
        <a href={telegramLink} target="_blank" rel="noopener noreferrer" onClick={f.markTelegramOpened} style={reminderButton}>
          <SendIcon />
          <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span>{T.telegramReminders}</span>
            <span style={{ fontSize: 12, fontWeight: 500, color: telegramOpened ? 'var(--sage)' : 'var(--muted)' }}>
              {telegramOpened ? T.telegramPressStart : T.telegramCaption}
            </span>
          </span>
        </a>
      )}
    </div>
  );
}

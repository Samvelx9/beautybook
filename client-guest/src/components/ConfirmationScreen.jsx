import { useEffect, useState } from 'react';
import LangSwitcher from './LangSwitcher.jsx';
import ZoneList from './ZoneList.jsx';
import { CalendarIcon, TelegramLogo } from './Icons.jsx';
import { api } from '../api.js';
import { formatDateAt, formatPrice, localName } from '../i18n.js';
import { splitLocalDateTime } from '../lib/time.js';
import { rem } from '../lib/rem.js';

export default function ConfirmationScreen(f) {
  const { T, lang, activeBooking } = f;
  // On a salon's page, who the visit is with.
  const masterName = f.isSalon && activeBooking.masterId
    ? localName(f.masterById(activeBooking.masterId), lang)
    : null;
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
            <h2 style={{ fontSize: rem(24), fontWeight: 500 }}>{T.allSet}</h2>
            <p style={{ margin: '8px 0 0', fontSize: rem(13.5), color: 'var(--muted)' }}>{T.confirmationNotified}</p>
          </div>

          <div style={{ width: '100%', textAlign: 'left', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 16, padding: 18, display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: rem(13), color: 'var(--muted)' }}>{T.summaryService}</span>
              <ZoneList items={activeBooking.items} lang={lang} />
            </div>
            {masterName && (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: rem(13), color: 'var(--muted)' }}>{T.summaryMaster}</span>
                <span style={{ fontSize: rem(13), fontWeight: 600 }}>{masterName}</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: rem(13), color: 'var(--muted)' }}>{T.summaryWhen}</span>
              <span style={{ fontSize: rem(13), fontWeight: 600 }}>{dateTimeSummary}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: rem(13), color: 'var(--muted)' }}>{T.summaryName}</span>
              <span style={{ fontSize: rem(13), fontWeight: 600 }}>{activeBooking.customerName}</span>
            </div>
            <div style={{ height: 1, background: 'var(--line)', margin: '2px 0' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: rem(13), color: 'var(--muted)' }}>{T.summaryPrice}</span>
              <span style={{ fontSize: rem(14), fontWeight: 700, color: 'var(--terracotta)' }}>{formatPrice(activeBooking.priceAtBooking, lang)}</span>
            </div>
          </div>

          <Reminders f={f} />

          <div style={{ width: '100%', display: 'flex', gap: 10 }}>
            <button
              onClick={f.goRescheduleFromConfirmation}
              style={{ flex: 1, padding: 14, borderRadius: 999, border: '1.5px solid var(--sage)', background: 'none', color: 'var(--sage)', fontSize: rem(14), fontWeight: 600 }}
            >
              {T.reschedule}
            </button>
            <button
              onClick={f.goCancelFromConfirmation}
              style={{ flex: 1, padding: 14, borderRadius: 999, border: '1.5px solid var(--terracotta)', background: 'none', color: 'var(--terracotta)', fontSize: rem(14), fontWeight: 600 }}
            >
              {T.cancelBooking}
            </button>
          </div>
        </div>
      </div>

      <div className="bottom-bar" style={{ padding: '14px 24px 20px' }}>
        <button
          className="tap-wide"
          onClick={f.bookAnother}
          style={{ width: '100%', padding: 16, borderRadius: 999, background: 'none', border: '1.5px solid var(--line)', color: 'var(--muted)', fontSize: rem(14), fontWeight: 600 }}
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
  fontSize: rem(14),
  fontWeight: 600,
  textAlign: 'left',
  textDecoration: 'none',
};

// Telegram's own blue, so the bot's row reads as Telegram at a glance.
const TELEGRAM_BLUE = '#2AABEE';

const telegramButton = {
  ...reminderButton,
  gap: 14,
  padding: '16px 16px',
  borderRadius: 16,
  border: `1.5px solid ${TELEGRAM_BLUE}`,
  background: 'rgba(42, 171, 238, 0.09)',
  fontSize: rem(15.5),
  fontWeight: 700,
};

// How often the open confirmation screen asks whether Start has been pressed,
// and for how long it keeps asking after the guest went to Telegram.
const LINK_POLL_MS = 3000;
const LINK_POLL_FOR_MS = 15 * 60_000;

// The two ways a guest can be reminded of the visit: their own calendar, and
// the platform's bot. Both are plain links — the calendar file opens in the phone's
// calendar app, the Telegram one in the Telegram app — and either is left out
// when the server didn't hand back what it needs (the bot only takes guests on
// the live site). Telegram comes first and stands out: it's the one that also
// lets the guest confirm or cancel from the reminder itself. Its checkbox ticks
// once the guest has pressed Start in the bot — the page asks the server every
// few seconds after they've opened Telegram, and again as soon as they're back.
function Reminders({ f }) {
  const { T, calendarUrl, activeBooking, telegramOpened } = f;
  const telegramLink = activeBooking.telegramLink;
  const guestToken = activeBooking.guestToken;
  const [linked, setLinked] = useState(false);

  useEffect(() => {
    if (!telegramOpened || linked || !guestToken) return undefined;
    let stopped = false;
    const check = () => {
      if (stopped || document.visibilityState === 'hidden') return;
      api.telegramStatus(guestToken)
        .then((status) => { if (!stopped && status?.linked) setLinked(true); })
        .catch(() => {});
    };
    check();
    const timer = setInterval(check, LINK_POLL_MS);
    const giveUp = setTimeout(() => clearInterval(timer), LINK_POLL_FOR_MS);
    document.addEventListener('visibilitychange', check);
    return () => {
      stopped = true;
      clearInterval(timer);
      clearTimeout(giveUp);
      document.removeEventListener('visibilitychange', check);
    };
  }, [telegramOpened, linked, guestToken]);

  if (!calendarUrl && !telegramLink) return null;

  let caption = T.telegramCaption;
  if (linked) caption = T.telegramLinked;
  else if (telegramOpened) caption = T.telegramPressStart;

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8, textAlign: 'left' }}>
      <span style={{ fontSize: rem(12), color: 'var(--muted)', fontWeight: 600, letterSpacing: 0.3 }}>{T.stayReminded}</span>
      {telegramLink && (
        <a href={telegramLink} target="_blank" rel="noopener noreferrer" onClick={f.markTelegramOpened} style={telegramButton}>
          <TelegramLogo size={36} />
          <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span>{T.telegramReminders}</span>
            <span style={{ fontSize: rem(12.5), fontWeight: 500, color: linked || telegramOpened ? 'var(--sage)' : 'var(--muted)' }}>
              {caption}
            </span>
          </span>
          <Checkbox checked={linked} />
        </a>
      )}
      {calendarUrl && (
        <a href={calendarUrl} style={reminderButton}>
          <CalendarIcon />
          <span>{T.addToCalendar}</span>
        </a>
      )}
    </div>
  );
}

// Shows whether the bot has the guest yet; not something they tick themselves,
// so it's only drawn — the caption next to it says the same in words.
function Checkbox({ checked }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: 24,
        height: 24,
        flexShrink: 0,
        borderRadius: 7,
        border: `2px solid ${TELEGRAM_BLUE}`,
        background: checked ? TELEGRAM_BLUE : 'var(--white)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'background 0.2s',
      }}
    >
      {checked && (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ stroke: '#fff', strokeWidth: 3.2, strokeLinecap: 'round', strokeLinejoin: 'round' }}>
          <path d="M5 12.5L10 17.5L19 7" />
        </svg>
      )}
    </span>
  );
}

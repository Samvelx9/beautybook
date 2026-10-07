import Header from './Header.jsx';
import { formatDateAt, formatPrice, localName } from '../i18n.js';
import { splitLocalDateTime } from '../lib/time.js';

export default function BookingsListScreen(f) {
  const { T, lang, bookings } = f;
  return (
    <>
      <Header
        title={T.yourUpcomingBookings}
        onBack={f.backToLookup}
        lang={f.lang}
        langMenuOpen={f.langMenuOpen}
        toggleLangMenu={f.toggleLangMenu}
        setLang={f.setLang}
      />
      <div className="scrollarea" style={{ flex: 1, overflowY: 'auto', padding: '6px 24px 24px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {bookings.length === 0 && (
          <p style={{ margin: '12px 0 0', fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.5 }}>{T.noBookingsFound}</p>
        )}
        {bookings.map((b) => {
          const { dateObj, time } = splitLocalDateTime(b.start_time);
          return (
            <button
              key={b.id}
              onClick={() => f.pickBooking(b)}
              style={{
                textAlign: 'left',
                width: '100%',
                padding: 16,
                borderRadius: 16,
                border: '1px solid var(--line)',
                background: 'var(--surface)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontFamily: "'Newsreader',serif", fontSize: 16 }}>
                  {(b.items ?? []).map((z) => localName(z, lang)).join(' · ')}
                </span>
                <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>{formatDateAt(dateObj, time, lang)}</span>
              </div>
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--terracotta)', flexShrink: 0 }}>
                {formatPrice(b.price_at_booking, lang)}
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}

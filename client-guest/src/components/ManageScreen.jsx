import Header from './Header.jsx';
import ZoneList from './ZoneList.jsx';
import { formatDateAt, formatPrice } from '../i18n.js';
import { splitLocalDateTime } from '../lib/time.js';

export default function ManageScreen(f) {
  const { T, lang, activeBooking } = f;
  const { dateObj, time } = splitLocalDateTime(activeBooking.startTime);
  const dateTimeSummary = formatDateAt(dateObj, time, lang);

  return (
    <>
      <Header
        title={T.yourBooking}
        onBack={f.backToBookingsList}
        lang={f.lang}
        langMenuOpen={f.langMenuOpen}
        toggleLangMenu={f.toggleLangMenu}
        setLang={f.setLang}
      />
      <div className="scrollarea" style={{ flex: 1, overflowY: 'auto', padding: '6px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 16, padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
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

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={f.goRescheduleFromManage}
            style={{ flex: 1, padding: 14, borderRadius: 999, border: '1.5px solid var(--sage)', background: 'none', color: 'var(--sage)', fontSize: 14, fontWeight: 600 }}
          >
            {T.reschedule}
          </button>
          <button
            onClick={f.goCancelFromManage}
            style={{ flex: 1, padding: 14, borderRadius: 999, border: '1.5px solid var(--terracotta)', background: 'none', color: 'var(--terracotta)', fontSize: 14, fontWeight: 600 }}
          >
            {T.cancelBooking}
          </button>
        </div>
      </div>

      <div style={{ padding: '14px 24px 20px', borderTop: '1px solid var(--line)', background: 'var(--surface)' }}>
        <button
          onClick={f.bookAnother}
          style={{ width: '100%', padding: 16, borderRadius: 999, background: 'var(--sage)', color: 'var(--white)', fontSize: 15, fontWeight: 600 }}
        >
          {T.done}
        </button>
      </div>
    </>
  );
}

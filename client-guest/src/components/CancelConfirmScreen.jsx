import Header from './Header.jsx';
import ZoneList from './ZoneList.jsx';
import { formatDateAt } from '../i18n.js';
import { splitLocalDateTime } from '../lib/time.js';
import { rem } from '../lib/rem.js';

export default function CancelConfirmScreen(f) {
  const { T, lang, activeBooking } = f;
  const { dateObj, time } = splitLocalDateTime(activeBooking.startTime);
  const dateTimeSummary = formatDateAt(dateObj, time, lang);

  return (
    <>
      <Header
        title={T.cancelBookingQ}
        onBack={f.backFromSubflow}
        lang={f.lang}
        langMenuOpen={f.langMenuOpen}
        toggleLangMenu={f.toggleLangMenu}
        setLang={f.setLang}
      />
      <div className="scrollarea" style={{ flex: 1, overflowY: 'auto', padding: '6px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 16, padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: rem(13), color: 'var(--muted)' }}>{T.summaryService}</span>
            <ZoneList items={activeBooking.items} lang={lang} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: rem(13), color: 'var(--muted)' }}>{T.summaryWhen}</span>
            <span style={{ fontSize: rem(13), fontWeight: 600 }}>{dateTimeSummary}</span>
          </div>
        </div>
        <p style={{ margin: 0, fontSize: rem(13), color: 'var(--muted)', lineHeight: 1.5 }}>{T.cancelWarning}</p>
        {f.bannerErrorKey && <p style={{ margin: 0, fontSize: rem(12.5), color: 'var(--terracotta)' }}>{T[f.bannerErrorKey]}</p>}
      </div>

      <div className="bottom-bar" style={{ padding: '14px 24px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <button
          className="tap-wide"
          onClick={f.finalizeCancel}
          disabled={f.busy}
          style={{ width: '100%', padding: 16, borderRadius: 999, background: 'var(--terracotta)', color: 'var(--white)', fontSize: rem(15), fontWeight: 600, opacity: f.busy ? 0.7 : 1 }}
        >
          {T.yesCancelBooking}
        </button>
        <button
          className="tap-wide"
          onClick={f.backFromSubflow}
          style={{ width: '100%', padding: 12, borderRadius: 999, background: 'none', color: 'var(--muted)', fontSize: rem(14), fontWeight: 600 }}
        >
          {T.noKeepIt}
        </button>
      </div>
    </>
  );
}

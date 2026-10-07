import LangSwitcher from './LangSwitcher.jsx';

export default function CancelledScreen(f) {
  const { T } = f;
  return (
    <>
      <div style={{ padding: '16px 24px 0', display: 'flex', justifyContent: 'flex-end', position: 'relative', zIndex: 2 }}>
        <LangSwitcher lang={f.lang} langMenuOpen={f.langMenuOpen} toggleLangMenu={f.toggleLangMenu} setLang={f.setLang} bg="var(--white)" />
      </div>
      <div className="scrollarea" style={{ flex: 1, overflowY: 'auto', padding: '36px 24px 24px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 16 }}>
          <svg width="60" height="60" viewBox="0 0 24 24" fill="none" style={{ stroke: 'var(--muted)', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }}>
            <circle cx="12" cy="12" r="9.4"></circle>
            <path d="M9 9L15 15"></path>
            <path d="M15 9L9 15"></path>
          </svg>
          <div>
            <h2 style={{ fontSize: 24, fontWeight: 500 }}>{T.bookingCancelled}</h2>
            <p style={{ margin: '8px 0 0', fontSize: 13.5, color: 'var(--muted)' }}>{T.cancelledCaption}</p>
          </div>
        </div>
      </div>

      <div style={{ padding: '14px 24px 20px', borderTop: '1px solid var(--line)', background: 'var(--surface)' }}>
        <button
          onClick={f.bookAnother}
          style={{ width: '100%', padding: 16, borderRadius: 999, background: 'var(--sage)', color: 'var(--white)', fontSize: 15, fontWeight: 600 }}
        >
          {T.bookNewAppointment}
        </button>
      </div>
    </>
  );
}

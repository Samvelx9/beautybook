import Header from './Header.jsx';

export default function LookupScreen(f) {
  const { T } = f;
  return (
    <>
      <Header
        title={T.findYourBooking}
        onBack={f.backToLanding}
        lang={f.lang}
        langMenuOpen={f.langMenuOpen}
        toggleLangMenu={f.toggleLangMenu}
        setLang={f.setLang}
      />
      <div className="scrollarea" style={{ flex: 1, overflowY: 'auto', padding: '6px 24px' }}>
        <p style={{ margin: '0 0 18px', fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.5 }}>{T.lookupCaption}</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: 12, color: 'var(--muted)' }}>{T.phoneLabel}</label>
          <input
            type="tel"
            value={f.lookupPhone}
            onChange={(e) => f.onLookupPhoneChange(e.target.value)}
            placeholder="+ … … …"
            style={{ padding: 14, borderRadius: 12, border: '1px solid var(--line)', background: 'var(--surface)', fontSize: 15, color: 'var(--ink)' }}
          />
        </div>
        {f.lookupError && <p style={{ margin: '14px 0 0', fontSize: 12.5, color: 'var(--terracotta)' }}>{T.lookupError}</p>}
        {f.bannerErrorKey && <p style={{ margin: '14px 0 0', fontSize: 12.5, color: 'var(--terracotta)' }}>{T[f.bannerErrorKey]}</p>}
      </div>

      <div style={{ padding: '14px 24px 20px', borderTop: '1px solid var(--line)', background: 'var(--surface)' }}>
        <button
          onClick={f.findBooking}
          disabled={f.busy}
          style={{ width: '100%', padding: 16, borderRadius: 999, background: 'var(--sage)', color: 'var(--white)', fontSize: 15, fontWeight: 600, opacity: f.busy ? 0.7 : 1 }}
        >
          {T.findBookingBtn}
        </button>
      </div>
    </>
  );
}

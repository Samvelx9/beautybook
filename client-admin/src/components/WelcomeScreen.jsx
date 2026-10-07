import LangSwitcher from './LangSwitcher.jsx';
import { PRODUCT_NAME, PLATFORM_DOMAIN } from '../i18n.js';

// What a visitor sees at the platform's own address before logging in: what
// the product does, and the way into a free trial.
export default function WelcomeScreen({ T, lang, setLang, go }) {
  const link = (page) => (e) => {
    e.preventDefault();
    go(page);
  };

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <div
        className="admin-content"
        style={{ flex: 'none', padding: '20px 20px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}
      >
        <span style={{ fontFamily: "'Newsreader',serif", fontSize: 20 }}>{PRODUCT_NAME}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <LangSwitcher lang={lang} setLang={setLang} />
          <a href="#login" onClick={link('login')} className="btn-outline">
            {T.loginLink}
          </a>
        </div>
      </div>

      <div className="admin-content" style={{ paddingTop: 56 }}>
        <div style={{ maxWidth: 680, margin: '0 auto', textAlign: 'center' }}>
          <h1 style={{ fontSize: 'clamp(30px, 6vw, 46px)', fontWeight: 500, lineHeight: 1.12 }}>{T.heroTitle}</h1>
          <p style={{ margin: '18px auto 0', fontSize: 16.5, lineHeight: 1.6, color: 'var(--muted)', maxWidth: 560 }}>
            {T.heroText}
          </p>
          <a
            href="#signup"
            onClick={link('signup')}
            className="btn-primary"
            style={{ display: 'inline-block', marginTop: 28, padding: '15px 30px', fontSize: 15.5 }}
          >
            {T.heroCta}
          </a>
          <p style={{ margin: '10px 0 0', fontSize: 12.5, color: 'var(--muted)' }}>{T.heroNoCard}</p>
        </div>

        <div
          style={{
            marginTop: 56,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 14,
          }}
        >
          {T.features.map(([title, text]) => (
            <div key={title} className="card">
              <h3 style={{ fontSize: 18, fontWeight: 500 }}>{title}</h3>
              <p style={{ margin: '8px 0 0', fontSize: 14, lineHeight: 1.55, color: 'var(--muted)' }}>
                {text.replace('{domain}', PLATFORM_DOMAIN)}
              </p>
            </div>
          ))}
        </div>

        <p style={{ marginTop: 40, textAlign: 'center', fontSize: 13.5, color: 'var(--muted)' }}>
          {T.haveAccount}{' '}
          <a href="#login" onClick={link('login')} style={{ fontWeight: 600 }}>
            {T.loginLink}
          </a>
        </p>
      </div>
    </div>
  );
}

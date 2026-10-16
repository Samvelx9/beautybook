import { useEffect, useState } from 'react';
import LangSwitcher from './LangSwitcher.jsx';
import { api } from '../api.js';
import { PRODUCT_NAME, PLATFORM_DOMAIN, formatPlatformPrice } from '../i18n.js';

// What a visitor sees at the platform's own address before logging in: what
// the product does, what it looks like, what it costs, and the way into a free
// trial.
export default function WelcomeScreen({ T, lang, setLang, go }) {
  // The price is the operator's to change (Platform → Settings), so it's read
  // from the server; until it arrives, or if it can't, the line under the
  // button just says no card is needed.
  const [platform, setPlatform] = useState(null);
  useEffect(() => {
    api.getPlatformInfo().then(setPlatform).catch(() => setPlatform(null));
  }, []);

  const link = (page) => (e) => {
    e.preventDefault();
    go(page);
  };

  const priceLine = platform
    ? T.heroPrice(formatPlatformPrice(platform.priceMonthlyMinor, platform.priceCurrency, lang))
    : T.heroNoCard;

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

      <div className="admin-content" style={{ paddingTop: 48 }}>
        <div className="welcome-hero">
          <div className="welcome-hero-text">
            <h1 style={{ fontSize: 'clamp(30px, 5.4vw, 48px)', fontWeight: 500, lineHeight: 1.08, letterSpacing: '-0.02em' }}>
              {T.heroTitle}
            </h1>
            <p style={{ margin: '18px 0 0', fontSize: 16.5, lineHeight: 1.6, color: 'var(--muted)', maxWidth: 520 }}>
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
            <p style={{ margin: '12px 0 0', fontSize: 13, color: 'var(--muted)' }}>{priceLine}</p>
          </div>

          <PhonePreview T={T} />
        </div>

        <div
          style={{
            marginTop: 64,
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
          <a href="#login" onClick={link('login')} className="hit-expand" style={{ fontWeight: 600 }}>
            {T.loginLink}
          </a>
        </p>
      </div>

      <footer
        className="admin-content"
        style={{
          flex: 'none',
          padding: '20px 20px 32px',
          display: 'flex',
          justifyContent: 'center',
          gap: 18,
          flexWrap: 'wrap',
          fontSize: 12.5,
          color: 'var(--muted)',
        }}
      >
        <span>
          © {new Date().getFullYear()} {PRODUCT_NAME}
        </span>
        <a href="#privacy" onClick={link('privacy')} className="hit-expand" style={{ color: 'var(--muted)' }}>
          {T.privacyLink}
        </a>
      </footer>
    </div>
  );
}

// A master's booking page in miniature: the product shown rather than
// described. Decorative (the caption says what it is), so it's hidden from
// screen readers; the names and prices are an illustration, not a real master.
function PhonePreview({ T }) {
  return (
    <figure style={{ margin: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
      <div aria-hidden="true" className="phone-frame">
        <div className="phone-screen">
          <div
            style={{
              padding: '30px 16px 18px',
              background: 'linear-gradient(170deg, var(--sage-light) 0%, var(--bg) 80%)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              textAlign: 'center',
            }}
          >
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: '50%',
                border: '3px solid var(--white)',
                background: 'var(--sage-light)',
                boxShadow: '0 8px 18px -10px rgba(0,0,0,0.35)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: "'Newsreader',serif",
                fontSize: 28,
                color: 'var(--sage)',
              }}
            >
              {T.previewName.slice(0, 1)}
            </div>
            <div style={{ marginTop: 10, fontFamily: "'Newsreader',serif", fontSize: 20, letterSpacing: '-0.01em' }}>
              {T.previewName}
            </div>
            <div style={{ marginTop: 4, fontSize: 10.5, lineHeight: 1.45, color: 'var(--muted)' }}>{T.previewTagline}</div>
            <div
              style={{
                marginTop: 12,
                padding: '8px 18px',
                borderRadius: 999,
                background: 'var(--sage)',
                color: 'var(--white)',
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              {T.previewBook}
            </div>
          </div>
          <div style={{ padding: '4px 12px 14px', display: 'flex', flexDirection: 'column', gap: 7 }}>
            {T.previewTreatments.map(([name, price]) => (
              <div
                key={name}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 9,
                  padding: '9px 10px',
                  borderRadius: 12,
                  border: '1px solid var(--line)',
                  background: 'var(--surface)',
                }}
              >
                <span style={{ width: 26, height: 26, borderRadius: 8, background: 'var(--sage-light)', flexShrink: 0 }} />
                <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, textAlign: 'left' }}>
                  <span style={{ fontFamily: "'Newsreader',serif", fontSize: 12.5 }}>{name}</span>
                  <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--terracotta)' }}>{price}</span>
                </span>
              </div>
            ))}
            {/* The rest of the page (hours, contacts) as faint lines — enough
                to read as a real page without competing with the price list. */}
            <div style={{ marginTop: 6, padding: '10px 12px', borderRadius: 12, border: '1px solid var(--line)', background: 'var(--surface)' }}>
              <div style={{ width: '45%', height: 6, borderRadius: 3, background: 'var(--line)' }} />
              {[78, 64, 70].map((w) => (
                <div key={w} style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between' }}>
                  <div style={{ width: `${w - 40}%`, height: 5, borderRadius: 3, background: 'var(--line)' }} />
                  <div style={{ width: '24%', height: 5, borderRadius: 3, background: 'var(--line)' }} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <figcaption style={{ fontSize: 12.5, color: 'var(--muted)' }}>{T.previewCaption}</figcaption>
    </figure>
  );
}

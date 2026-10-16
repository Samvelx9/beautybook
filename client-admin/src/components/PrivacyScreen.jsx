import { useEffect, useState } from 'react';
import LangSwitcher from './LangSwitcher.jsx';
import { api } from '../api.js';
import { PRODUCT_NAME } from '../i18n.js';
import { PRIVACY } from '../privacy.js';

// The privacy policy, open to everyone — logged in or not — since masters'
// booking pages link here from their footer. The support address comes from
// the operator's platform settings.
export default function PrivacyScreen({ lang, setLang, go }) {
  const P = PRIVACY[lang] ?? PRIVACY.en;
  const [supportEmail, setSupportEmail] = useState(null);

  useEffect(() => {
    api
      .getPlatformInfo()
      .then((info) => setSupportEmail(info.supportEmail))
      .catch(() => setSupportEmail(null));
  }, []);

  const fill = (text) => text.replaceAll('{product}', PRODUCT_NAME);
  const back = (e) => {
    e.preventDefault();
    if (window.history.length > 1) window.history.back();
    else go('welcome');
  };

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <div
        className="admin-content"
        style={{ flex: 'none', padding: '20px 20px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}
      >
        <a
          href="#welcome"
          onClick={(e) => {
            e.preventDefault();
            go('welcome');
          }}
          style={{ fontFamily: "'Newsreader',serif", fontSize: 20, color: 'var(--ink)' }}
        >
          {PRODUCT_NAME}
        </a>
        <LangSwitcher lang={lang} setLang={setLang} />
      </div>

      <article className="admin-content" style={{ maxWidth: 720, paddingTop: 36 }}>
        <a href="#welcome" onClick={back} className="hit-expand" style={{ fontSize: 13.5, fontWeight: 600 }}>
          {P.back}
        </a>
        <h1 style={{ marginTop: 18, fontSize: 'clamp(28px, 5vw, 38px)', fontWeight: 500, lineHeight: 1.15, letterSpacing: '-0.015em' }}>
          {P.title}
        </h1>
        <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--muted)' }}>
          {P.updated}: {P.updatedOn}
        </p>

        {P.sections.map((section) => (
          <section key={section.heading} style={{ marginTop: 30 }}>
            <h2 style={{ fontSize: 20, fontWeight: 500, lineHeight: 1.3 }}>{section.heading}</h2>
            {section.body.map((paragraph, i) => (
              <p key={i} style={{ margin: '10px 0 0', fontSize: 15, lineHeight: 1.7, maxWidth: '65ch' }}>
                {fill(paragraph)}
              </p>
            ))}
          </section>
        ))}

        <section style={{ marginTop: 30 }}>
          <h2 style={{ fontSize: 20, fontWeight: 500, lineHeight: 1.3 }}>{P.contactHeading}</h2>
          <p style={{ margin: '10px 0 0', fontSize: 15, lineHeight: 1.7, maxWidth: '65ch' }}>
            {supportEmail ? (
              <>
                {fill(P.contactWithEmail).split('{email}')[0]}
                <a href={`mailto:${supportEmail}`}>{supportEmail}</a>
                {fill(P.contactWithEmail).split('{email}')[1]}
              </>
            ) : (
              fill(P.contactWithoutEmail)
            )}
          </p>
        </section>
      </article>
    </div>
  );
}

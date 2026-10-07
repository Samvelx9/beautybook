import { useEffect, useRef } from 'react';
import { LANG_META, LANG_ORDER, getSiteLanguages } from '../i18n.js';

// Offers only the languages the master's page is in (from GET /api/site);
// with just one there's nothing to switch, so nothing shows.
export default function LangSwitcher({ lang, langMenuOpen, toggleLangMenu, setLang, bg = 'var(--surface)' }) {
  const rootRef = useRef(null);

  // Clicking anywhere else, or pressing Escape, dismisses the menu — otherwise
  // the only way out is to pick a language you may not have wanted. The open
  // state lives in the booking flow, so closing goes back through the same
  // toggle the button uses.
  useEffect(() => {
    if (!langMenuOpen) return undefined;
    function onPointerDown(event) {
      if (!rootRef.current?.contains(event.target)) toggleLangMenu();
    }
    function onKeyDown(event) {
      if (event.key === 'Escape') toggleLangMenu();
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [langMenuOpen, toggleLangMenu]);

  const languages = getSiteLanguages();
  const offered = LANG_ORDER.filter((code) => !languages || languages.includes(code));
  if (offered.length < 2) return null;

  return (
    <div ref={rootRef} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        onClick={toggleLangMenu}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 3,
          padding: '6px 9px',
          borderRadius: 999,
          border: '1px solid var(--line)',
          background: bg,
        }}
      >
        <span style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: '0.04em', lineHeight: 1 }}>
          {LANG_META[lang].code}
        </span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" style={{ stroke: 'var(--muted)', strokeWidth: 2.5, strokeLinecap: 'round', strokeLinejoin: 'round' }}>
          <path d="M6 9L12 15L18 9"></path>
        </svg>
      </button>
      {langMenuOpen && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            background: 'var(--white)',
            border: '1px solid var(--line)',
            borderRadius: 12,
            padding: 6,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            boxShadow: '0 8px 24px rgba(0,0,0,0.10)',
            zIndex: 30,
            minWidth: 136,
          }}
        >
          {offered.map((code) => (
            <button
              key={code}
              onClick={() => setLang(code)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 10px',
                borderRadius: 8,
                background: code === lang ? 'var(--sage-light)' : 'transparent',
                textAlign: 'left',
              }}
            >
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', minWidth: 20 }}>
                {LANG_META[code].code}
              </span>
              <span style={{ fontSize: 13, fontWeight: code === lang ? 700 : 500, color: 'var(--ink)' }}>
                {LANG_META[code].name}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

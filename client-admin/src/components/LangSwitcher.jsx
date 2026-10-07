import { useEffect, useRef, useState } from 'react';
import { LANG_META, LANG_ORDER } from '../i18n.js';

export default function LangSwitcher({ lang, setLang }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  // A dropdown that only closes by picking an option traps you into changing
  // the language just to dismiss it — so a click anywhere else, or Escape,
  // closes it too. Listening on pointerdown rather than click means the menu is
  // gone before the click lands on whatever was underneath it.
  useEffect(() => {
    if (!open) return undefined;
    function onPointerDown(event) {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    }
    function onKeyDown(event) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 3,
          padding: '6px 9px',
          borderRadius: 999,
          border: '1px solid var(--line)',
          background: 'var(--white)',
        }}
      >
        <span style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: '0.04em', lineHeight: 1 }}>
          {LANG_META[lang].code}
        </span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" style={{ stroke: 'var(--muted)', strokeWidth: 2.5, strokeLinecap: 'round', strokeLinejoin: 'round' }}>
          <path d="M6 9L12 15L18 9"></path>
        </svg>
      </button>
      {open && (
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
          {LANG_ORDER.map((code) => (
            <button
              key={code}
              onClick={() => {
                setLang(code);
                setOpen(false);
              }}
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

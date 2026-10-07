import LangSwitcher from './LangSwitcher.jsx';
import ProgressDots from './ProgressDots.jsx';

export default function Header({ title, onBack, showDots, dotStep, lang, langMenuOpen, toggleLangMenu, setLang }) {
  return (
    <div style={{ padding: '20px 24px 12px', display: 'flex', alignItems: 'center', gap: 12 }}>
      <button
        onClick={onBack}
        style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
      >
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" style={{ stroke: 'var(--ink)', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }}>
          <path d="M15 6L9 12L15 18"></path>
        </svg>
      </button>
      <h3 style={{ fontSize: 18, fontWeight: 500, flex: 1, minWidth: 0 }}>{title}</h3>
      {showDots && <ProgressDots step={dotStep} />}
      <LangSwitcher lang={lang} langMenuOpen={langMenuOpen} toggleLangMenu={toggleLangMenu} setLang={setLang} />
    </div>
  );
}

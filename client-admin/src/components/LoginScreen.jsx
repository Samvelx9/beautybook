import { useState } from 'react';
import LangSwitcher from './LangSwitcher.jsx';
import { PRODUCT_NAME } from '../i18n.js';

export default function LoginScreen({ T, lang, setLang, go, login, loginError, loggingIn }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  function onSubmit(e) {
    e.preventDefault();
    if (!email.trim() || !password) return;
    login(email.trim(), password);
  }

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '20px 24px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <a href="#welcome" onClick={(e) => { e.preventDefault(); go('welcome'); }} style={{ fontFamily: "'Newsreader',serif", fontSize: 18, color: 'var(--ink)' }}>
          {PRODUCT_NAME}
        </a>
        <LangSwitcher lang={lang} setLang={setLang} />
      </div>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <form onSubmit={onSubmit} className="card" style={{ width: '100%', maxWidth: 360, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <h2 style={{ fontSize: 22, fontWeight: 500, textAlign: 'center' }}>{T.loginTitle}</h2>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label htmlFor="login-email" style={{ fontSize: 12, color: 'var(--muted)' }}>{T.emailLabel}</label>
            <input id="login-email" className="field-input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label htmlFor="login-password" style={{ fontSize: 12, color: 'var(--muted)' }}>{T.passwordLabel}</label>
            <input id="login-password" className="field-input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>

          {loginError && <p role="alert" style={{ margin: 0, fontSize: 12.5, color: 'var(--terracotta)' }}>{T[loginError]}</p>}

          <button type="submit" className="btn-primary" disabled={loggingIn}>
            {loggingIn ? T.loggingIn : T.loginBtn}
          </button>

          <p style={{ margin: 0, fontSize: 13, textAlign: 'center', color: 'var(--muted)' }}>
            {T.noAccountYet}{' '}
            <a href="#signup" onClick={(e) => { e.preventDefault(); go('signup'); }} style={{ fontWeight: 600 }}>
              {T.signupLink}
            </a>
          </p>
        </form>
      </div>
    </div>
  );
}

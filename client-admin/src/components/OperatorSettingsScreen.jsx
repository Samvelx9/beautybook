import { useState } from 'react';
import { api, ApiError } from '../api.js';

// Settings for a platform operator's own login — one with no booking page, so
// none of a master's Settings apply. Changing the password ends every other
// session; this one carries on with the fresh token.
export default function OperatorSettingsScreen({ T, onAuthError, setSessionToken }) {
  const [form, setForm] = useState({ current: '', next: '', repeat: '' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null); // { key, error }

  const mismatch = form.repeat !== '' && form.next !== form.repeat;

  async function submit(e) {
    e.preventDefault();
    if (mismatch) return;
    setBusy(true);
    setMessage(null);
    try {
      const { token } = await api.changeOperatorPassword(form.current, form.next);
      setSessionToken(token);
      setForm({ current: '', next: '', repeat: '' });
      setMessage({ key: 'passwordChanged', error: false });
    } catch (err) {
      if (!onAuthError(err)) {
        setMessage({ key: err instanceof ApiError && T[err.code] ? err.code : 'genericError', error: true });
      }
    } finally {
      setBusy(false);
    }
  }

  const label = { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12.5, color: 'var(--muted)' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 520 }}>
      <div>
        <h2 style={{ fontSize: 22, fontWeight: 500 }}>{T.operatorSettingsTitle}</h2>
        <p style={{ margin: '6px 0 0', fontSize: 13.5, color: 'var(--muted)' }}>{T.operatorSettingsCaption}</p>
      </div>

      <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h3 style={{ fontSize: 18, fontWeight: 500 }}>{T.passwordSection}</h3>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={label}>
            {T.currentPasswordLabel}
            <input className="field-input" type="password" autoComplete="current-password" value={form.current} onChange={(e) => setForm({ ...form, current: e.target.value })} />
          </label>
          <label style={label}>
            {T.newPasswordLabel}
            <input className="field-input" type="password" autoComplete="new-password" value={form.next} onChange={(e) => setForm({ ...form, next: e.target.value })} />
            <span style={{ fontSize: 12 }}>{T.passwordHint}</span>
          </label>
          <label style={label}>
            {T.repeatPasswordLabel}
            <input
              className="field-input"
              type="password"
              autoComplete="new-password"
              aria-invalid={mismatch}
              value={form.repeat}
              onChange={(e) => setForm({ ...form, repeat: e.target.value })}
            />
            {mismatch && <span style={{ fontSize: 12, color: 'var(--terracotta)' }}>{T.passwordsDontMatch}</span>}
          </label>
          <div>
            <button type="submit" className="btn-primary" disabled={busy || !form.current || !form.next || form.next !== form.repeat}>
              {T.changePasswordBtn}
            </button>
          </div>
        </form>
        {message && (
          <p role={message.error ? 'alert' : 'status'} style={{ margin: 0, fontSize: 13, color: message.error ? 'var(--terracotta)' : 'var(--sage)' }}>
            {T[message.key]}
          </p>
        )}
      </section>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { api, ApiError } from '../api.js';
import { formatDate } from '../i18n.js';

const STATUS_COLOR = {
  trial: 'var(--sage)',
  active: 'var(--sage)',
  on_trial: 'var(--sage)',
  cancelled: 'var(--muted)',
  past_due: 'var(--terracotta)',
  expired: 'var(--terracotta)',
  suspended: 'var(--terracotta)',
};

// The platform operator's list of every master who signed up, with the few
// levers support needs: suspend, extend a trial, set a custom domain, and
// reset a password for someone locked out.
export default function PlatformScreen({ T, lang, onAuthError }) {
  const [masters, setMasters] = useState(null);
  const [error, setError] = useState(null);

  async function load() {
    try {
      setMasters(await api.getPlatformMasters());
    } catch (err) {
      if (!onAuthError(err)) setError('genericError');
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function act(fn) {
    setError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      if (!onAuthError(err)) setError(err instanceof ApiError && T[err.code] ? err.code : 'genericError');
    }
  }

  const resetPassword = (m) =>
    act(async () => {
      if (!window.confirm(T.confirmResetPassword)) return;
      const { password } = await api.resetMasterPassword(m.id);
      window.alert(T.newPasswordIs(password));
    });

  const setDomain = (m) =>
    act(async () => {
      const value = window.prompt(T.domainPrompt, m.customDomain ?? '');
      if (value === null) return;
      await api.updatePlatformMaster(m.id, { customDomain: value.trim() || null });
    });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <h2 style={{ fontSize: 22, fontWeight: 500 }}>{T.platformTitle}</h2>
        <p style={{ margin: '6px 0 0', fontSize: 13.5, color: 'var(--muted)' }}>
          {T.platformCaption}
          {masters && ` — ${masters.length}`}
        </p>
      </div>

      {error && <p role="alert" style={{ margin: 0, fontSize: 13, color: 'var(--terracotta)' }}>{T[error]}</p>}
      {!masters && !error && <p style={{ color: 'var(--muted)' }}>{T.loading}</p>}

      {masters && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {masters.map((m) => (
            <div key={m.id} className="card" style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 220, flex: '1 1 260px' }}>
                <span style={{ fontFamily: "'Newsreader',serif", fontSize: 17 }}>{m.name || m.slug}</span>
                <a href={m.siteUrl} target="_blank" rel="noreferrer" style={{ fontSize: 13 }}>
                  {m.siteUrl.replace(/^https?:\/\//, '')}
                </a>
                <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>
                  {m.email} · {T.colCreated}: {formatDate(new Date(m.createdAt), lang)}
                  {m.telegramConnected ? ' · Telegram ✓' : ''}
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 160 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: STATUS_COLOR[m.access.state] }}>
                  {T.statusLabels[m.access.state] ?? m.access.state}
                </span>
                <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>
                  {m.access.state === 'trial' && `→ ${formatDate(new Date(m.access.trialEndsAt), lang)}`}
                  {m.access.periodEndsAt && m.access.state !== 'trial' && `→ ${formatDate(new Date(m.access.periodEndsAt), lang)}`}
                </span>
                <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>
                  {m.bookingsTotal} {T.bookingsShort} ({m.bookings30d} {T.last30}) · {m.activeServices} {T.servicesShort}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button className="btn-outline" onClick={() => act(() => api.updatePlatformMaster(m.id, { extendTrialDays: 7 }))}>
                  {T.extendTrialBtn}
                </button>
                <button className="btn-outline" onClick={() => setDomain(m)}>{T.customDomainBtn}</button>
                <button className="btn-outline" onClick={() => resetPassword(m)}>{T.resetPasswordBtn}</button>
                <button
                  className={m.access.state === 'suspended' ? 'btn-outline' : 'btn-danger-outline'}
                  onClick={() => act(() => api.updatePlatformMaster(m.id, { suspended: m.access.state !== 'suspended' }))}
                >
                  {m.access.state === 'suspended' ? T.unsuspendBtn : T.suspendBtn}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

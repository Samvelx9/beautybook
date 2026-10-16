import { useEffect, useState } from 'react';
import { api, ApiError } from '../api.js';
import { formatDate } from '../i18n.js';
import { routeParam, setRouteParams } from '../route.js';
import MasterDetail from './MasterDetail.jsx';
import ConfirmInline from './ConfirmInline.jsx';

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
  // One master's row at a time can be mid-action: confirming a reset or a
  // suspension, editing the domain, or showing a just-reset password.
  // { id, kind: 'reset' | 'suspend' | 'domain' | 'password', value? }
  const [pending, setPending] = useState(null);
  // The master being looked at in detail, kept in the URL so a reload stays there.
  const [openId, setOpenId] = useState(() => {
    const value = routeParam('master', (v) => /^\d+$/.test(v), null);
    return value === null ? null : Number(value);
  });

  useEffect(() => {
    setRouteParams({ master: openId });
  }, [openId]);

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

  async function act(fn, reload = load) {
    setError(null);
    try {
      await fn();
      await reload();
    } catch (err) {
      if (!onAuthError(err)) setError(err instanceof ApiError && T[err.code] ? err.code : 'genericError');
    }
  }

  // The new password stays on the row until dismissed, where it can be
  // selected and copied — an alert box would vanish on the first click.
  const resetPassword = (m, reload) =>
    act(async () => {
      const { password } = await api.resetMasterPassword(m.id);
      setPending({ id: m.id, kind: 'password', value: password });
    }, reload);

  const saveDomain = (m, value, reload) =>
    act(async () => {
      await api.updatePlatformMaster(m.id, { customDomain: value.trim() || null });
      setPending(null);
    }, reload);

  const setSuspended = (m, suspended, reload) =>
    act(async () => {
      await api.updatePlatformMaster(m.id, { suspended });
      setPending(null);
    }, reload);

  // The same buttons on a master's card and on their detail page; `reload`
  // refreshes whichever of the two is showing. `state` is the master's access
  // state, which decides Suspend vs Unsuspend.
  const actions = (m, reload = load) => {
    const state = m.access.state;
    const mine = pending?.id === m.id ? pending : null;
    const dismiss = () => setPending(null);

    if (mine?.kind === 'reset') {
      return (
        <ConfirmInline
          T={T}
          message={T.confirmResetPassword}
          confirmLabel={T.resetPasswordBtn}
          onConfirm={() => resetPassword(m, reload)}
          onCancel={dismiss}
        />
      );
    }
    if (mine?.kind === 'suspend') {
      return (
        <ConfirmInline
          T={T}
          message={T.confirmSuspend}
          confirmLabel={T.suspendBtn}
          onConfirm={() => setSuspended(m, true, reload)}
          onCancel={dismiss}
        />
      );
    }
    if (mine?.kind === 'password') {
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13 }}>{T.resetPasswordResult}</span>
          <code style={{ fontSize: 14, padding: '6px 10px', borderRadius: 8, background: 'var(--bg)', userSelect: 'all' }}>
            {mine.value}
          </code>
          <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>{T.newPasswordHint}</span>
          <button className="btn-outline" onClick={dismiss}>{T.doneBtn}</button>
        </div>
      );
    }
    if (mine?.kind === 'domain') {
      return (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            saveDomain(m, mine.value, reload);
          }}
          style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}
        >
          <input
            className="field-input"
            style={{ width: 240 }}
            value={mine.value}
            onChange={(e) => setPending({ ...mine, value: e.target.value })}
            placeholder="annabeauty.com"
            aria-label={T.domainPrompt}
            autoFocus
          />
          <button type="submit" className="btn-primary">{T.saveBtn}</button>
          <button type="button" className="btn-outline" onClick={dismiss}>{T.cancelBtn}</button>
          <span style={{ fontSize: 12, color: 'var(--muted)', flexBasis: '100%' }}>{T.domainPrompt}</span>
        </form>
      );
    }

    return (
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button className="btn-outline" onClick={() => act(() => api.updatePlatformMaster(m.id, { extendTrialDays: 7 }), reload)}>
          {T.extendTrialBtn}
        </button>
        <button className="btn-outline" onClick={() => setPending({ id: m.id, kind: 'domain', value: m.customDomain ?? '' })}>
          {T.customDomainBtn}
        </button>
        <button className="btn-outline" onClick={() => setPending({ id: m.id, kind: 'reset' })}>{T.resetPasswordBtn}</button>
        {/* Suspending takes the master's page offline, so it asks; bringing it
            back doesn't need to. */}
        <button
          className={state === 'suspended' ? 'btn-outline' : 'btn-danger-outline'}
          onClick={() =>
            state === 'suspended' ? setSuspended(m, false, reload) : setPending({ id: m.id, kind: 'suspend' })
          }
        >
          {state === 'suspended' ? T.unsuspendBtn : T.suspendBtn}
        </button>
      </div>
    );
  };

  if (openId !== null) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {error && <p role="alert" style={{ margin: 0, fontSize: 13, color: 'var(--terracotta)' }}>{T[error]}</p>}
        <MasterDetail
          T={T}
          lang={lang}
          masterId={openId}
          onBack={() => { setOpenId(null); load(); }}
          onAuthError={onAuthError}
          actions={actions}
        />
      </div>
    );
  }

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
                <button
                  onClick={() => setOpenId(m.id)}
                  style={{ fontFamily: "'Newsreader',serif", fontSize: 17, textAlign: 'left', padding: 0, color: 'var(--ink)' }}
                >
                  {m.name || m.slug}
                </button>
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
                <button className="btn-primary" onClick={() => setOpenId(m.id)}>{T.viewDetails}</button>
                {actions(m)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

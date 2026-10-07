import { useEffect, useState } from 'react';
import { api, ApiError } from '../api.js';
import { LANG_META, LANG_ORDER, formatDate } from '../i18n.js';
import { CURRENCIES, timeZones } from '../options.js';

function Section({ title, children }) {
  return (
    <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h3 style={{ fontSize: 18, fontWeight: 500 }}>{title}</h3>
      {children}
    </section>
  );
}

const muted = { margin: 0, fontSize: 13.5, lineHeight: 1.55, color: 'var(--muted)' };
const dateOf = (iso, lang) => (iso ? formatDate(new Date(iso), lang) : '');

// Where a master manages the account around their page: the link to share,
// the subscription, Telegram, their region settings, password, and — at the
// bottom — deleting it all.
export default function SettingsScreen({ T, lang, account, refreshAccount, onAuthError, setSessionToken, onLogout }) {
  const { master, access } = account;
  const [message, setMessage] = useState(null); // { section, key, error? }
  const [busy, setBusy] = useState(null);
  const say = (section, key, error = false) => setMessage({ section, key, error });
  const note = (section) =>
    message?.section === section && (
      <p role={message.error ? 'alert' : 'status'} style={{ margin: 0, fontSize: 13, color: message.error ? 'var(--terracotta)' : 'var(--sage)' }}>
        {T[message.key] ?? T.genericError}
      </p>
    );

  function failed(section, err) {
    if (onAuthError(err)) return;
    say(section, err instanceof ApiError && T[err.code] ? err.code : 'genericError', true);
  }

  // Coming back from Lemon Squeezy's checkout.
  useEffect(() => {
    if (window.location.hash.includes('billing=done')) {
      say('billing', 'billingDone');
      const timer = setTimeout(refreshAccount, 4000);
      return () => clearTimeout(timer);
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------------------------------------------------------------- page link
  const [copied, setCopied] = useState(false);
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(master.siteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked: the link is on screen to copy by hand.
    }
  }

  // ---------------------------------------------------------- subscription
  const stateText = {
    trial: T.stateTrial(dateOf(access.trialEndsAt, lang)),
    active: T.stateActive(dateOf(access.periodEndsAt, lang)),
    on_trial: T.stateOnTrial(dateOf(access.periodEndsAt, lang)),
    past_due: T.statePastDue,
    cancelled: T.stateCancelled(dateOf(access.periodEndsAt, lang)),
    expired: T.stateExpired,
    suspended: T.stateSuspended,
  }[access.state];
  const subscribed = ['active', 'on_trial', 'past_due', 'cancelled'].includes(access.state);

  async function subscribe() {
    setBusy('billing');
    try {
      const { url } = await api.startCheckout();
      window.location.href = url;
    } catch (err) {
      setBusy(null);
      failed('billing', err instanceof ApiError && err.status === 503 ? new ApiError(503, { error: 'billingUnavailable' }) : err);
    }
  }

  // -------------------------------------------------------------- telegram
  const [telegramOpened, setTelegramOpened] = useState(false);
  async function connectTelegram() {
    // Opened synchronously from the click so the browser doesn't block it as
    // a popup; pointed at the bot once the link arrives.
    const tab = window.open('', '_blank');
    try {
      const { url } = await api.connectTelegram();
      if (tab) tab.location.href = url;
      else window.location.href = url;
      setTelegramOpened(true);
    } catch (err) {
      tab?.close();
      failed('telegram', err);
    }
  }
  async function disconnectTelegram() {
    try {
      await api.disconnectTelegram();
      await refreshAccount();
    } catch (err) {
      failed('telegram', err);
    }
  }

  // ---------------------------------------------------------------- region
  const [region, setRegion] = useState({
    languages: master.languages,
    defaultLang: master.defaultLang,
    timezone: master.timezone,
    currency: master.currency,
    notifyLang: master.notifyLang,
  });
  function toggleLanguage(code) {
    const languages = region.languages.includes(code)
      ? region.languages.filter((l) => l !== code)
      : LANG_ORDER.filter((l) => l === code || region.languages.includes(l));
    if (languages.length === 0) return;
    setRegion({ ...region, languages, defaultLang: languages.includes(region.defaultLang) ? region.defaultLang : languages[0] });
  }
  async function saveRegion() {
    setBusy('region');
    try {
      await api.updateSettings(region);
      await refreshAccount();
      say('region', 'settingsSaved');
    } catch (err) {
      failed('region', err);
    } finally {
      setBusy(null);
    }
  }

  // -------------------------------------------------------------- password
  const [passwords, setPasswords] = useState({ current: '', next: '' });
  async function changePassword(e) {
    e.preventDefault();
    setBusy('password');
    try {
      const { token } = await api.changePassword(passwords.current, passwords.next);
      setSessionToken(token);
      setPasswords({ current: '', next: '' });
      say('password', 'passwordChanged');
    } catch (err) {
      failed('password', err);
    } finally {
      setBusy(null);
    }
  }

  // ---------------------------------------------------------------- delete
  const [deletePassword, setDeletePassword] = useState('');
  async function deleteAccount(e) {
    e.preventDefault();
    if (!window.confirm(T.deleteAccountHint)) return;
    try {
      await api.deleteAccount(deletePassword);
      onLogout();
    } catch (err) {
      failed('delete', err);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 720 }}>
      <h2 style={{ fontSize: 22, fontWeight: 500 }}>{T.settingsTitle}</h2>

      <Section title={T.yourPageSection}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <code style={{ fontSize: 14.5, padding: '8px 12px', borderRadius: 10, background: 'var(--bg)', wordBreak: 'break-all' }}>
            {master.siteUrl}
          </code>
          <button className="btn-outline" onClick={copyLink}>{copied ? T.copied : T.copyLink}</button>
          <a className="btn-primary" href={master.siteUrl} target="_blank" rel="noreferrer">{T.openPage}</a>
        </div>
      </Section>

      <Section title={T.subscriptionSection}>
        <p style={{ ...muted, color: ['expired', 'past_due', 'suspended'].includes(access.state) ? 'var(--terracotta)' : 'var(--ink)' }}>
          {stateText}
        </p>
        {access.state !== 'suspended' && (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {!subscribed || access.state === 'cancelled' ? (
              account.billingAvailable ? (
                <button className="btn-primary" onClick={subscribe} disabled={busy === 'billing'}>{T.subscribeBtn}</button>
              ) : (
                <p style={muted}>{T.billingUnavailable}</p>
              )
            ) : null}
            {access.customerPortalUrl && (
              <a className="btn-outline" href={access.customerPortalUrl} target="_blank" rel="noreferrer">{T.manageBillingBtn}</a>
            )}
          </div>
        )}
        {note('billing')}
      </Section>

      <Section title={T.telegramSection}>
        {!account.telegramAvailable ? (
          <p style={muted}>{T.telegramUnavailable}</p>
        ) : master.telegramConnected ? (
          <>
            <p style={{ ...muted, color: 'var(--sage)' }}>✓ {T.telegramConnected}</p>
            <div><button className="btn-outline" onClick={disconnectTelegram}>{T.disconnectBtn}</button></div>
          </>
        ) : (
          <>
            <p style={muted}>{T.telegramNotConnected}</p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button className="btn-primary" onClick={connectTelegram}>{T.connectTelegramBtn}</button>
              {telegramOpened && <button className="btn-outline" onClick={refreshAccount}>{T.checkAgain}</button>}
            </div>
            {telegramOpened && <p style={muted}>{T.telegramOpenHint}</p>}
          </>
        )}
        {note('telegram')}
      </Section>

      <Section title={T.regionSection}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>{T.languagesLabel}</span>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            {LANG_ORDER.map((code) => (
              <label key={code} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 }}>
                <input type="checkbox" checked={region.languages.includes(code)} onChange={() => toggleLanguage(code)} />
                {LANG_META[code].name}
              </label>
            ))}
          </div>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>{T.regionHint}</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12.5, color: 'var(--muted)' }}>
            {T.defaultLangLabel}
            <select className="field-input" value={region.defaultLang} onChange={(e) => setRegion({ ...region, defaultLang: e.target.value })}>
              {region.languages.map((code) => <option key={code} value={code}>{LANG_META[code].name}</option>)}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12.5, color: 'var(--muted)' }}>
            {T.notifyLangLabel}
            <select className="field-input" value={region.notifyLang} onChange={(e) => setRegion({ ...region, notifyLang: e.target.value })}>
              {LANG_ORDER.map((code) => <option key={code} value={code}>{LANG_META[code].name}</option>)}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12.5, color: 'var(--muted)' }}>
            {T.timezoneLabel}
            <select className="field-input" value={region.timezone} onChange={(e) => setRegion({ ...region, timezone: e.target.value })}>
              {timeZones().map((z) => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12.5, color: 'var(--muted)' }}>
            {T.currencyLabel}
            <select className="field-input" value={region.currency} onChange={(e) => setRegion({ ...region, currency: e.target.value })}>
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
        </div>
        <div><button className="btn-primary" onClick={saveRegion} disabled={busy === 'region'}>{T.saveBtn}</button></div>
        {note('region')}
      </Section>

      <Section title={T.passwordSection}>
        <form onSubmit={changePassword} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, alignItems: 'end' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12.5, color: 'var(--muted)' }}>
            {T.currentPasswordLabel}
            <input className="field-input" type="password" autoComplete="current-password" value={passwords.current} onChange={(e) => setPasswords({ ...passwords, current: e.target.value })} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12.5, color: 'var(--muted)' }}>
            {T.newPasswordLabel}
            <input className="field-input" type="password" autoComplete="new-password" value={passwords.next} onChange={(e) => setPasswords({ ...passwords, next: e.target.value })} />
          </label>
          <div><button type="submit" className="btn-outline" disabled={busy === 'password' || !passwords.current || !passwords.next}>{T.changePasswordBtn}</button></div>
        </form>
        {note('password')}
      </Section>

      <Section title={T.dangerSection}>
        <p style={muted}>{T.deleteAccountHint}</p>
        <form onSubmit={deleteAccount} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            className="field-input"
            style={{ maxWidth: 260 }}
            type="password"
            aria-label={T.deleteAccountPassword}
            placeholder={T.deleteAccountPassword}
            value={deletePassword}
            onChange={(e) => setDeletePassword(e.target.value)}
          />
          <button type="submit" className="btn-danger-outline" disabled={!deletePassword}>{T.deleteAccountBtn}</button>
        </form>
        {note('delete')}
      </Section>
    </div>
  );
}

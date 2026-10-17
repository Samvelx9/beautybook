import { useEffect, useState } from 'react';
import { api, ApiError } from '../api.js';
import { CURRENCIES } from '../options.js';

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

      <PlatformSettings T={T} onAuthError={onAuthError} />
    </div>
  );
}

// The advertised monthly prices (welcome page, billing) — an individual
// master's, and a salon's by plan — and the support email the privacy policy
// points to. Prices are typed as amounts ("10" or "9.99") and stored in cents.
const SALON_PLANS = ['salon_5', 'salon_10', 'salon_unlimited'];
const toAmount = (minor) => String(minor / 100);
const toMinor = (amount) => {
  const n = Number(String(amount).replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
};

function PlatformSettings({ T, onAuthError }) {
  const [form, setForm] = useState(null); // { price: '10', currency: 'USD', supportEmail: '' }
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null); // { key, error }

  useEffect(() => {
    api
      .getPlatformSettings()
      .then((settings) =>
        setForm({
          price: toAmount(settings.priceMonthlyMinor),
          salonPrices: Object.fromEntries(SALON_PLANS.map((p) => [p, toAmount(settings.salonPricesMinor[p])])),
          currency: settings.priceCurrency,
          supportEmail: settings.supportEmail ?? '',
        })
      )
      .catch((err) => {
        if (!onAuthError(err)) setMessage({ key: 'genericError', error: true });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save(e) {
    e.preventDefault();
    const price = toMinor(form.price);
    const salonPricesMinor = Object.fromEntries(SALON_PLANS.map((p) => [p, toMinor(form.salonPrices[p])]));
    if (price === null || Object.values(salonPricesMinor).includes(null)) {
      setMessage({ key: 'invalid_price', error: true });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await api.updatePlatformSettings({
        priceMonthlyMinor: price,
        salonPricesMinor,
        priceCurrency: form.currency,
        supportEmail: form.supportEmail.trim() || null,
      });
      setMessage({ key: 'settingsSaved', error: false });
    } catch (err) {
      if (!onAuthError(err)) {
        setMessage({ key: err instanceof ApiError && T[err.code] ? err.code : 'genericError', error: true });
      }
    } finally {
      setBusy(false);
    }
  }

  const label = { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12.5, color: 'var(--muted)' };
  const set = (fields) => {
    setForm((prev) => ({ ...prev, ...fields }));
    setMessage(null);
  };

  return (
    <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h3 style={{ fontSize: 18, fontWeight: 500 }}>{T.pricingSection}</h3>
      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: 'var(--muted)' }}>{T.pricingHint}</p>
      {!form ? (
        !message && <p style={{ margin: 0, color: 'var(--muted)' }}>{T.loading}</p>
      ) : (
        <form onSubmit={save} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <label style={{ ...label, flex: '1 1 140px' }}>
              {T.priceMonthlyLabel}
              <input
                className="field-input"
                inputMode="decimal"
                value={form.price}
                onChange={(e) => set({ price: e.target.value })}
              />
            </label>
            <label style={{ ...label, flex: '1 1 140px' }}>
              {T.currencyLabel}
              <select className="field-input" value={form.currency} onChange={(e) => set({ currency: e.target.value })}>
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {SALON_PLANS.map((plan) => (
              <label key={plan} style={{ ...label, flex: '1 1 140px' }}>
                {T.salonPlanPriceLabel(T.planNames[plan])}
                <input
                  className="field-input"
                  inputMode="decimal"
                  value={form.salonPrices[plan]}
                  onChange={(e) => set({ salonPrices: { ...form.salonPrices, [plan]: e.target.value } })}
                />
              </label>
            ))}
          </div>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--muted)' }}>{T.salonPricesHint}</p>
          <label style={label}>
            {T.supportEmailLabel}
            <input
              className="field-input"
              type="email"
              autoComplete="email"
              value={form.supportEmail}
              onChange={(e) => set({ supportEmail: e.target.value })}
            />
            <span style={{ fontSize: 12 }}>{T.supportEmailHint}</span>
          </label>
          <div>
            <button type="submit" className="btn-primary" disabled={busy}>
              {T.saveBtn}
            </button>
          </div>
        </form>
      )}
      {message && (
        <p role={message.error ? 'alert' : 'status'} style={{ margin: 0, fontSize: 13, color: message.error ? 'var(--terracotta)' : 'var(--sage)' }}>
          {T[message.key]}
        </p>
      )}
    </section>
  );
}

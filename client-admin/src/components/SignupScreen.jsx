import { useEffect, useRef, useState } from 'react';
import LangSwitcher from './LangSwitcher.jsx';
import { api, ApiError } from '../api.js';
import { LANG_META, LANG_ORDER, PLATFORM_DOMAIN, PRODUCT_NAME } from '../i18n.js';
import { CURRENCIES, browserTimeZone, guessCurrency, timeZones } from '../options.js';
import { suggestSlug } from '../slug.js';

function Field({ id, label, hint, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label htmlFor={id} style={{ fontSize: 12.5, color: 'var(--muted)' }}>{label}</label>
      {children}
      {hint && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{hint}</span>}
    </div>
  );
}

export default function SignupScreen({ T, lang, setLang, go, onSignedUp }) {
  const zone = browserTimeZone();
  const [form, setForm] = useState({
    // 'master': an individual master. 'salon': a salon and its owner, who may
    // also work as one of its masters (`ownerIsMaster`).
    accountType: 'master',
    salonName: '',
    ownerIsMaster: false,
    displayName: '',
    slug: '',
    email: '',
    password: '',
    languages: [...LANG_ORDER],
    defaultLang: lang,
    timezone: zone,
    currency: guessCurrency(zone),
    templates: [],
  });
  // Once the address has been typed by hand, the name no longer rewrites it.
  const [slugEdited, setSlugEdited] = useState(false);
  const [slugStatus, setSlugStatus] = useState(null); // null | 'checking' | 'ok' | error code
  const [templates, setTemplates] = useState([]);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const slugRequest = useRef(0);

  const set = (fields) => setForm((prev) => ({ ...prev, ...fields }));

  useEffect(() => {
    api.getTemplates().then(setTemplates).catch(() => setTemplates([]));
  }, []);

  // Asks whether the address is free a moment after typing stops; only the
  // newest answer counts.
  useEffect(() => {
    if (!form.slug) {
      setSlugStatus(null);
      return undefined;
    }
    setSlugStatus('checking');
    const id = slugRequest.current + 1;
    slugRequest.current = id;
    const timer = setTimeout(() => {
      api
        .checkSlug(form.slug)
        .then((r) => slugRequest.current === id && setSlugStatus(r.available ? 'ok' : r.reason))
        .catch(() => slugRequest.current === id && setSlugStatus(null));
    }, 350);
    return () => clearTimeout(timer);
  }, [form.slug]);

  function onNameChange(value) {
    set(slugEdited ? { displayName: value } : { displayName: value, slug: suggestSlug(value) });
  }

  function toggleLanguage(code) {
    const languages = form.languages.includes(code)
      ? form.languages.filter((l) => l !== code)
      : LANG_ORDER.filter((l) => l === code || form.languages.includes(l));
    if (languages.length === 0) return;
    set({ languages, defaultLang: languages.includes(form.defaultLang) ? form.defaultLang : languages[0] });
  }

  function toggleTemplate(key) {
    set({
      templates: form.templates.includes(key)
        ? form.templates.filter((k) => k !== key)
        : [...form.templates, key],
    });
  }

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    const isSalon = form.accountType === 'salon';
    const withPage = !isSalon || form.ownerIsMaster;
    if (isSalon && !form.salonName.trim()) return setError('missing_salon_name');
    if (withPage && !form.displayName.trim()) return setError('missing_display_name');
    if (form.password.length < 8) return setError('weak_password');
    if (withPage && slugStatus && slugStatus !== 'ok' && slugStatus !== 'checking') return setError(slugStatus);

    // A salon's owner without a page of their own sends neither name nor address.
    const payload = { ...form, notifyLang: lang };
    delete payload.ownerIsMaster;
    if (!withPage) {
      delete payload.displayName;
      delete payload.slug;
    }
    setSubmitting(true);
    try {
      const { token } = await api.signup(payload);
      onSignedUp(token);
    } catch (err) {
      setError(err instanceof ApiError && T[err.code] ? err.code : 'genericError');
      setSubmitting(false);
    }
  }

  const slugMessage =
    slugStatus === 'ok' ? (
      <span style={{ color: 'var(--sage)', fontWeight: 600 }}>✓ {T.slugAvailable}</span>
    ) : slugStatus && slugStatus !== 'checking' ? (
      <span style={{ color: 'var(--terracotta)' }}>{T[slugStatus] ?? T.invalid_slug}</span>
    ) : null;

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <div
        className="admin-content"
        style={{ flex: 'none', padding: '20px 20px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}
      >
        <a href="#welcome" onClick={(e) => { e.preventDefault(); go('welcome'); }} style={{ fontFamily: "'Newsreader',serif", fontSize: 20, color: 'var(--ink)' }}>
          {PRODUCT_NAME}
        </a>
        <LangSwitcher lang={lang} setLang={setLang} />
      </div>

      <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: '28px 16px 48px' }}>
        <form onSubmit={onSubmit} className="card" style={{ width: '100%', maxWidth: 520, display: 'flex', flexDirection: 'column', gap: 18 }} noValidate>
          <h2 style={{ fontSize: 24, fontWeight: 500, textAlign: 'center' }}>{form.accountType === 'salon' ? T.signupSalonTitle : T.signupTitle}</h2>

          <div role="radiogroup" aria-label={T.accountTypeLabel} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {['master', 'salon'].map((type) => {
              const on = form.accountType === type;
              return (
                <button
                  type="button"
                  key={type}
                  role="radio"
                  aria-checked={on}
                  onClick={() => set({ accountType: type })}
                  style={{
                    padding: '12px 14px',
                    borderRadius: 12,
                    textAlign: 'left',
                    border: `1.5px solid ${on ? 'var(--sage)' : 'var(--line)'}`,
                    background: on ? 'var(--sage-light)' : 'var(--white)',
                    color: 'var(--ink)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                  }}
                >
                  <span style={{ fontSize: 14.5, fontWeight: 600 }}>{type === 'salon' ? T.accountSalon : T.accountMaster}</span>
                  <span style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.4 }}>
                    {type === 'salon' ? T.accountSalonHint : T.accountMasterHint}
                  </span>
                </button>
              );
            })}
          </div>

          {form.accountType === 'salon' && (
            <>
              <Field id="su-salon" label={T.salonNameLabel}>
                <input id="su-salon" className="field-input" value={form.salonName} onChange={(e) => set({ salonName: e.target.value })} />
              </Field>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
                <input type="checkbox" checked={form.ownerIsMaster} onChange={(e) => set({ ownerIsMaster: e.target.checked })} />
                {T.ownerIsMasterLabel}
              </label>
            </>
          )}

          {(form.accountType === 'master' || form.ownerIsMaster) && (
          <>
          <Field id="su-name" label={T.displayNameLabel}>
            <input id="su-name" className="field-input" value={form.displayName} onChange={(e) => onNameChange(e.target.value)} autoFocus />
          </Field>

          <Field id="su-slug" label={T.slugLabel}>
            <div style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--line)', borderRadius: 10, background: 'var(--surface)', overflow: 'hidden' }}>
              <input
                id="su-slug"
                className="field-input"
                style={{ border: 'none', borderRadius: 0, flex: 1, minWidth: 0 }}
                value={form.slug}
                autoCapitalize="none"
                spellCheck={false}
                onChange={(e) => {
                  setSlugEdited(true);
                  set({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40) });
                }}
              />
              <span style={{ padding: '0 12px', fontSize: 13.5, color: 'var(--muted)', whiteSpace: 'nowrap' }}>.{PLATFORM_DOMAIN}</span>
            </div>
            <span style={{ fontSize: 12.5, minHeight: 16 }}>{slugMessage}</span>
          </Field>
          </>
          )}

          <Field id="su-email" label={T.emailLabel}>
            <input id="su-email" className="field-input" type="email" autoComplete="email" value={form.email} onChange={(e) => set({ email: e.target.value })} />
          </Field>

          <Field id="su-password" label={T.passwordLabel} hint={T.passwordHint}>
            <input id="su-password" className="field-input" type="password" autoComplete="new-password" value={form.password} onChange={(e) => set({ password: e.target.value })} />
          </Field>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>{T.languagesLabel}</span>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              {LANG_ORDER.map((code) => (
                <label key={code} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 }}>
                  <input type="checkbox" checked={form.languages.includes(code)} onChange={() => toggleLanguage(code)} />
                  {LANG_META[code].name}
                </label>
              ))}
            </div>
            {form.languages.length > 1 && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5 }}>
                {T.defaultLangLabel}
                <select className="field-input" style={{ width: 'auto' }} value={form.defaultLang} onChange={(e) => set({ defaultLang: e.target.value })}>
                  {form.languages.map((code) => (
                    <option key={code} value={code}>{LANG_META[code].name}</option>
                  ))}
                </select>
              </label>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
            <Field id="su-tz" label={T.timezoneLabel}>
              <select id="su-tz" className="field-input" value={form.timezone} onChange={(e) => set({ timezone: e.target.value })}>
                {timeZones().map((z) => (
                  <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </Field>
            <Field id="su-currency" label={T.currencyLabel}>
              <select id="su-currency" className="field-input" value={form.currency} onChange={(e) => set({ currency: e.target.value })}>
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </Field>
          </div>

          {templates.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>{T.templatesLabel}</span>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {templates.map((t) => {
                  const on = form.templates.includes(t.key);
                  return (
                    <button
                      type="button"
                      key={t.key}
                      onClick={() => toggleTemplate(t.key)}
                      aria-pressed={on}
                      style={{
                        padding: '8px 14px',
                        borderRadius: 999,
                        fontSize: 13.5,
                        border: `1.5px solid ${on ? 'var(--sage)' : 'var(--line)'}`,
                        background: on ? 'var(--sage-light)' : 'var(--white)',
                        color: 'var(--ink)',
                      }}
                    >
                      {on ? '✓ ' : ''}{t.label[lang] ?? t.label.en}
                    </button>
                  );
                })}
              </div>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>{T.templatesHint}</span>
            </div>
          )}

          {error && <p role="alert" style={{ margin: 0, fontSize: 13, color: 'var(--terracotta)' }}>{T[error] ?? T.genericError}</p>}

          <button type="submit" className="btn-primary" disabled={submitting} style={{ padding: '13px 18px', fontSize: 15 }}>
            {submitting ? T.signingUp : form.accountType === 'salon' ? T.signupSalonBtn : T.signupBtn}
          </button>
          <p style={{ margin: 0, fontSize: 12.5, textAlign: 'center', color: 'var(--muted)' }}>{T.heroNoCard}</p>
          {/* Opens in a new tab so a half-filled form isn't lost. */}
          <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, textAlign: 'center', color: 'var(--muted)' }}>
            {T.signupConsent.split('{link}')[0]}
            <a href="#privacy" target="_blank" rel="noreferrer">
              {T.signupConsentLink}
            </a>
            {T.signupConsent.split('{link}')[1]}
          </p>

          <p style={{ margin: 0, fontSize: 13, textAlign: 'center', color: 'var(--muted)' }}>
            {T.haveAccount}{' '}
            <a href="#login" onClick={(e) => { e.preventDefault(); go('login'); }} style={{ fontWeight: 600 }}>
              {T.loginLink}
            </a>
          </p>
        </form>
      </div>
    </div>
  );
}

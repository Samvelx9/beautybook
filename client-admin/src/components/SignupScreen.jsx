import { useEffect, useRef, useState } from 'react';
import LangSwitcher from './LangSwitcher.jsx';
import { api, ApiError } from '../api.js';
import { LANG_META, LANG_ORDER, PLATFORM_DOMAIN, PRODUCT_NAME } from '../i18n.js';
import { CURRENCIES, browserTimeZone, guessCurrency, timeZones } from '../options.js';

// Most masters will type their name in Armenian or Cyrillic, but a page
// address is Latin — so the suggested address is transliterated from it.
const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k',
  л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts',
  ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  ա: 'a', բ: 'b', գ: 'g', դ: 'd', ե: 'e', զ: 'z', է: 'e', ը: 'y', թ: 't', ժ: 'zh', ի: 'i', լ: 'l',
  խ: 'kh', ծ: 'ts', կ: 'k', հ: 'h', ձ: 'dz', ղ: 'gh', ճ: 'ch', մ: 'm', յ: 'y', ն: 'n', շ: 'sh',
  ո: 'o', չ: 'ch', պ: 'p', ջ: 'j', ռ: 'r', ս: 's', վ: 'v', տ: 't', ր: 'r', ց: 'ts', ւ: 'v',
  փ: 'p', ք: 'k', օ: 'o', ֆ: 'f', և: 'ev',
};

function suggestSlug(name) {
  return [...name.toLowerCase()]
    .map((ch) => TRANSLIT[ch] ?? ch)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
}

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
    if (!form.displayName.trim()) return setError('missing_display_name');
    if (form.password.length < 8) return setError('weak_password');
    if (slugStatus && slugStatus !== 'ok' && slugStatus !== 'checking') return setError(slugStatus);

    setSubmitting(true);
    try {
      const { token } = await api.signup({ ...form, notifyLang: lang });
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
      <div style={{ padding: '20px 24px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <a href="#welcome" onClick={(e) => { e.preventDefault(); go('welcome'); }} style={{ fontFamily: "'Newsreader',serif", fontSize: 18, color: 'var(--ink)' }}>
          {PRODUCT_NAME}
        </a>
        <LangSwitcher lang={lang} setLang={setLang} />
      </div>

      <div style={{ flex: 1, display: 'flex', justifyContent: 'center', padding: '28px 16px 48px' }}>
        <form onSubmit={onSubmit} className="card" style={{ width: '100%', maxWidth: 520, display: 'flex', flexDirection: 'column', gap: 18 }} noValidate>
          <h2 style={{ fontSize: 24, fontWeight: 500, textAlign: 'center' }}>{T.signupTitle}</h2>

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
            {submitting ? T.signingUp : T.signupBtn}
          </button>
          <p style={{ margin: 0, fontSize: 12.5, textAlign: 'center', color: 'var(--muted)' }}>{T.heroNoCard}</p>

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

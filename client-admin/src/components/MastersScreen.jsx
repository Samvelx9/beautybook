import { useEffect, useState } from 'react';
import { api, ApiError } from '../api.js';
import { PLATFORM_DOMAIN, localName } from '../i18n.js';
import { suggestSlug, useSlugStatus } from '../slug.js';
import ConfirmInline from './ConfirmInline.jsx';

const muted = { margin: 0, fontSize: 13, lineHeight: 1.5, color: 'var(--muted)' };

// A salon owner's masters: adding one (with a login of their own, or the owner
// themselves), which services each performs, deactivating, and resetting a
// master's password. The plan line on top follows the number of masters
// working.
export default function MastersScreen({ T, lang, account, salon, refreshSalon, refreshAccount, onAuthError }) {
  const [categories, setCategories] = useState([]);
  const [services, setServices] = useState([]);
  const [error, setError] = useState(null);
  // What the last added master needs to sign in: shown once, to pass on.
  const [credentials, setCredentials] = useState(null);

  useEffect(() => {
    Promise.all([api.getCategories(), api.getServices()])
      .then(([cats, svcs]) => {
        setCategories(cats);
        setServices(svcs);
      })
      .catch((err) => onAuthError(err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function failed(err) {
    if (onAuthError(err)) return;
    setError(err instanceof ApiError && T[err.code] ? err.code : 'genericError');
  }

  if (!salon) return <p style={{ color: 'var(--muted)' }}>{T.loading}</p>;
  const ownerHasCalendar = Boolean(account.master);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 820 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <h2 style={{ fontSize: 22, fontWeight: 500 }}>{T.mastersTitle}</h2>
        <p style={muted}>{T.salonPlan(salon.activeMasters, T.planNames[salon.plan])}</p>
      </div>

      {error && <p role="alert" style={{ margin: 0, fontSize: 13, color: 'var(--terracotta)' }}>{T[error] ?? T.genericError}</p>}

      {credentials && (
        <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8, borderColor: 'var(--sage)' }}>
          <h3 style={{ fontSize: 16, fontWeight: 600 }}>{T.masterAddedTitle(credentials.name)}</h3>
          <p style={muted}>{T.masterAddedHint}</p>
          <Credential label={T.emailLabel} value={credentials.email} T={T} />
          <Credential label={T.passwordLabel} value={credentials.password} T={T} />
          <div><button className="btn-outline" onClick={() => setCredentials(null)}>{T.doneBtn}</button></div>
        </section>
      )}

      <AddMasterForm
        T={T}
        title={T.addMasterTitle}
        withEmail
        onAdded={async (body, name) => {
          setError(null);
          setCredentials({ name, email: body.email, password: body.password });
          await refreshSalon();
        }}
        onError={failed}
      />

      {!ownerHasCalendar && (
        <AddMasterForm
          T={T}
          title={T.addSelfTitle}
          hint={T.addSelfHint}
          onAdded={async () => {
            setError(null);
            await refreshSalon();
            await refreshAccount();
          }}
          onError={failed}
        />
      )}

      {salon.masters.length === 0 ? (
        <p style={muted}>{T.noMastersYet}</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {salon.masters.map((m) => (
            <MasterCard
              key={m.id}
              T={T}
              lang={lang}
              master={m}
              categories={categories}
              services={services}
              onChanged={refreshSalon}
              onError={failed}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Credential({ T, label, value }) {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 12.5, color: 'var(--muted)', minWidth: 70 }}>{label}</span>
      <code style={{ fontSize: 14.5, padding: '6px 10px', borderRadius: 8, background: 'var(--bg)' }}>{value}</code>
      <button
        className="btn-outline"
        onClick={() => {
          navigator.clipboard?.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }).catch(() => {});
        }}
      >
        {copied ? T.copied : T.copyBtn}
      </button>
    </div>
  );
}

// A new master: name, page address and — for anyone but the owner — the email
// they'll sign in with.
function AddMasterForm({ T, title, hint, withEmail = false, onAdded, onError }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ displayName: '', slug: '', email: '' });
  const [slugEdited, setSlugEdited] = useState(false);
  const slugStatus = useSlugStatus(form.slug);
  const [saving, setSaving] = useState(false);


  async function submit(e) {
    e.preventDefault();
    if (!form.displayName.trim() || !form.slug || (withEmail && !form.email.trim())) return;
    setSaving(true);
    try {
      const body = await api.addMaster(
        withEmail
          ? { displayName: form.displayName.trim(), slug: form.slug, email: form.email.trim() }
          : { self: true, displayName: form.displayName.trim(), slug: form.slug }
      );
      const name = form.displayName.trim();
      setForm({ displayName: '', slug: '', email: '' });
      setSlugEdited(false);
      setOpen(false);
      await onAdded(body, name);
    } catch (err) {
      onError(err);
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button className={withEmail ? 'btn-primary' : 'btn-outline'} onClick={() => setOpen(true)}>{title}</button>
        {hint && <span style={muted}>{hint}</span>}
      </div>
    );
  }

  const label = { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12.5, color: 'var(--muted)' };
  return (
    <form onSubmit={submit} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12, borderLeft: '3px solid var(--sage)' }}>
      <h3 style={{ fontSize: 16, fontWeight: 600 }}>{title}</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        <label style={label}>
          {withEmail ? T.masterNameLabel : T.displayNameLabel}
          <input
            className="field-input"
            value={form.displayName}
            autoFocus
            onChange={(e) =>
              setForm(slugEdited
                ? { ...form, displayName: e.target.value }
                : { ...form, displayName: e.target.value, slug: suggestSlug(e.target.value) })
            }
          />
        </label>
        <label style={label}>
          {withEmail ? T.masterSlugLabel : T.slugLabel}
          <div style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--line)', borderRadius: 10, background: 'var(--surface)', overflow: 'hidden' }}>
            <input
              className="field-input"
              style={{ border: 'none', borderRadius: 0, flex: 1, minWidth: 0 }}
              value={form.slug}
              autoCapitalize="none"
              spellCheck={false}
              onChange={(e) => {
                setSlugEdited(true);
                setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40) });
              }}
            />
            <span style={{ padding: '0 10px', fontSize: 12.5, whiteSpace: 'nowrap' }}>.{PLATFORM_DOMAIN}</span>
          </div>
          <span style={{ fontSize: 12, minHeight: 15, color: slugStatus === 'ok' ? 'var(--sage)' : 'var(--terracotta)' }}>
            {slugStatus === 'ok' ? `✓ ${T.slugAvailable}` : slugStatus ? (T[slugStatus] ?? T.invalid_slug) : ''}
          </span>
        </label>
        {withEmail && (
          <label style={label}>
            {T.masterEmailLabel}
            <input className="field-input" type="email" autoComplete="off" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </label>
        )}
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <button type="submit" className="btn-primary" disabled={saving || (slugStatus && slugStatus !== 'ok')}>
          {T.addBtn}
        </button>
        <button type="button" className="btn-outline" onClick={() => setOpen(false)} disabled={saving}>{T.cancelBtn}</button>
      </div>
    </form>
  );
}

function MasterCard({ T, lang, master, categories, services, onChanged, onError }) {
  // null | 'deactivate' | 'reset'
  const [confirming, setConfirming] = useState(null);
  const [newPassword, setNewPassword] = useState(null);
  const [editingServices, setEditingServices] = useState(false);
  const [chosen, setChosen] = useState(() => new Set(master.serviceIds));
  // The share being typed, while it's being changed.
  const [shareDraft, setShareDraft] = useState(null);
  // A new page address being typed, while it's being changed.
  const [slugDraft, setSlugDraft] = useState(null);
  const [busy, setBusy] = useState(false);

  async function act(fn) {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  }

  const setActive = (active) => act(async () => {
    await api.updateMaster(master.id, { active });
    await onChanged();
  });
  const resetPassword = () => act(async () => {
    const { password } = await api.resetMasterLogin(master.id);
    setNewPassword(password);
  });
  const saveServices = () => act(async () => {
    await api.updateMaster(master.id, { serviceIds: [...chosen] });
    setEditingServices(false);
    await onChanged();
  });

  const saveSlug = () => act(async () => {
    await api.updateMaster(master.id, { slug: slugDraft });
    setSlugDraft(null);
    await onChanged();
  });
  const saveShare = (sharePercent) => act(async () => {
    await api.updateMaster(master.id, { sharePercent });
    setShareDraft(null);
    await onChanged();
  });
  const draftValid =
    shareDraft !== null && shareDraft !== '' && Number.isInteger(Number(shareDraft)) &&
    Number(shareDraft) >= 0 && Number(shareDraft) <= 100;

  const toggle = (id) => {
    const next = new Set(chosen);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setChosen(next);
  };

  const performed = services.filter((s) => master.serviceIds.includes(s.id));
  return (
    <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10, opacity: master.active ? 1 : 0.7 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
          <span style={{ fontSize: 16, fontWeight: 600 }}>
            {master.name || master.slug}
            {master.isOwner && <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--sage)' }}> · {T.pickerYou}</span>}
            {!master.active && <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--terracotta)' }}> · {T.masterInactive}</span>}
          </span>
          {slugDraft === null ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <a href={master.siteUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, wordBreak: 'break-all' }}>
                {master.siteUrl.replace(/^https?:\/\//, '')} ↗
              </a>
              <button onClick={() => setSlugDraft(master.slug)} style={{ fontSize: 12, fontWeight: 600, color: 'var(--sage)' }}>
                {T.changeAddressBtn}
              </button>
            </span>
          ) : (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <input
                className="field-input"
                aria-label={T.slugLabel}
                style={{ width: 180, padding: '4px 8px' }}
                value={slugDraft}
                autoCapitalize="none"
                spellCheck={false}
                onChange={(e) => setSlugDraft(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40))}
              />
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>.{PLATFORM_DOMAIN}</span>
              <button className="btn-primary" onClick={saveSlug} disabled={busy || !slugDraft || slugDraft === master.slug}>{T.saveBtn}</button>
              <button className="btn-outline" onClick={() => setSlugDraft(null)} disabled={busy}>{T.cancelBtn}</button>
              <span style={{ fontSize: 12, color: 'var(--terracotta)', flexBasis: '100%' }}>{T.changeAddressWarning}</span>
            </span>
          )}
          <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>
            {master.email}
            {' · '}
            {master.telegramConnected ? `✓ ${T.masterTelegramOn}` : T.masterTelegramOff}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {confirming === 'deactivate' ? (
            <ConfirmInline
              T={T}
              message={T.confirmDeactivateMaster}
              confirmLabel={T.deactivateBtn}
              onConfirm={() => setActive(false)}
              onCancel={() => setConfirming(null)}
              busy={busy}
            />
          ) : confirming === 'reset' ? (
            <ConfirmInline
              T={T}
              message={T.confirmResetMasterPassword}
              confirmLabel={T.resetPasswordBtn}
              onConfirm={resetPassword}
              onCancel={() => setConfirming(null)}
              busy={busy}
            />
          ) : (
            <>
              {!master.isOwner && master.active && (
                <button className="btn-outline" onClick={() => setConfirming('reset')}>{T.resetPasswordBtn}</button>
              )}
              {master.active ? (
                <button className="btn-danger-outline" onClick={() => setConfirming('deactivate')}>{T.deactivateBtn}</button>
              ) : (
                <button className="btn-outline" onClick={() => setActive(true)} disabled={busy}>{T.reactivateBtn}</button>
              )}
            </>
          )}
        </div>
      </div>

      {newPassword && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <p style={muted}>{T.newPasswordHint}</p>
          <Credential T={T} label={T.passwordLabel} value={newPassword} />
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        {master.isOwner ? (
          <span style={{ fontSize: 13 }}>{T.ownerKeepsAll}</span>
        ) : shareDraft === null ? (
          <>
            <span style={{ fontSize: 13 }}>
              {T.masterShareLine(master.effectiveSharePercent)}
              <span style={{ color: 'var(--muted)' }}>
                {' · '}{master.sharePercent === null ? T.shareFromSalon : T.shareOwn}
              </span>
            </span>
            <button
              onClick={() => setShareDraft(String(master.effectiveSharePercent))}
              style={{ fontSize: 13, fontWeight: 600, color: 'var(--sage)' }}
            >
              {T.changeBtn} →
            </button>
          </>
        ) : (
          <>
            <label htmlFor={`share-${master.id}`} style={{ fontSize: 13 }}>{T.masterShareShort}</label>
            <input
              id={`share-${master.id}`}
              className="field-input"
              style={{ width: 80 }}
              type="number"
              min={0}
              max={100}
              value={shareDraft}
              onChange={(e) => setShareDraft(e.target.value)}
            />
            <span style={{ fontSize: 13 }}>%</span>
            <button className="btn-primary" onClick={() => saveShare(Number(shareDraft))} disabled={busy || !draftValid}>{T.saveBtn}</button>
            {master.sharePercent !== null && (
              <button className="btn-outline" onClick={() => saveShare(null)} disabled={busy}>{T.useSalonShareBtn}</button>
            )}
            <button className="btn-outline" onClick={() => setShareDraft(null)} disabled={busy}>{T.cancelBtn}</button>
          </>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13 }}>
          {T.masterServicesCount(performed.length, services.length)}
        </span>
        {!editingServices && (
          <button
            onClick={() => {
              setChosen(new Set(master.serviceIds));
              setEditingServices(true);
            }}
            style={{ fontSize: 13, fontWeight: 600, color: 'var(--sage)' }}
          >
            {T.chooseServicesBtn} →
          </button>
        )}
      </div>

      {editingServices && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 12, borderRadius: 10, background: 'var(--bg)' }}>
          {categories.map((c) => {
            const rows = services.filter((s) => s.category_id === c.id);
            if (rows.length === 0) return null;
            const allOn = rows.every((s) => chosen.has(s.id));
            return (
              <fieldset key={c.id} style={{ border: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <legend style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                  <input
                    type="checkbox"
                    checked={allOn}
                    aria-label={localName(c, lang)}
                    onChange={() => {
                      const next = new Set(chosen);
                      for (const s of rows) {
                        if (allOn) next.delete(s.id);
                        else next.add(s.id);
                      }
                      setChosen(next);
                    }}
                  />
                  {localName(c, lang)}
                </legend>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', paddingLeft: 24 }}>
                  {rows.map((s) => (
                    <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13.5, color: s.is_active ? 'var(--ink)' : 'var(--muted)' }}>
                      <input type="checkbox" checked={chosen.has(s.id)} onChange={() => toggle(s.id)} />
                      {localName(s, lang)}
                    </label>
                  ))}
                </div>
              </fieldset>
            );
          })}
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn-primary" onClick={saveServices} disabled={busy}>{T.saveBtn}</button>
            <button className="btn-outline" onClick={() => setEditingServices(false)} disabled={busy}>{T.cancelBtn}</button>
          </div>
        </div>
      )}
    </section>
  );
}

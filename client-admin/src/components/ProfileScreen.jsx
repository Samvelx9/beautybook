import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { getMasterLanguages } from '../i18n.js';

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_PHOTO_BYTES = 4 * 1024 * 1024;

// Every editable field, in the order a guest reads them on the landing page.
// `langs: true` expands one entry into the three per-language inputs.
const SECTIONS = [
  {
    titleKey: 'profileIntroSection',
    fields: [
      { base: 'ownerName', labelKey: 'ownerNameLabel', langs: true },
      { base: 'tagline', labelKey: 'taglineLabel', langs: true },
    ],
  },
  {
    titleKey: 'profileAboutSection',
    fields: [{ base: 'about', labelKey: 'aboutLabel', langs: true, multiline: true }],
  },
  {
    titleKey: 'profileContactsSection',
    fields: [
      { base: 'phone', labelKey: 'phoneFieldLabel' },
      { base: 'whatsapp', labelKey: 'whatsappFieldLabel' },
      { base: 'telegram', labelKey: 'telegramFieldLabel' },
      { base: 'instagram', labelKey: 'instagramFieldLabel' },
      { base: 'email', labelKey: 'emailFieldLabel' },
    ],
  },
  {
    titleKey: 'profileAddressSection',
    fields: [
      { base: 'address', labelKey: 'addressLabel', langs: true, multiline: true },
      { base: 'mapUrl', labelKey: 'mapUrlLabel' },
    ],
  },
];

const LANG_SUFFIX = [
  { suffix: 'Hy', labelKey: 'inArmenian' },
  { suffix: 'Ru', labelKey: 'inRussian' },
  { suffix: 'En', labelKey: 'inEnglish' },
];

export default function ProfileScreen({ T, onAuthError, account }) {
  const [profile, setProfile] = useState(null);
  const [form, setForm] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);

  async function load() {
    setLoading(true);
    try {
      const data = await api.getProfile();
      setProfile(data);
      setForm(data);
    } catch (err) {
      if (!onAuthError(err)) setError('genericError');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      // photoVersion is read-only on the server; sending the rest as-is keeps
      // this form a plain "what you see is what gets stored".
      const { photoVersion: _photoVersion, ...payload } = form;
      const updated = await api.updateProfile(payload);
      setProfile(updated);
      setForm(updated);
      setSaved(true);
    } catch (err) {
      if (!onAuthError(err)) setError('genericError');
    } finally {
      setSaving(false);
    }
  }

  async function onPhotoPicked(event) {
    const file = event.target.files?.[0];
    event.target.value = ''; // let the same file be re-picked after an error
    if (!file) return;

    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError('profilePhotoWrongType');
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      setError('profilePhotoTooBig');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const updated = await api.uploadPhoto(file);
      setProfile(updated);
      setForm((prev) => ({ ...prev, photoVersion: updated.photoVersion }));
    } catch (err) {
      if (!onAuthError(err)) setError('genericError');
    } finally {
      setSaving(false);
    }
  }

  async function removePhoto() {
    setSaving(true);
    setError(null);
    try {
      const updated = await api.deletePhoto();
      setProfile(updated);
      setForm((prev) => ({ ...prev, photoVersion: null }));
    } catch (err) {
      if (!onAuthError(err)) setError('genericError');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p style={{ color: 'var(--muted)' }}>{T.loading}</p>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <h2 style={{ fontSize: 22, fontWeight: 500 }}>{T.profileTitle}</h2>
        <p style={{ margin: '6px 0 0', fontSize: 13.5, color: 'var(--muted)', maxWidth: 620 }}>
          {T.profileCaption}
        </p>
      </div>

      {error && <p style={{ margin: 0, fontSize: 13, color: 'var(--terracotta)' }}>{T[error]}</p>}

      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h3 style={{ fontSize: 16, fontWeight: 500 }}>{T.profilePhotoSection}</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
          {profile?.photoVersion ? (
            <img
              src={api.photoUrl(account.master.siteUrl, profile.photoVersion)}
              alt=""
              style={{
                width: 104,
                height: 104,
                borderRadius: '50%',
                objectFit: 'cover',
                border: '3px solid var(--white)',
                boxShadow: '0 8px 20px -10px rgba(0,0,0,0.4)',
              }}
            />
          ) : (
            <div
              style={{
                width: 104,
                height: 104,
                borderRadius: '50%',
                background: 'var(--sage-light)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 12,
                color: 'var(--muted)',
                textAlign: 'center',
                padding: 12,
              }}
            >
              {T.profileNoPhoto}
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button className="btn-primary" onClick={() => fileInputRef.current?.click()} disabled={saving}>
                {profile?.photoVersion ? T.profileReplacePhoto : T.profileChoosePhoto}
              </button>
              {profile?.photoVersion && (
                <button className="btn-danger-outline" onClick={removePhoto} disabled={saving}>
                  {T.profileRemovePhoto}
                </button>
              )}
            </div>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>{T.profilePhotoHint}</span>
          </div>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_TYPES.join(',')}
          onChange={onPhotoPicked}
          style={{ display: 'none' }}
        />
      </div>

      {SECTIONS.map((section) => (
        <div key={section.titleKey} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <h3 style={{ fontSize: 16, fontWeight: 500 }}>{T[section.titleKey]}</h3>
          {section.fields.map((field) =>
            field.langs ? (
              <div key={field.base} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{T[field.labelKey]}</span>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                  {LANG_SUFFIX.filter(({ suffix }) => getMasterLanguages().includes(suffix.toLowerCase())).map(({ suffix, labelKey }) => (
                    <Field
                      key={suffix}
                      label={T[labelKey]}
                      multiline={field.multiline}
                      value={form[field.base + suffix] ?? ''}
                      onChange={(v) => setField(field.base + suffix, v)}
                    />
                  ))}
                </div>
              </div>
            ) : (
              <Field
                key={field.base}
                label={T[field.labelKey]}
                multiline={field.multiline}
                value={form[field.base] ?? ''}
                onChange={(v) => setField(field.base, v)}
              />
            )
          )}
        </div>
      ))}

      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <button className="btn-primary" onClick={save} disabled={saving}>
          {T.saveBtn}
        </button>
        {saved && <span style={{ fontSize: 13, color: 'var(--sage)' }}>{T.profileSaved}</span>}
      </div>
    </div>
  );
}

function Field({ label, value, onChange, multiline }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ fontSize: 12, color: 'var(--muted)' }}>{label}</label>
      {multiline ? (
        <textarea
          className="field-input"
          rows={5}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{ resize: 'vertical', lineHeight: 1.6 }}
        />
      ) : (
        <input className="field-input" value={value} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
}

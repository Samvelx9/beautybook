import { useEffect, useState } from 'react';
import { api, ApiError } from '../api.js';
import { getMasterLanguages, localName, pluralize } from '../i18n.js';

const EMPTY_FORM = {
  nameEn: '',
  nameRu: '',
  nameHy: '',
  descriptionEn: '',
  descriptionRu: '',
  descriptionHy: '',
  sortOrder: '',
  isHourly: false,
};

// The treatments a guest picks between on the landing page (manicure, waxing,
// massage…). The zones and prices under each one live in Services.
export default function CategoriesScreen({ T, lang, onAuthError, setTab }) {
  const [categories, setCategories] = useState([]);
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null); // null | 'new' | category id
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [categoryRows, serviceRows] = await Promise.all([api.getCategories(), api.getServices()]);
      setCategories(categoryRows);
      setServices(serviceRows);
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

  function startNew() {
    setForm({ ...EMPTY_FORM, sortOrder: String(categories.length + 1) });
    setEditingId('new');
    setError(null);
  }

  function startEdit(category) {
    setForm({
      nameEn: category.name_en,
      nameRu: category.name_ru,
      nameHy: category.name_hy,
      descriptionEn: category.description_en,
      descriptionRu: category.description_ru,
      descriptionHy: category.description_hy,
      sortOrder: String(category.sort_order),
      isHourly: category.is_hourly,
    });
    setEditingId(category.id);
    setError(null);
  }

  async function save() {
    const payload = {
      nameEn: form.nameEn.trim(),
      nameRu: form.nameRu.trim(),
      nameHy: form.nameHy.trim(),
      descriptionEn: form.descriptionEn.trim(),
      descriptionRu: form.descriptionRu.trim(),
      descriptionHy: form.descriptionHy.trim(),
      sortOrder: Number(form.sortOrder) || 0,
      isHourly: form.isHourly,
    };
    if (!payload.nameEn && !payload.nameRu && !payload.nameHy) {
      setError('atLeastOneName');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      if (editingId === 'new') {
        await api.createCategory(payload);
      } else {
        await api.updateCategory(editingId, payload);
      }
      setEditingId(null);
      await load();
    } catch (err) {
      if (!onAuthError(err)) setError('genericError');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(category) {
    try {
      await api.updateCategory(category.id, { isActive: !category.is_active });
      await load();
    } catch (err) {
      if (!onAuthError(err)) setError('genericError');
    }
  }

  async function remove(category) {
    if (!window.confirm(T.confirmDeleteCategory)) return;
    try {
      await api.deleteCategory(category.id);
      await load();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'category_has_services') {
        window.alert(T.categoryHasServicesError);
      } else if (!onAuthError(err)) {
        setError('genericError');
      }
    }
  }

  const zoneCount = (categoryId) => services.filter((s) => s.category_id === categoryId).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 500 }}>{T.categoriesTitle}</h2>
          <p style={{ margin: '6px 0 0', fontSize: 13.5, color: 'var(--muted)', maxWidth: 620 }}>
            {T.categoriesCaption}
          </p>
        </div>
        {editingId === null && (
          <button className="btn-primary" style={{ flexShrink: 0 }} onClick={startNew}>
            {T.addCategoryBtn}
          </button>
        )}
      </div>

      {error && <p style={{ margin: 0, fontSize: 13, color: 'var(--terracotta)' }}>{T[error]}</p>}

      {editingId === null && <TemplatePicker T={T} lang={lang} onAuthError={onAuthError} onAdded={load} setTab={setTab} />}

      {/* Same rule as Services: editing opens the form under the treatment it
          belongs to, and only a new treatment sits at the top. */}
      {editingId === 'new' && (
        <CategoryForm
          T={T}
          form={form}
          setForm={setForm}
          saving={saving}
          onSave={save}
          onCancel={() => setEditingId(null)}
        />
      )}

      {loading ? (
        <p style={{ color: 'var(--muted)' }}>{T.loading}</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {categories.map((category) => (
            <div key={category.id} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div
              className="card"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                <span style={{ fontFamily: "'Newsreader',serif", fontSize: 17 }}>
                  {localName(category, lang)}{' '}
                  {!category.is_active && (
                    <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: "'Karla',sans-serif" }}>
                      ({T.inactiveTag})
                    </span>
                  )}
                </span>
                {localName(category, lang, 'description') && (
                  <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>{localName(category, lang, 'description')}</span>
                )}
                <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>
                  {zoneCount(category.id)} {pluralize(zoneCount(category.id), lang, 'zones')}
                  {category.is_hourly && (
                    <span style={{ color: 'var(--sage)', fontWeight: 600 }}> · {T.hourlyTag}</span>
                  )}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn-outline" onClick={() => startEdit(category)} disabled={editingId === category.id}>
                  {T.editBtn}
                </button>
                <button className="btn-outline" onClick={() => toggleActive(category)}>
                  {category.is_active ? T.deactivateBtn : T.activateBtn}
                </button>
                <button className="btn-danger-outline" onClick={() => remove(category)}>
                  {T.deleteBtn}
                </button>
              </div>
            </div>
            {editingId === category.id && (
              <CategoryForm
                T={T}
                form={form}
                setForm={setForm}
                saving={saving}
                onSave={save}
                onCancel={() => setEditingId(null)}
                nested
              />
            )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// `nested` marks the copy rendered under a treatment's row — indented and
// accented so it reads as belonging to that treatment.
function CategoryForm({ T, form, setForm, saving, onSave, onCancel, nested }) {
  return (
    <div
      className="card"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        ...(nested
          ? { marginLeft: 16, borderLeft: '3px solid var(--terracotta)', background: 'var(--bg)' }
          : null),
      }}
    >
      <FieldGroup label={T.categoryNameLabel} T={T} form={form} setForm={setForm} keys={['nameHy', 'nameRu', 'nameEn']} />
      <FieldGroup
        label={T.categoryDescriptionLabel}
        T={T}
        form={form}
        setForm={setForm}
        keys={['descriptionHy', 'descriptionRu', 'descriptionEn']}
        multiline
      />
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 20, flexWrap: 'wrap' }}>
        <div style={{ width: 160 }}>
          <Field
            label={T.sortOrderLabel}
            type="number"
            value={form.sortOrder}
            onChange={(v) => setForm({ ...form, sortOrder: v })}
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingBottom: 6 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5 }}>
            <input
              type="checkbox"
              checked={form.isHourly}
              onChange={(e) => setForm({ ...form, isHourly: e.target.checked })}
            />
            {T.hourlyLabel}
          </label>
          <span style={{ fontSize: 12, color: 'var(--muted)', maxWidth: 420 }}>{T.hourlyHint}</span>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <button className="btn-primary" onClick={onSave} disabled={saving}>
          {T.saveBtn}
        </button>
        <button className="btn-outline" onClick={onCancel} disabled={saving}>
          {T.cancelBtn}
        </button>
      </div>
    </div>
  );
}

const LANG_LABEL_KEY = { Hy: 'inArmenian', Ru: 'inRussian', En: 'inEnglish' };

// Only the languages the master's page is in are asked for.
function FieldGroup({ label, T, form, setForm, keys: allKeys, multiline }) {
  const languages = getMasterLanguages();
  const keys = allKeys.filter((key) => languages.includes(key.slice(-2).toLowerCase()));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        {keys.map((key) => (
          <Field
            key={key}
            label={T[LANG_LABEL_KEY[key.slice(-2)]]}
            multiline={multiline}
            value={form[key]}
            onChange={(v) => setForm((prev) => ({ ...prev, [key]: v }))}
          />
        ))}
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = 'text', multiline }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ fontSize: 12, color: 'var(--muted)' }}>{label}</label>
      {multiline ? (
        <textarea
          className="field-input"
          rows={3}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{ resize: 'vertical', lineHeight: 1.6 }}
        />
      ) : (
        <input className="field-input" type={type} value={value} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
}

// Starter price lists (the same ones sign-up offers), for adding a whole
// treatment with its usual zones in one go. They arrive hidden and unpriced.
function TemplatePicker({ T, lang, onAuthError, onAdded, setTab }) {
  const [templates, setTemplates] = useState([]);
  const [choice, setChoice] = useState('');
  const [result, setResult] = useState(null);

  useEffect(() => {
    api.getTemplates().then(setTemplates).catch(() => setTemplates([]));
  }, []);

  async function add() {
    if (!choice) return;
    setResult(null);
    try {
      const { added } = await api.applyTemplate(choice);
      setResult(added > 0 ? 'templateAdded' : 'templateNothingAdded');
      setChoice('');
      await onAdded();
    } catch (err) {
      if (!onAuthError(err)) setResult('genericError');
    }
  }

  if (templates.length === 0) return null;
  return (
    <div className="card" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', background: 'var(--bg)' }}>
      <span style={{ fontSize: 13.5, fontWeight: 600 }}>{T.addFromTemplate}</span>
      <select className="field-input" style={{ width: 'auto', minWidth: 200 }} value={choice} onChange={(e) => setChoice(e.target.value)}>
        <option value="">—</option>
        {templates.map((t) => (
          <option key={t.key} value={t.key}>{t.label[lang] ?? t.label.en}</option>
        ))}
      </select>
      <button className="btn-outline" onClick={add} disabled={!choice}>{T.addBtn}</button>
      {result && (
        <span style={{ fontSize: 13, color: result === 'genericError' ? 'var(--terracotta)' : 'var(--sage)' }}>
          {T[result]}{' '}
          {result === 'templateAdded' && (
            <a href="#services" onClick={(e) => { e.preventDefault(); setTab('services'); }}>→ {T.navServices}</a>
          )}
        </span>
      )}
    </div>
  );
}

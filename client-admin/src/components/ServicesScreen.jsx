import { useEffect, useState } from 'react';
import { api, ApiError } from '../api.js';
import { currencySymbol, formatPrice, getMasterLanguages, localName, pluralize } from '../i18n.js';
import { routeParam, setRouteParams } from '../route.js';

const EMPTY_FORM = {
  nameEn: '',
  nameRu: '',
  nameHy: '',
  categoryId: '',
  durationMinutes: '',
  price: '',
  sortOrder: '',
};

export default function ServicesScreen({ T, lang, onAuthError }) {
  const [services, setServices] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null); // null | 'new' | service id
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  // Treatments start folded: with a dozen zones each, an unfolded list is a
  // wall of rows. Opening one is how you get at its price list.
  // Which one is open is kept in the URL, so a reload leaves it open.
  const [openCategoryId, setOpenCategoryId] = useState(() => {
    const value = routeParam('treatment', (v) => v === 'none' || /^\d+$/.test(v), null);
    return value === null || value === 'none' ? value : Number(value);
  });

  useEffect(() => {
    setRouteParams({ treatment: openCategoryId });
  }, [openCategoryId]);

  async function load() {
    setLoading(true);
    try {
      const [serviceRows, categoryRows] = await Promise.all([api.getServices(), api.getCategories()]);
      setServices(serviceRows);
      setCategories(categoryRows);
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
    setForm({
      ...EMPTY_FORM,
      categoryId: String(categories[0]?.id ?? ''),
      sortOrder: String(services.length + 1),
    });
    setEditingId('new');
    setError(null);
  }

  function startEdit(s) {
    setOpenCategoryId(s.category_id);
    setForm({
      nameEn: s.name_en,
      nameRu: s.name_ru,
      nameHy: s.name_hy,
      categoryId: String(s.category_id),
      durationMinutes: String(s.duration_minutes),
      price: String(s.price),
      sortOrder: String(s.sort_order),
    });
    setEditingId(s.id);
    setError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setError(null);
  }

  async function save() {
    const payload = {
      nameEn: form.nameEn.trim(),
      nameRu: form.nameRu.trim(),
      nameHy: form.nameHy.trim(),
      categoryId: Number(form.categoryId),
      durationMinutes: Number(form.durationMinutes),
      price: Number(form.price),
      sortOrder: Number(form.sortOrder) || 0,
    };
    if (!payload.nameEn && !payload.nameRu && !payload.nameHy) {
      setError('atLeastOneName');
      return;
    }
    if (
      !payload.categoryId ||
      !payload.durationMinutes ||
      Number.isNaN(payload.price)
    ) {
      setError('genericError');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      if (editingId === 'new') {
        await api.createService(payload);
      } else {
        await api.updateService(editingId, payload);
      }
      setEditingId(null);
      await load();
    } catch (err) {
      if (!onAuthError(err)) setError('genericError');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(s) {
    try {
      await api.updateService(s.id, { isActive: !s.is_active });
      await load();
    } catch (err) {
      if (!onAuthError(err)) setError('genericError');
    }
  }

  async function remove(s) {
    if (!window.confirm(T.confirmDeleteService)) return;
    try {
      await api.deleteService(s.id);
      await load();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'service_has_bookings') {
        window.alert(T.serviceHasBookingsError);
      } else if (!onAuthError(err)) {
        setError('genericError');
      }
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ fontSize: 22, fontWeight: 500 }}>{T.servicesTitle}</h2>
        {editingId === null && (
          <button className="btn-primary" onClick={startNew}>
            {T.addServiceBtn}
          </button>
        )}
      </div>

      {error && <p style={{ margin: 0, fontSize: 13, color: 'var(--terracotta)' }}>{T[error]}</p>}
      {services.some((s) => !s.is_active) && (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>{T.hiddenZonesHint}</p>
      )}

      {/* Editing a service opens the form directly under that service's row
          (see ServiceRow below); only a brand-new one has no row to sit under,
          so it goes at the top. */}
      {editingId === 'new' && (
        <ServiceForm
          T={T}
          lang={lang}
          form={form}
          setForm={setForm}
          categories={categories}
          saving={saving}
          onSave={save}
          onCancel={cancelEdit}
        />
      )}

      {loading ? (
        <p style={{ color: 'var(--muted)' }}>{T.loading}</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
          {groupByCategory(services, categories).map(({ category, rows }) => {
            const groupId = category?.id ?? 'none';
            const isOpen = openCategoryId === groupId;
            return (
            <div key={groupId} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button
                onClick={() => setOpenCategoryId(isOpen ? null : groupId)}
                aria-expanded={isOpen}
                className="card"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  textAlign: 'left',
                  cursor: 'pointer',
                  background: isOpen ? 'var(--sage-light)' : 'var(--surface)',
                }}
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  style={{
                    stroke: 'var(--muted)',
                    strokeWidth: 3,
                    strokeLinecap: 'round',
                    strokeLinejoin: 'round',
                    transform: isOpen ? 'rotate(90deg)' : 'none',
                    transition: 'transform 120ms ease',
                    flexShrink: 0,
                  }}
                >
                  <path d="M9 6L15 12L9 18"></path>
                </svg>
                <span
                  style={{
                    fontFamily: "'Karla',sans-serif",
                    fontSize: 13,
                    fontWeight: 700,
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                  }}
                >
                  {category ? localName(category, lang) : T.uncategorized}
                </span>
                <span style={{ fontSize: 12.5, color: 'var(--muted)', marginLeft: 'auto' }}>
                  {rows.length} {pluralize(rows.length, lang, 'zones')}
                </span>
              </button>
              {isOpen && rows.map((s) => (
                <div key={s.id} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <ServiceRow
                    T={T}
                    lang={lang}
                    service={s}
                    isEditing={editingId === s.id}
                    onEdit={() => startEdit(s)}
                    onToggleActive={() => toggleActive(s)}
                    onRemove={() => remove(s)}
                  />
                  {editingId === s.id && (
                    <ServiceForm
                      T={T}
                      lang={lang}
                      form={form}
                      setForm={setForm}
                      categories={categories}
                      saving={saving}
                      onSave={save}
                      onCancel={cancelEdit}
                      nested
                    />
                  )}
                </div>
              ))}
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Keeps the master's price lists visually separated the same way guests see them.
// A service whose treatment was deactivated still needs a home, so anything
// that doesn't match a known category falls into a trailing group.
function groupByCategory(services, categories) {
  const groups = categories.map((category) => ({
    category,
    rows: services.filter((s) => s.category_id === category.id),
  }));
  const known = new Set(categories.map((c) => c.id));
  const orphans = services.filter((s) => !known.has(s.category_id));
  if (orphans.length > 0) groups.push({ category: null, rows: orphans });
  return groups.filter((group) => group.rows.length > 0);
}

// `nested` marks the copy that sits inside a service's row group — indented and
// accented down its left edge so it reads as belonging to the row above it.
function ServiceForm({ T, lang, form, setForm, categories, saving, onSave, onCancel, nested }) {
  return (
    <div
      className="card"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        ...(nested
          ? { marginLeft: 16, borderLeft: '3px solid var(--terracotta)', background: 'var(--bg)' }
          : null),
      }}
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        {/* Only the languages the master's page is in. */}
        {getMasterLanguages().includes('en') && <Field label={T.nameEnLabel} value={form.nameEn} onChange={(v) => setForm({ ...form, nameEn: v })} />}
        {getMasterLanguages().includes('ru') && <Field label={T.nameRuLabel} value={form.nameRu} onChange={(v) => setForm({ ...form, nameRu: v })} />}
        {getMasterLanguages().includes('hy') && <Field label={T.nameHyLabel} value={form.nameHy} onChange={(v) => setForm({ ...form, nameHy: v })} />}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: 12, color: 'var(--muted)' }}>{T.serviceCategoryLabel}</label>
          <select
            className="field-input"
            value={form.categoryId}
            onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {localName(c, lang)}
              </option>
            ))}
          </select>
        </div>
        <Field
          label={T.durationLabel}
          type="number"
          value={form.durationMinutes}
          onChange={(v) => setForm({ ...form, durationMinutes: v })}
        />
        <Field
          label={`${categories.find((c) => String(c.id) === String(form.categoryId))?.is_hourly ? T.hourlyRateLabel : T.priceLabel} (${currencySymbol()})`}
          type="number"
          value={form.price}
          onChange={(v) => setForm({ ...form, price: v })}
        />
        <Field
          label={T.sortOrderLabel}
          type="number"
          value={form.sortOrder}
          onChange={(v) => setForm({ ...form, sortOrder: v })}
        />
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

function ServiceRow({ T, lang, service, isEditing, onEdit, onToggleActive, onRemove }) {
  return (
    <div
      className="card"
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontFamily: "'Newsreader',serif", fontSize: 16 }}>
          {localName(service, lang)}{' '}
          {!service.is_active && (
            <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: "'Karla',sans-serif" }}>
              ({T.inactiveTag})
            </span>
          )}
        </span>
        <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>
          {service.is_hourly
            ? `${formatPrice(service.price, lang)} ${T.perHourSuffix}`
            : `${service.duration_minutes} ${T.minUnit} · ${formatPrice(service.price, lang)}`}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn-outline" onClick={onEdit} disabled={isEditing}>
          {T.editBtn}
        </button>
        <button className="btn-outline" onClick={onToggleActive}>
          {service.is_active ? T.deactivateBtn : T.activateBtn}
        </button>
        <button className="btn-danger-outline" onClick={onRemove}>
          {T.deleteBtn}
        </button>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = 'text' }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ fontSize: 12, color: 'var(--muted)' }}>{label}</label>
      <input className="field-input" type={type} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

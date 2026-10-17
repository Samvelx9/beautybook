import { useEffect, useState } from 'react';
import { api, ApiError } from '../api.js';
import ConfirmInline from './ConfirmInline.jsx';

const muted = { margin: 0, fontSize: 13, lineHeight: 1.5, color: 'var(--muted)' };
const TAX_PAYERS = ['master', 'salon', 'both'];

// A rate as typed: above 0, at most 100, two decimals at most.
const isRate = (v) => {
  const n = Number(v);
  return v !== '' && Number.isFinite(n) && n > 0 && n <= 100 && Math.round(n * 100) === n * 100;
};

// The owner's taxes on income: each a name and a percentage of what clients
// paid. In a salon, also who pays each master's taxes. Every visit is taxed at
// the list as it stood when it was completed, so changes here apply from now on.
export default function TaxesScreen({ T, account, salon, refreshSalon, onAuthError }) {
  const [taxes, setTaxes] = useState(null);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({ name: '', ratePercent: '' });
  // The tax being edited ({ id, name, ratePercent }) or confirmed for deletion.
  const [editing, setEditing] = useState(null);
  const [confirmingId, setConfirmingId] = useState(null);
  const [busy, setBusy] = useState(false);
  const isSalon = account.organization.kind === 'salon';

  async function load() {
    try {
      setTaxes(await api.getTaxes());
    } catch (err) {
      failed(err);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function failed(err) {
    if (onAuthError(err)) return;
    setError(err instanceof ApiError && T[err.code] ? err.code : 'genericError');
  }

  async function act(fn) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      failed(err);
    } finally {
      setBusy(false);
    }
  }

  const add = (e) => {
    e.preventDefault();
    if (!form.name.trim() || !isRate(form.ratePercent)) return setError('invalid_tax_rate');
    return act(async () => {
      await api.createTax({ name: form.name.trim(), ratePercent: Number(form.ratePercent) });
      setForm({ name: '', ratePercent: '' });
    });
  };
  const save = () => {
    if (!editing.name.trim() || !isRate(editing.ratePercent)) return setError('invalid_tax_rate');
    return act(async () => {
      await api.updateTax(editing.id, { name: editing.name.trim(), ratePercent: Number(editing.ratePercent) });
      setEditing(null);
    });
  };
  const remove = (id) => act(async () => {
    await api.deleteTax(id);
    setConfirmingId(null);
  });

  const totalRate = (taxes ?? []).reduce((sum, t) => sum + t.ratePercent, 0);
  const label = { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12.5, color: 'var(--muted)' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 760 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <h2 style={{ fontSize: 22, fontWeight: 500 }}>{T.taxesTitle}</h2>
        <p style={muted}>{T.taxesIntro}</p>
      </div>

      {error && <p role="alert" style={{ margin: 0, fontSize: 13, color: 'var(--terracotta)' }}>{T[error] ?? T.genericError}</p>}

      <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {taxes === null ? (
          <p style={muted}>{T.loading}</p>
        ) : taxes.length === 0 ? (
          <p style={muted}>{T.noTaxesYet}</p>
        ) : (
          <>
            {taxes.map((tax) =>
              editing?.id === tax.id ? (
                <div key={tax.id} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <input
                    className="field-input"
                    style={{ flex: 1, minWidth: 160 }}
                    aria-label={T.taxNameLabel}
                    value={editing.name}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  />
                  <input
                    className="field-input"
                    style={{ width: 90 }}
                    type="number"
                    step="0.01"
                    aria-label={T.taxRateLabel}
                    value={editing.ratePercent}
                    onChange={(e) => setEditing({ ...editing, ratePercent: e.target.value })}
                  />
                  <span>%</span>
                  <button className="btn-primary" onClick={save} disabled={busy}>{T.saveBtn}</button>
                  <button className="btn-outline" onClick={() => setEditing(null)} disabled={busy}>{T.cancelBtn}</button>
                </div>
              ) : (
                <div key={tax.id} style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 14.5 }}>
                    {tax.name} <strong style={{ marginLeft: 6 }}>{tax.ratePercent}%</strong>
                  </span>
                  {confirmingId === tax.id ? (
                    <ConfirmInline
                      T={T}
                      message={T.confirmDeleteTax}
                      onConfirm={() => remove(tax.id)}
                      onCancel={() => setConfirmingId(null)}
                      busy={busy}
                    />
                  ) : (
                    <span style={{ display: 'flex', gap: 8 }}>
                      <button
                        className="btn-outline"
                        onClick={() => setEditing({ id: tax.id, name: tax.name, ratePercent: String(tax.ratePercent) })}
                      >
                        {T.editBtn}
                      </button>
                      <button className="btn-danger-outline" onClick={() => setConfirmingId(tax.id)}>{T.deleteBtn}</button>
                    </span>
                  )}
                </div>
              )
            )}
            <p style={{ ...muted, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
              {T.taxesTotalLine(Math.round(totalRate * 100) / 100)}
            </p>
          </>
        )}
      </section>

      <form onSubmit={add} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12, borderLeft: '3px solid var(--sage)' }}>
        <h3 style={{ fontSize: 16, fontWeight: 600 }}>{T.addTaxTitle}</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 140px', gap: 12 }}>
          <label style={label}>
            {T.taxNameLabel}
            <input
              className="field-input"
              placeholder={T.taxNamePlaceholder}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <label style={label}>
            {T.taxRateLabel}
            <input
              className="field-input"
              type="number"
              step="0.01"
              value={form.ratePercent}
              onChange={(e) => setForm({ ...form, ratePercent: e.target.value })}
            />
          </label>
        </div>
        <p style={{ ...muted, fontSize: 12 }}>{T.taxRateHint}</p>
        <div><button type="submit" className="btn-primary" disabled={busy}>{T.addBtn}</button></div>
      </form>

      {isSalon && salon && (
        <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600 }}>{T.taxPayerTitle}</h3>
          <p style={muted}>{T.taxPayerIntro}</p>
          {salon.masters.length === 0 ? (
            <p style={muted}>{T.noMastersYet}</p>
          ) : (
            salon.masters.map((m) => (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <label htmlFor={`payer-${m.id}`} style={{ fontSize: 14 }}>
                  {m.name || m.slug}
                  {!m.active && <span style={{ color: 'var(--muted)' }}> · {T.masterInactive}</span>}
                </label>
                {m.isOwner ? (
                  <span style={{ fontSize: 13, color: 'var(--muted)' }}>{T.ownerKeepsAll}</span>
                ) : (
                  <select
                    id={`payer-${m.id}`}
                    className="field-input"
                    style={{ width: 'auto', minWidth: 240 }}
                    value={m.taxPayer}
                    disabled={busy}
                    onChange={(e) => {
                      const taxPayer = e.target.value;
                      act(async () => {
                        await api.updateMaster(m.id, { taxPayer });
                        await refreshSalon();
                      });
                    }}
                  >
                    {TAX_PAYERS.map((p) => (
                      <option key={p} value={p}>{T.taxPayers[p](m.effectiveSharePercent)}</option>
                    ))}
                  </select>
                )}
              </div>
            ))
          )}
        </section>
      )}
    </div>
  );
}

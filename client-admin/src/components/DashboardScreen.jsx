import { useEffect, useState } from 'react';
import { api } from '../api.js';
import OnboardingCard from './OnboardingCard.jsx';
import { formatPrice, parseLocalDate, formatDate, localName, currencySymbol } from '../i18n.js';
import { isDateStr, routeParam, setRouteParams } from '../route.js';
import { todayLocalStr } from 'salon-shared/time';

// Today in the master's own timezone, not the browser's.
const todayStr = todayLocalStr;
function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}
function startOfMonth() {
  return `${todayStr().slice(0, 7)}-01`;
}

export default function DashboardScreen({ T, lang, onAuthError, account, setTab }) {
  // The period starts from the URL so a reload keeps it — see route.js.
  const [from, setFrom] = useState(() => routeParam('from', isDateStr, startOfMonth()));
  const [to, setTo] = useState(() => routeParam('to', isDateStr, todayStr()));

  useEffect(() => {
    setRouteParams({
      from: from === startOfMonth() ? null : from,
      to: to === todayStr() ? null : to,
    });
  }, [from, to]);
  const [financials, setFinancials] = useState(null);
  const [expenses, setExpenses] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [newExpense, setNewExpense] = useState({ category: '', description: '', amount: '', date: todayStr() });
  const [adding, setAdding] = useState(false);
  // One expense row at a time is either being edited or being confirmed for
  // deletion — same inline pattern as Services, so the form sits under the row.
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const [fin, exp, cats] = await Promise.all([
        api.getFinancials({ from, to }),
        api.getExpenses({ from, to }),
        api.getExpenseCategories(),
      ]);
      setFinancials(fin);
      setExpenses(exp);
      setCategories(cats);
    } catch (err) {
      if (!onAuthError(err)) setError('genericError');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  async function submitExpense(e) {
    e.preventDefault();
    const amount = Number(newExpense.amount);
    if (!newExpense.category.trim() || !Number.isFinite(amount) || amount <= 0 || !newExpense.date) return;

    setAdding(true);
    setError(null);
    try {
      await api.createExpense({
        category: newExpense.category.trim(),
        description: newExpense.description.trim() || undefined,
        amount: amount,
        date: newExpense.date,
      });
      setNewExpense({ category: '', description: '', amount: '', date: todayStr() });
      await load();
    } catch (err) {
      if (!onAuthError(err)) setError('genericError');
    } finally {
      setAdding(false);
    }
  }

  function startEditExpense(exp) {
    setConfirmingDeleteId(null);
    setEditingId(exp.id);
    setEditForm({
      category: exp.category,
      description: exp.description || '',
      amount: String(exp.amount),
      date: exp.date,
    });
  }

  async function saveExpense() {
    const amount = Number(editForm.amount);
    if (!editForm.category.trim() || !Number.isInteger(amount) || amount <= 0 || !editForm.date) {
      setError('genericError');
      return;
    }
    setSavingEdit(true);
    setError(null);
    try {
      await api.updateExpense(editingId, {
        category: editForm.category.trim(),
        description: editForm.description.trim(),
        amount: amount,
        date: editForm.date,
      });
      setEditingId(null);
      await load();
    } catch (err) {
      if (!onAuthError(err)) setError('genericError');
    } finally {
      setSavingEdit(false);
    }
  }

  async function removeExpense(id) {
    setError(null);
    try {
      await api.deleteExpense(id);
      setConfirmingDeleteId(null);
      if (editingId === id) setEditingId(null);
      await load();
    } catch (err) {
      if (!onAuthError(err)) setError('genericError');
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <OnboardingCard T={T} account={account} setTab={setTab} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <h2 style={{ fontSize: 22, fontWeight: 500 }}>{T.dashboardTitle}</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button
            className="btn-outline"
            onClick={() => {
              setFrom(startOfMonth());
              setTo(todayStr());
            }}
          >
            {T.thisMonth}
          </button>
          <button
            className="btn-outline"
            onClick={() => {
              setFrom(addDays(todayStr(), -30));
              setTo(todayStr());
            }}
          >
            {T.last30Days}
          </button>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            {T.from}
            <input className="field-input" style={{ width: 145 }} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            {T.to}
            <input className="field-input" style={{ width: 145 }} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
      </div>

      {error && <p style={{ margin: 0, fontSize: 13, color: 'var(--terracotta)' }}>{T[error]}</p>}

      {loading || !financials ? (
        <p style={{ color: 'var(--muted)' }}>{T.loading}</p>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
            <MetricCard label={T.metricIncome} value={formatPrice(financials.income.total, lang)} />
            <MetricCard label={T.metricExpenses} value={formatPrice(financials.expenses.total, lang)} />
            <MetricCard
              label={T.metricNet}
              value={formatPrice(financials.net, lang)}
              color={financials.net < 0 ? 'var(--terracotta)' : 'var(--sage)'}
            />
            <MetricCard label={T.metricBookingsCompleted} value={String(financials.bookingsCompleted)} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
            <BreakdownCard
              title={T.incomeByService}
              groups={groupByTreatment(financials.income.byService, lang)}
              lang={lang}
              noData={T.noData}
            />
            <BreakdownCard
              title={T.expensesByCategory}
              rows={financials.expenses.byCategory.map((r) => ({ label: r.category, value: r.total }))}
              lang={lang}
              noData={T.noData}
            />
          </div>

          <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h3 style={{ fontSize: 16, fontWeight: 600 }}>{T.addExpense}</h3>
            <form onSubmit={submitExpense} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: 12, color: 'var(--muted)' }}>{T.categoryLabel}</label>
                  <input
                    className="field-input"
                    list="expense-categories"
                    placeholder={T.categoryPlaceholder}
                    value={newExpense.category}
                    onChange={(e) => setNewExpense({ ...newExpense, category: e.target.value })}
                  />
                  <datalist id="expense-categories">
                    {categories.map((c) => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: 12, color: 'var(--muted)' }}>{T.descriptionLabel}</label>
                  <input
                    className="field-input"
                    value={newExpense.description}
                    onChange={(e) => setNewExpense({ ...newExpense, description: e.target.value })}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: 12, color: 'var(--muted)' }}>{T.amountLabel} ({currencySymbol()})</label>
                  <input
                    className="field-input"
                    type="number"
                    value={newExpense.amount}
                    onChange={(e) => setNewExpense({ ...newExpense, amount: e.target.value })}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: 12, color: 'var(--muted)' }}>{T.dateLabel}</label>
                  <input
                    className="field-input"
                    type="date"
                    value={newExpense.date}
                    onChange={(e) => setNewExpense({ ...newExpense, date: e.target.value })}
                  />
                </div>
              </div>
              <button type="submit" className="btn-primary" style={{ alignSelf: 'flex-start' }} disabled={adding}>
                {T.addBtn}
              </button>
            </form>

            <h3 style={{ fontSize: 16, fontWeight: 600 }}>{T.recentExpenses}</h3>
            {expenses.length === 0 ? (
              <p style={{ color: 'var(--muted)', fontSize: 13.5 }}>{T.noData}</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {expenses.slice(0, 10).map((exp) => (
                  <div key={exp.id} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span style={{ fontSize: 14, fontWeight: 600 }}>{exp.category}</span>
                        <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>
                          {formatDate(parseLocalDate(exp.date), lang)}
                          {exp.description ? ` · ${exp.description}` : ''}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--terracotta)' }}>
                          {formatPrice(exp.amount, lang)}
                        </span>
                        {confirmingDeleteId === exp.id ? (
                          <>
                            <span style={{ fontSize: 12.5, color: 'var(--terracotta)' }}>{T.confirmDeleteExpense}</span>
                            <button className="btn-danger-outline" onClick={() => removeExpense(exp.id)}>
                              {T.confirmDeleteBtn}
                            </button>
                            <button className="btn-outline" onClick={() => setConfirmingDeleteId(null)}>
                              {T.cancelBtn}
                            </button>
                          </>
                        ) : (
                          <>
                            <button className="btn-outline" onClick={() => startEditExpense(exp)} disabled={editingId === exp.id}>
                              {T.editBtn}
                            </button>
                            <button className="btn-danger-outline" onClick={() => setConfirmingDeleteId(exp.id)}>
                              {T.deleteBtn}
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    {editingId === exp.id && (
                      <div
                        className="card"
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 12,
                          marginLeft: 16,
                          borderLeft: '3px solid var(--terracotta)',
                          background: 'var(--bg)',
                        }}
                      >
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
                          <ExpenseField
                            label={T.categoryLabel}
                            value={editForm.category}
                            onChange={(v) => setEditForm({ ...editForm, category: v })}
                          />
                          <ExpenseField
                            label={T.descriptionLabel}
                            value={editForm.description}
                            onChange={(v) => setEditForm({ ...editForm, description: v })}
                          />
                          <ExpenseField
                            label={`${T.amountLabel} (${currencySymbol()})`}
                            type="number"
                            value={editForm.amount}
                            onChange={(v) => setEditForm({ ...editForm, amount: v })}
                          />
                          <ExpenseField
                            label={T.dateLabel}
                            type="date"
                            value={editForm.date}
                            onChange={(v) => setEditForm({ ...editForm, date: v })}
                          />
                        </div>
                        <div style={{ display: 'flex', gap: 10 }}>
                          <button className="btn-primary" onClick={saveExpense} disabled={savingEdit}>
                            {T.saveBtn}
                          </button>
                          <button className="btn-outline" onClick={() => setEditingId(null)} disabled={savingEdit}>
                            {T.cancelBtn}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function ExpenseField({ label, value, onChange, type = 'text' }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ fontSize: 12, color: 'var(--muted)' }}>{label}</label>
      <input className="field-input" type={type} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function MetricCard({ label, value, color = 'var(--ink)' }) {
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>
      <span style={{ fontSize: 22, fontWeight: 700, color, fontFamily: "'Newsreader',serif" }}>{value}</span>
    </div>
  );
}

// The same zone can exist under several treatments ("Deep bikini" for both
// waxing and sugaring), so income is shown per treatment, biggest first.
function groupByTreatment(rows, lang) {
  const groups = new Map();
  for (const r of rows) {
    if (!groups.has(r.category_id)) {
      groups.set(r.category_id, { label: localName(r, lang, 'category_name'), value: 0, rows: [] });
    }
    const group = groups.get(r.category_id);
    group.value += r.total;
    group.rows.push({ label: localName(r, lang), value: r.total });
  }
  return [...groups.values()].sort((a, b) => b.value - a.value);
}

function BreakdownCard({ title, rows, groups, lang, noData }) {
  const empty = groups ? groups.length === 0 : rows.length === 0;
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <h3 style={{ fontSize: 15, fontWeight: 600 }}>{title}</h3>
      {empty ? (
        <span style={{ fontSize: 13, color: 'var(--muted)' }}>{noData}</span>
      ) : groups ? (
        groups.map((g, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: 12,
                color: 'var(--muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}
            >
              <span>{g.label}</span>
              <span>{formatPrice(g.value, lang)}</span>
            </div>
            {g.rows.map((r, j) => (
              <BreakdownRow key={j} row={r} lang={lang} indent />
            ))}
          </div>
        ))
      ) : (
        rows.map((r, i) => <BreakdownRow key={i} row={r} lang={lang} />)
      )}
    </div>
  );
}

function BreakdownRow({ row, lang, indent = false }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, paddingLeft: indent ? 12 : 0 }}>
      <span>{row.label}</span>
      <span style={{ fontWeight: 600 }}>{formatPrice(row.value, lang)}</span>
    </div>
  );
}

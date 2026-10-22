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

export default function DashboardScreen({ T, lang, onAuthError, account, salon, setTab }) {
  // The owner keeps the books: expenses and the whole organization's income.
  // A salon's master sees what their own visits brought in.
  const isOwner = account.role === 'owner';
  const salonMasters = salon?.masters ?? [];
  // A salon's owner sees the whole income and, beside it, their part once the
  // masters' shares are paid. A salon's master sees only their share.
  const showsShare = Boolean(salon);
  const isSalonMaster = account.organization.kind === 'salon' && !isOwner;
  const [masterId, setMasterId] = useState(() => routeParam('master', (v) => /^\d+$/.test(v), ''));
  // The period starts from the URL so a reload keeps it — see route.js.
  const [from, setFrom] = useState(() => routeParam('from', isDateStr, startOfMonth()));
  const [to, setTo] = useState(() => routeParam('to', isDateStr, todayStr()));

  useEffect(() => {
    setRouteParams({
      from: from === startOfMonth() ? null : from,
      to: to === todayStr() ? null : to,
      master: masterId || null,
    });
  }, [from, to, masterId]);
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

  // Whether any visit in the period was taxed (the owner has listed taxes).
  const hasTaxes = (financials?.taxes?.byTax.length ?? 0) > 0;

  async function load() {
    setLoading(true);
    try {
      const [fin, exp, cats] = await Promise.all([
        api.getFinancials({ from, to, masterId }),
        isOwner ? api.getExpenses({ from, to }) : [],
        isOwner ? api.getExpenseCategories() : [],
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
  }, [from, to, masterId]);

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
      <OnboardingCard T={T} account={account} salon={salon} setTab={setTab} />
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
          {salonMasters.length > 1 && (
            <select
              className="field-input"
              style={{ width: 'auto' }}
              aria-label={T.pickerLabel}
              value={masterId}
              onChange={(e) => setMasterId(e.target.value)}
            >
              <option value="">{T.pickerAll}</option>
              {salonMasters.map((m) => (
                <option key={m.id} value={String(m.id)}>{m.name || m.slug}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      {error && <p style={{ margin: 0, fontSize: 13, color: 'var(--terracotta)' }}>{T[error]}</p>}

      {loading || !financials ? (
        <p style={{ color: 'var(--muted)' }}>{T.loading}</p>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
            <MetricCard
              label={isSalonMaster ? T.metricYourIncome : T.metricIncome}
              value={formatPrice(financials.income.total, lang)}
            />
            {showsShare && (
              <MetricCard label={T.metricYourShare} value={formatPrice(financials.income.ownerShare, lang)} color="var(--sage)" />
            )}
            {/* The taxes this login pays itself: a master's out of their share,
                the owner's out of the salon's. */}
            {hasTaxes && (
              <MetricCard label={T.metricTaxes} value={`−${formatPrice(financials.taxes.total, lang)}`} color="var(--terracotta)" />
            )}
            {isSalonMaster && (
              <MetricCard label={T.metricLeft} value={formatPrice(financials.net, lang)} color="var(--sage)" />
            )}
            {isOwner && !masterId && (
              <>
                <MetricCard label={T.metricExpenses} value={formatPrice(financials.expenses.total, lang)} />
                <MetricCard
                  label={T.metricNet}
                  value={formatPrice(financials.net, lang)}
                  color={financials.net < 0 ? 'var(--terracotta)' : 'var(--sage)'}
                />
              </>
            )}
            <MetricCard label={T.metricBookingsCompleted} value={String(financials.bookingsCompleted)} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
            <BreakdownCard
              title={T.incomeByService}
              groups={groupByTreatment(financials.income.byService, lang, showsShare)}
              lang={lang}
              noData={T.noData}
              shareLabel={showsShare ? T.yourShareColumn : null}
            />
            {salonMasters.length > 1 && !masterId && (
              <BreakdownCard
                title={T.incomeByMaster}
                rows={financials.income.byMaster.map((r) => {
                  const m = salonMasters.find((x) => x.id === r.master_id);
                  return { label: m ? m.name || m.slug : '—', value: r.total, share: r.ownerShare };
                })}
                lang={lang}
                noData={T.noData}
                shareLabel={T.yourShareColumn}
              />
            )}
            {hasTaxes && (
              <BreakdownCard
                title={T.taxesByTax}
                rows={financials.taxes.byTax.map((t) => ({
                  label: `${t.name} · ${t.ratePercent}%`,
                  value: t.total,
                  share: showsShare ? t.salonPays : undefined,
                }))}
                lang={lang}
                noData={T.noData}
                shareLabel={showsShare ? T.salonPaysColumn : null}
                note={showsShare && financials.taxes.mastersPay > 0 ? T.mastersPayNote(formatPrice(financials.taxes.mastersPay, lang)) : null}
              />
            )}
            {isOwner && !masterId && (
              <BreakdownCard
                title={T.expensesByCategory}
                rows={financials.expenses.byCategory.map((r) => ({ label: r.category, value: r.total }))}
                lang={lang}
                noData={T.noData}
              />
            )}
          </div>

          {isOwner && (
          <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h3 style={{ fontSize: 16, fontWeight: 600 }}>{T.addExpense}</h3>
            <form onSubmit={submitExpense} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>{T.categoryLabel}</span>
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
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>{T.descriptionLabel}</span>
                  <input
                    className="field-input"
                    value={newExpense.description}
                    onChange={(e) => setNewExpense({ ...newExpense, description: e.target.value })}
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>{T.amountLabel} ({currencySymbol()})</span>
                  <input
                    className="field-input"
                    type="number"
                    value={newExpense.amount}
                    onChange={(e) => setNewExpense({ ...newExpense, amount: e.target.value })}
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>{T.dateLabel}</span>
                  <input
                    className="field-input"
                    type="date"
                    value={newExpense.date}
                    onChange={(e) => setNewExpense({ ...newExpense, date: e.target.value })}
                  />
                </label>
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
          )}
        </>
      )}
    </div>
  );
}

function ExpenseField({ label, value, onChange, type = 'text' }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 12, color: 'var(--muted)' }}>{label}</span>
      <input className="field-input" type={type} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
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
// `withShare`: carry the owner's share along, for a salon's owner.
function groupByTreatment(rows, lang, withShare) {
  const groups = new Map();
  for (const r of rows) {
    if (!groups.has(r.category_id)) {
      groups.set(r.category_id, { label: localName(r, lang, 'category_name'), value: 0, count: 0, rows: [] });
    }
    const group = groups.get(r.category_id);
    group.value += r.total;
    group.count += r.count;
    if (withShare) group.share = (group.share ?? 0) + r.ownerShare;
    group.rows.push({
      label: localName(r, lang),
      value: r.total,
      count: r.count,
      share: withShare ? r.ownerShare : undefined,
    });
  }
  return [...groups.values()].sort((a, b) => b.value - a.value);
}

function BreakdownCard({ title, rows, groups, lang, noData, shareLabel, note }) {
  const empty = groups ? groups.length === 0 : rows.length === 0;
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
        <h3 style={{ fontSize: 15, fontWeight: 600, flex: 1 }}>{title}</h3>
        {shareLabel && !empty && (
          <span style={{ ...SHARE_COLUMN, fontSize: 11.5, color: 'var(--muted)' }}>{shareLabel}</span>
        )}
      </div>
      {empty ? (
        <span style={{ fontSize: 13, color: 'var(--muted)' }}>{noData}</span>
      ) : groups ? (
        groups.map((g, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 12,
                fontSize: 12,
                color: 'var(--muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}
            >
              <span style={{ flex: 1 }}>{g.label}</span>
              <span style={COUNT_COLUMN}>{g.count}</span>
              <span style={AMOUNT_COLUMN}>{formatPrice(g.value, lang)}</span>
              {g.share !== undefined && <span style={SHARE_COLUMN}>{formatPrice(g.share, lang)}</span>}
            </div>
            {g.rows.map((r, j) => (
              <BreakdownRow key={j} row={r} lang={lang} indent />
            ))}
          </div>
        ))
      ) : (
        rows.map((r, i) => <BreakdownRow key={i} row={r} lang={lang} />)
      )}
      {note && !empty && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{note}</span>}
    </div>
  );
}

// The amount, and — for a salon's owner — their share of it in a second column.
// Income by zone also carries how many completed visits included each zone, in
// a column before the amount; fixed widths keep the numbers lined up row to row.
const SHARE_COLUMN = { minWidth: 88, textAlign: 'right' };
const COUNT_COLUMN = { minWidth: 36, textAlign: 'right' };
const AMOUNT_COLUMN = { minWidth: 88, textAlign: 'right' };
function BreakdownRow({ row, lang, indent = false }) {
  const withCount = row.count !== undefined;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13.5, paddingLeft: indent ? 12 : 0 }}>
      <span style={{ flex: 1 }}>{row.label}</span>
      {withCount && <span style={{ ...COUNT_COLUMN, color: 'var(--muted)' }}>{row.count}</span>}
      <span style={{ fontWeight: 600, ...(withCount && AMOUNT_COLUMN) }}>{formatPrice(row.value, lang)}</span>
      {row.share !== undefined && (
        <span style={{ ...SHARE_COLUMN, fontWeight: 600, color: 'var(--sage)' }}>{formatPrice(row.share, lang)}</span>
      )}
    </div>
  );
}

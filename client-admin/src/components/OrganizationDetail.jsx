import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { formatDate, formatPlatformPrice } from '../i18n.js';
import DeleteOrganizationCard from './DeleteOrganizationCard.jsx';

const muted = { fontSize: 12.5, color: 'var(--muted)' };

// One salon on the operator's Platform screen: its standing, plan and
// subscription, its owner, and each of its masters' activity — counts and
// totals only, never a client. A master opens their own detail page.
export default function OrganizationDetail({ T, lang, organizationId, onBack, onOpenMaster, onAuthError, actions, onDeleted }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);

  async function load() {
    try {
      setData(await api.getPlatformOrganization(organizationId));
    } catch (err) {
      if (!onAuthError(err)) setError(true);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId]);

  const back = <button className="btn-outline" onClick={onBack} style={{ alignSelf: 'flex-start' }}>{T.backToOrganizations}</button>;
  if (error) return <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{back}<p style={{ color: 'var(--terracotta)' }}>{T.genericError}</p></div>;
  if (!data) return <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{back}<p style={{ color: 'var(--muted)' }}>{T.loading}</p></div>;

  const o = data.organization;
  const date = (iso) => (iso ? formatDate(new Date(iso), lang) : '—');
  const money = (minor) => new Intl.NumberFormat(lang).format(minor);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {back}
      <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <h2 style={{ fontSize: 22, fontWeight: 500 }}>{o.name}</h2>
            {o.siteUrl && (
              <a href={o.siteUrl} target="_blank" rel="noreferrer" style={{ fontSize: 13 }}>{o.siteUrl.replace(/^https?:\/\//, '')} ↗</a>
            )}
            <span style={muted}>{o.ownerEmail} · {T.colCreated}: {date(o.createdAt)}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-end' }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>{T.statusLabels[o.access.state] ?? o.access.state}</span>
            <span style={muted}>
              {o.access.state === 'trial' ? `→ ${date(o.access.trialEndsAt)}` : o.access.periodEndsAt ? `→ ${date(o.access.periodEndsAt)}` : ''}
            </span>
          </div>
        </div>
        <span style={{ fontSize: 13.5 }}>
          {T.salonPlan(o.activeMasters, T.planNames[o.plan])} · {T.perMonth(formatPlatformPrice(o.priceMonthlyMinor, o.priceCurrency, lang))}
        </span>
        <span style={muted}>
          {T.orgBookings(o.bookingsTotal, o.bookings30d)} · {T.orgClients(data.clients)}
          {o.subscriptionId ? ` · ${T.orgSubscription(o.subscriptionId, o.variantId ?? '—')}` : ''}
        </span>
        <div>{actions(o, load)}</div>
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h3 style={{ fontSize: 16, fontWeight: 600 }}>{T.mastersTitle}</h3>
        {data.masters.length === 0 && <p style={{ ...muted, margin: 0 }}>{T.noMastersYet}</p>}
        {data.masters.map((m) => (
          <div key={m.id} className="card" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between', opacity: m.active ? 1 : 0.7 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: '1 1 240px' }}>
              <span style={{ fontFamily: "'Newsreader',serif", fontSize: 16 }}>
                {m.name}
                {m.isOwner && <span style={{ fontSize: 12, color: 'var(--sage)' }}> · {T.orgOwnerTag}</span>}
                {!m.active && <span style={{ fontSize: 12, color: 'var(--terracotta)' }}> · {T.masterInactive}</span>}
              </span>
              <a href={m.siteUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12.5 }}>{m.siteUrl.replace(/^https?:\/\//, '')}</a>
              <span style={muted}>{m.email}{m.telegramConnected ? ' · Telegram ✓' : ''}</span>
            </div>
            <span style={muted}>
              {T.orgBookings(m.bookings, m.bookings30d)} · {m.completed} {T.colDone.toLowerCase()} · {money(m.revenue)}
            </span>
            <button className="btn-primary" onClick={() => onOpenMaster(m.id)}>{T.viewDetails}</button>
          </div>
        ))}
      </section>

      <DeleteOrganizationCard T={T} organization={o} onDeleted={onDeleted} onAuthError={onAuthError} />
    </div>
  );
}

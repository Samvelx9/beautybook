import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { LANG_META, MONTH_SHORT, formatAmount, formatDate, localName } from '../i18n.js';

const STATUS_COLOR = {
  trial: 'var(--sage)', active: 'var(--sage)', on_trial: 'var(--sage)', cancelled: 'var(--muted)',
  past_due: 'var(--terracotta)', expired: 'var(--terracotta)', suspended: 'var(--terracotta)',
};

const percent = (rate) => (rate === null || rate === undefined ? '—' : `${Math.round(rate * 100)}%`);

function Section({ title, children, aside }) {
  return (
    <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h3 style={{ fontSize: 18, fontWeight: 500 }}>{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

// A headline number with its label underneath, and an optional quiet note.
function Kpi({ label, value, note }) {
  return (
    <div style={{ padding: '12px 14px', borderRadius: 12, background: 'var(--bg)', display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <span style={{ fontFamily: "'Newsreader',serif", fontSize: 24, lineHeight: 1.1 }}>{value}</span>
      <span style={{ fontSize: 12, color: 'var(--muted)' }}>{label}</span>
      {note && <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>{note}</span>}
    </div>
  );
}

function Row({ label, children }) {
  return (
    <div style={{ display: 'flex', gap: 12, fontSize: 13.5, flexWrap: 'wrap' }}>
      <span style={{ color: 'var(--muted)', minWidth: 130 }}>{label}</span>
      <span style={{ minWidth: 0, wordBreak: 'break-word' }}>{children}</span>
    </div>
  );
}

// Bookings per month, one series: a single hue, no legend (the heading names
// it), the latest month labelled and every bar's value on hover or focus.
function MonthlyBars({ T, lang, monthly, currency }) {
  const [active, setActive] = useState(null);
  const max = Math.max(1, ...monthly.map((m) => m.bookings));
  const shown = active ?? monthly.length - 1;
  const m = monthly[shown];
  const monthName = (key) => MONTH_SHORT[lang][Number(key.slice(5, 7)) - 1];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <p style={{ margin: 0, fontSize: 13, minHeight: 18 }} aria-live="polite">
        <strong>{monthName(m.month)} {m.month.slice(0, 4)}</strong>
        {` · ${m.bookings} ${T.colBooked.toLowerCase()} · ${m.completed} ${T.colDone.toLowerCase()} · ${formatAmount(m.revenue, lang, currency)}`}
      </p>
      <div
        role="list"
        style={{ display: 'grid', gridTemplateColumns: `repeat(${monthly.length}, 1fr)`, gap: 8, alignItems: 'end', height: 120, borderBottom: '1px solid var(--line)' }}
        onMouseLeave={() => setActive(null)}
      >
        {monthly.map((row, i) => (
          <button
            key={row.month}
            role="listitem"
            type="button"
            aria-label={`${monthName(row.month)}: ${row.bookings}`}
            onMouseEnter={() => setActive(i)}
            onFocus={() => setActive(i)}
            onBlur={() => setActive(null)}
            style={{ height: '100%', display: 'flex', alignItems: 'flex-end', padding: '0 4px', cursor: 'default' }}
          >
            <span
              style={{
                display: 'block',
                width: '100%',
                height: `${Math.max(row.bookings ? 4 : 0, (row.bookings / max) * 100)}%`,
                background: 'var(--sage)',
                opacity: i === shown ? 1 : 0.55,
                borderRadius: '4px 4px 0 0',
              }}
            />
          </button>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${monthly.length}, 1fr)`, gap: 8 }}>
        {monthly.map((row) => (
          <span key={row.month} style={{ fontSize: 11.5, color: 'var(--muted)', textAlign: 'center' }}>{monthName(row.month)}</span>
        ))}
      </div>
    </div>
  );
}

// One master in depth, for the platform operator: account and standing,
// performance, the monthly trend and the whole price list with how each zone
// sells. Aggregates only — no client's name or phone ever reaches this screen.
export default function MasterDetail({ T, lang, masterId, onBack, onAuthError, actions }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);

  async function load() {
    try {
      setData(await api.getPlatformMaster(masterId));
    } catch (err) {
      if (!onAuthError(err)) setError(true);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [masterId]);

  const back = (
    <button className="btn-outline" onClick={onBack} style={{ alignSelf: 'flex-start' }}>{T.backToMasters}</button>
  );
  if (error) return <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{back}<p style={{ color: 'var(--terracotta)' }}>{T.genericError}</p></div>;
  if (!data) return <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{back}<p style={{ color: 'var(--muted)' }}>{T.loading}</p></div>;

  const { master, profile, categories, stats, monthly } = data;
  const money = (n) => formatAmount(n, lang, master.currency);
  const date = (iso) => (iso ? formatDate(new Date(iso), lang) : '—');
  const contacts = [
    ['phoneFieldLabel', profile.phone],
    ['whatsappFieldLabel', profile.whatsapp],
    ['telegramFieldLabel', profile.telegram],
    ['instagramFieldLabel', profile.instagram],
    ['emailFieldLabel', profile.email],
    ['addressLabel', profile.address],
  ].filter(([, v]) => v);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {back}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: 24, fontWeight: 500 }}>{master.name || master.slug}</h2>
          <a href={master.siteUrl} target="_blank" rel="noreferrer" style={{ fontSize: 13.5 }}>
            {master.siteUrl.replace(/^https?:\/\//, '')} ↗
          </a>
          <p style={{ margin: '6px 0 0', fontSize: 13.5, fontWeight: 700, color: STATUS_COLOR[master.access.state] }}>
            {T.statusLabels[master.access.state] ?? master.access.state}
            <span style={{ fontWeight: 400, color: 'var(--muted)' }}>
              {master.access.state === 'trial' && ` → ${date(master.access.trialEndsAt)}`}
              {master.access.state !== 'trial' && master.access.periodEndsAt && ` → ${date(master.access.periodEndsAt)}`}
            </span>
          </p>
        </div>
        {actions(master, load)}
      </div>

      <Section title={T.detailPerformance} aside={<span style={{ fontSize: 12, color: 'var(--muted)' }}>{T.privacyNote}</span>}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
          <Kpi label={T.kpiBookings} value={stats.total} note={`${T.kpiNew30}: ${stats.created30d}`} />
          <Kpi label={T.kpiCompleted} value={stats.byStatus.completed} />
          <Kpi label={T.kpiUpcoming} value={stats.upcoming} />
          <Kpi label={T.kpiCompletionRate} value={percent(stats.completionRate)} note={T.kpiCompletionHint} />
          <Kpi label={T.kpiCancellationRate} value={percent(stats.cancellationRate)} note={`${stats.byStatus.cancelled} · ${T.statusNoShow}: ${stats.byStatus.no_show}`} />
          <Kpi label={T.kpiRevenue} value={money(stats.revenue)} />
          <Kpi label={T.kpiRevenue30} value={money(stats.revenue30d)} />
          <Kpi label={T.kpiClients} value={stats.clients} note={T.kpiReturning(stats.returningClients)} />
          <Kpi label={T.kpiOnline} value={stats.total ? percent(stats.online / stats.total) : '—'} note={`${stats.online} / ${stats.total}`} />
          <Kpi label={T.kpiTelegram} value={stats.telegramGuests} />
        </div>
        <Row label={T.kpiLastBooking}>{date(stats.lastBookingAt)}</Row>
      </Section>

      <Section title={T.detailTrend}>
        <MonthlyBars T={T} lang={lang} monthly={monthly} currency={master.currency} />
      </Section>

      <Section title={T.detailPriceList}>
        {categories.length === 0 && <p style={{ margin: 0, fontSize: 13.5, color: 'var(--muted)' }}>{T.detailNoServices}</p>}
        {categories.map((c) => (
          <div key={c.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: c.is_active ? 'var(--ink)' : 'var(--muted)' }}>
              {localName(c, lang)}
              {c.is_hourly && <span style={{ color: 'var(--sage)', textTransform: 'none', letterSpacing: 0 }}> · {T.hourlyTag}</span>}
              {!c.is_active && <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}> ({T.detailHidden})</span>}
            </span>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ fontSize: 13.5, minWidth: 460 }}>
                <thead>
                  <tr style={{ color: 'var(--muted)', fontSize: 12, textAlign: 'left' }}>
                    <th style={{ padding: '6px 8px 6px 0', fontWeight: 600 }}>{T.colZone}</th>
                    <th style={{ padding: 6, fontWeight: 600, textAlign: 'right' }}>{T.colPrice}</th>
                    <th style={{ padding: 6, fontWeight: 600, textAlign: 'right' }}>{T.colBooked}</th>
                    <th style={{ padding: 6, fontWeight: 600, textAlign: 'right' }}>{T.colDone}</th>
                    <th style={{ padding: '6px 0 6px 6px', fontWeight: 600, textAlign: 'right' }}>{T.colRevenue}</th>
                  </tr>
                </thead>
                <tbody>
                  {c.services.map((s) => (
                    <tr key={s.id} style={{ borderTop: '1px solid var(--line)', color: s.is_active ? 'var(--ink)' : 'var(--muted)' }}>
                      <td style={{ padding: '7px 8px 7px 0' }}>
                        {localName(s, lang)}
                        <span style={{ color: 'var(--muted)', fontSize: 12 }}> · {s.duration_minutes} {T.minUnit}{!s.is_active && ` · ${T.detailHidden}`}</span>
                      </td>
                      <td style={{ padding: 7, textAlign: 'right', whiteSpace: 'nowrap' }}>{money(s.price)}{c.is_hourly ? ` ${T.perHourSuffix}` : ''}</td>
                      <td style={{ padding: 7, textAlign: 'right' }}>{s.bookings}</td>
                      <td style={{ padding: 7, textAlign: 'right' }}>{s.completed}</td>
                      <td style={{ padding: '7px 0 7px 7px', textAlign: 'right', whiteSpace: 'nowrap' }}>{money(s.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </Section>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
        <Section title={T.detailAccount}>
          <Row label={T.detailEmail}>{master.email}</Row>
          <Row label={T.detailSignedUp}>{date(master.createdAt)}</Row>
          <Row label={T.detailRegion}>
            {master.timezone.replace(/_/g, ' ')} · {master.currency} · {master.languages.map((l) => LANG_META[l].code).join(', ')}
          </Row>
          {master.customDomain && <Row label={T.customDomainBtn}>{master.customDomain}</Row>}
          <Row label="Telegram">{master.telegramConnected ? `✓ ${T.detailYes}` : T.detailNo}</Row>
        </Section>
        <Section title={T.detailProfile}>
          <Row label={T.detailHasPhoto}>{profile.hasPhoto ? `✓ ${T.detailYes}` : T.detailNo}</Row>
          <Row label={T.detailHasAbout}>{profile.hasAbout ? `✓ ${T.detailYes}` : T.detailNo}</Row>
          {contacts.length === 0 && <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>{T.detailNoContacts}</p>}
          {contacts.map(([key, value]) => (
            <Row key={key} label={T[key]}>{value}</Row>
          ))}
        </Section>
      </div>
    </div>
  );
}

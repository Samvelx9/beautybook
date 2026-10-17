import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { formatDate, formatPlatformPrice } from '../i18n.js';

const SR_ONLY = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' };

function Tile({ label, value, note }) {
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>
      <span style={{ fontSize: 24, fontWeight: 700, fontFamily: "'Newsreader',serif" }}>{value}</span>
      {note && <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>{note}</span>}
    </div>
  );
}

// How the platform is doing: where every account stands, how many trials
// became subscriptions, the monthly revenue at the advertised prices, and
// sign-ups per week. One series of bars — the week's total — with the split
// between individual masters and salons in each bar's tooltip and the table.
export default function PlatformOverview({ T, lang, onAuthError }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const [hover, setHover] = useState(null);

  useEffect(() => {
    api.getPlatformOverview().then(setData).catch((err) => {
      if (!onAuthError(err)) setError(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) return <p style={{ color: 'var(--terracotta)' }}>{T.genericError}</p>;
  if (!data) return <p style={{ color: 'var(--muted)' }}>{T.loading}</p>;

  const money = (minor) => formatPlatformPrice(minor, data.mrr.currency, lang);
  const weeks = data.weeks.map((w) => ({ ...w, total: w.individual + w.salons }));
  const max = Math.max(1, ...weeks.map((w) => w.total));
  const weekLabel = (w) => formatDate(new Date(`${w.week}T12:00:00`), lang);
  const PLOT = 140;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
        <Tile label={T.ovMrr} value={money(data.mrr.minor)} note={T.ovMrrNote} />
        <Tile label={T.ovPaying} value={data.states.paying} note={T.ovAccountsOf(data.accounts)} />
        <Tile label={T.ovTrial} value={data.states.trial} />
        <Tile
          label={T.ovConversion}
          value={data.conversion.rate === null ? '—' : `${Math.round(data.conversion.rate * 100)}%`}
          note={T.ovConversionNote(data.conversion.converted, data.conversion.trialsEnded)}
        />
        <Tile label={T.ovBookings30} value={data.bookings30d} />
      </div>

      <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h3 style={{ fontSize: 16, fontWeight: 600 }}>{T.ovSignupsTitle}</h3>
        <div style={{ position: 'relative' }}>
          <div
            role="img"
            aria-label={T.ovSignupsTitle}
            style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: PLOT, borderBottom: '1px solid var(--line)' }}
          >
            {weeks.map((w, i) => (
              <div
                key={w.week}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                tabIndex={0}
                aria-label={`${weekLabel(w)}: ${T.ovWeekSplit(w.individual, w.salons)}`}
                // The hit area is the whole column, not just the bar.
                style={{ flex: 1, height: '100%', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', cursor: 'default', outline: 'none' }}
              >
                <div
                  style={{
                    width: '70%',
                    maxWidth: 28,
                    height: w.total ? Math.max(3, (w.total / max) * (PLOT - 22)) : 0,
                    background: hover === i ? 'var(--ink)' : 'var(--sage)',
                    borderRadius: '4px 4px 0 0',
                  }}
                />
              </div>
            ))}
          </div>
          {hover !== null && (
            <div
              role="status"
              style={{
                position: 'absolute',
                top: 0,
                left: `${((hover + 0.5) / weeks.length) * 100}%`,
                transform: `translateX(${hover > weeks.length / 2 ? '-100%' : '0'})`,
                background: 'var(--white)',
                border: '1px solid var(--line)',
                borderRadius: 8,
                padding: '6px 10px',
                fontSize: 12.5,
                pointerEvents: 'none',
                whiteSpace: 'nowrap',
                boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
              }}
            >
              <strong>{T.ovWeekOf(weekLabel(weeks[hover]))}</strong>
              <div>{T.ovWeekSplit(weeks[hover].individual, weeks[hover].salons)}</div>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: 'var(--muted)', marginTop: 4 }}>
            <span>{weekLabel(weeks[0])}</span>
            <span>{T.ovMaxWeek(max)}</span>
            <span>{weekLabel(weeks.at(-1))}</span>
          </div>
        </div>
        <table style={SR_ONLY}>
          <caption>{T.ovSignupsTitle}</caption>
          <thead><tr><th>{T.ovWeek}</th><th>{T.kindIndividual}</th><th>{T.kindSalon}</th></tr></thead>
          <tbody>
            {weeks.map((w) => (
              <tr key={w.week}><td>{weekLabel(w)}</td><td>{w.individual}</td><td>{w.salons}</td></tr>
            ))}
          </tbody>
        </table>
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
        <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600 }}>{T.ovStatesTitle}</h3>
          {Object.entries(data.states).map(([state, n]) => (
            <div key={state} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5 }}>
              <span>{T.ovStates[state]}</span>
              <strong>{n}</strong>
            </div>
          ))}
        </section>
        <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600 }}>{T.ovMrrByPlan}</h3>
          {Object.keys(data.mrr.byPlan).length === 0 && <span style={{ fontSize: 13, color: 'var(--muted)' }}>{T.noData}</span>}
          {Object.entries(data.mrr.byPlan).map(([plan, p]) => (
            <div key={plan} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13.5 }}>
              <span>{plan === 'individual' ? T.kindIndividual : `${T.kindSalon}, ${T.planNames[plan]}`} · {p.accounts}</span>
              <strong>{money(p.mrrMinor)}</strong>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}

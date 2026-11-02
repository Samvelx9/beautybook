import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { formatPrice, localName, pluralize } from '../i18n.js';
import { splitLocalDateTime } from 'salon-shared/time';
import { routeParam, setRouteParams } from '../route.js';
import { MasterDot } from '../masterColors.jsx';

// Everyone who has booked, one row per phone number (GET /admin/client-base),
// sortable by any column. "Book" opens the Bookings screen's form with the
// client already filled in.

function pad(n) {
  return String(n).padStart(2, '0');
}
// A day in the master's timezone, with the year: a client base reaches back
// further than the calendar does.
function shortDate(iso) {
  if (!iso) return '';
  const { dateObj } = splitLocalDateTime(iso);
  return `${pad(dateObj.getDate())}.${pad(dateObj.getMonth() + 1)}.${dateObj.getFullYear()}`;
}

// Read out, not shown: the action column's header.
const SCREEN_READER_ONLY = {
  position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap',
};

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

// What each column sorts by. Text sorts alphabetically, numbers and dates in
// order; a client with nothing in a column (no allergies, no visit yet) goes
// last whichever way the column is sorted.
const COLUMNS = [
  { key: 'name', label: 'clientColName', value: (c) => c.name, text: true },
  { key: 'phone', label: 'clientColPhone', value: (c) => c.phone.replace(/\D/g, ''), text: true },
  { key: 'allergies', label: 'clientColAllergies', value: (c) => c.allergies, text: true },
  { key: 'visits', label: 'clientColVisits', value: (c) => c.visits, firstDir: 'desc' },
  { key: 'averageCheck', label: 'clientColAverageCheck', value: (c) => c.average_check, firstDir: 'desc' },
  { key: 'spent', label: 'clientColSpent', value: (c) => (c.spent > 0 ? c.spent : null), firstDir: 'desc' },
  { key: 'lastVisit', label: 'clientColLastVisit', value: (c) => c.last_visit && Date.parse(c.last_visit), firstDir: 'desc' },
  { key: 'nextVisit', label: 'clientColNextVisit', value: (c) => c.next_visit && Date.parse(c.next_visit) },
  { key: 'noShows', label: 'clientColNoShows', value: (c) => c.no_shows + c.cancellations, firstDir: 'desc' },
  { key: 'zones', label: 'clientColZones', value: (c, lang) => (c.zones[0] ? localName(c.zones[0], lang) : null), text: true },
  { key: 'master', label: 'clientColMaster', value: (c, lang, masterName) => masterName(c.usual_master_id) || null, text: true, salonOnly: true },
];
const COLUMN_KEYS = COLUMNS.map((c) => c.key);

function compare(a, b, text) {
  const blankA = a === null || a === undefined || a === '';
  const blankB = b === null || b === undefined || b === '';
  if (blankA || blankB) return blankA === blankB ? 0 : blankA ? 1 : -1;
  return text ? collator.compare(a, b) : a - b;
}

export default function ClientsScreen({ T, lang, onAuthError, salon, onBookClient }) {
  const [clients, setClients] = useState(null);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState('');
  // The sort lives in the URL, so a reload keeps it.
  const [sort, setSort] = useState(() => ({
    key: routeParam('sort', (v) => COLUMN_KEYS.includes(v), 'lastVisit'),
    dir: routeParam('dir', (v) => v === 'asc' || v === 'desc', 'desc'),
  }));

  useEffect(() => {
    api
      .getClientBase()
      .then(setClients)
      .catch((err) => {
        if (!onAuthError(err)) setError(true);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A salon's owner sees whose client each one usually is.
  const masters = salon?.masters ?? [];
  const masterOf = (id) => masters.find((m) => m.id === id);
  const masterName = (id) => {
    const m = masterOf(id);
    return m ? m.name || m.slug : '';
  };
  const columns = COLUMNS.filter((c) => !c.salonOnly || masters.length > 1);

  const applySort = (key, dir) => {
    setSort({ key, dir });
    setRouteParams({ sort: key, dir });
  };
  // A column's header: sorts by it, or turns it round if it's the sort already.
  const sortBy = (key) => {
    const column = COLUMNS.find((c) => c.key === key);
    applySort(key, sort.key === key ? (sort.dir === 'asc' ? 'desc' : 'asc') : column.firstDir ?? 'asc');
  };

  const shown = useMemo(() => {
    if (!clients) return [];
    const q = query.trim().toLocaleLowerCase();
    const digits = q.replace(/\D/g, '');
    const matches = (c) =>
      !q ||
      c.names.some((n) => n.toLocaleLowerCase().includes(q)) ||
      (c.allergies ?? '').toLocaleLowerCase().includes(q) ||
      (digits.length >= 3 && c.phone.replace(/\D/g, '').includes(digits));
    const column = COLUMNS.find((c) => c.key === sort.key);
    const sign = sort.dir === 'asc' ? 1 : -1;
    return clients
      .filter(matches)
      .map((c) => ({ c, v: column.value(c, lang, masterName) }))
      .sort((a, b) => {
        const blank = (v) => v === null || v === undefined || v === '';
        // Blanks last both ways round.
        if (blank(a.v) || blank(b.v)) return compare(a.v, b.v, column.text);
        return sign * compare(a.v, b.v, column.text) || collator.compare(a.c.name, b.c.name);
      })
      .map(({ c }) => c);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clients, query, sort, lang, salon]);

  const muted = { margin: 0, fontSize: 13, color: 'var(--muted)' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <h2 style={{ fontSize: 22, fontWeight: 500 }}>{T.clientsTitle}</h2>
        <p style={muted}>{T.clientsIntro}</p>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <input
          className="field-input"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={T.clientsSearchPlaceholder}
          aria-label={T.clientsSearchPlaceholder}
          style={{ maxWidth: 360, flex: '1 1 240px' }}
        />
        {/* On a phone there are no column headers to tap: the sort is picked here. */}
        <div className="clients-sort-phone" style={{ alignItems: 'center', gap: 8, flex: '1 1 100%' }}>
          <select
            className="field-input"
            value={sort.key}
            aria-label={T.clientsSortBy}
            onChange={(e) => applySort(e.target.value, COLUMNS.find((c) => c.key === e.target.value).firstDir ?? 'asc')}
            style={{ flex: 1 }}
          >
            {columns.map((col) => (
              <option key={col.key} value={col.key}>
                {T.clientsSortBy}: {T[col.label]}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn-outline"
            onClick={() => applySort(sort.key, sort.dir === 'asc' ? 'desc' : 'asc')}
            aria-label={sort.dir === 'asc' ? T.sortAscending : T.sortDescending}
            title={sort.dir === 'asc' ? T.sortAscending : T.sortDescending}
            style={{ flexShrink: 0, padding: '8px 14px' }}
          >
            {sort.dir === 'asc' ? '▲' : '▼'}
          </button>
        </div>
        {clients && (
          <span style={muted}>
            {shown.length} {pluralize(shown.length, lang, 'clients')}
          </span>
        )}
      </div>

      {error && <p role="alert" style={{ margin: 0, fontSize: 13, color: 'var(--terracotta)' }}>{T.genericError}</p>}

      {clients === null ? (
        !error && <p style={muted}>{T.loading}</p>
      ) : clients.length === 0 ? (
        <p className="card" style={muted}>{T.noClientsYet}</p>
      ) : shown.length === 0 ? (
        <p className="card" style={muted}>{T.noClientsMatch}</p>
      ) : (
        <>
        <ul className="clients-cards" style={{ flexDirection: 'column', gap: 10, margin: 0, padding: 0 }}>
          {shown.map((c) => (
            <ClientCard
              key={c.phone}
              T={T}
              lang={lang}
              client={c}
              columns={columns}
              master={masterOf(c.usual_master_id)}
              onBook={() => onBookClient(c)}
            />
          ))}
        </ul>
        <div className="card clients-table" style={{ padding: 0, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                <th scope="col" style={{ borderBottom: '1px solid var(--line)' }}>
                  <span style={SCREEN_READER_ONLY}>{T.bookClientBtn}</span>
                </th>
                {columns.map((col) => {
                  const active = sort.key === col.key;
                  return (
                    <th
                      key={col.key}
                      scope="col"
                      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                      style={{ padding: 0, borderBottom: '1px solid var(--line)', textAlign: 'left', verticalAlign: 'bottom' }}
                    >
                      <button
                        type="button"
                        onClick={() => sortBy(col.key)}
                        style={{
                          display: 'flex',
                          alignItems: 'flex-end',
                          gap: 4,
                          width: '100%',
                          padding: '10px 8px',
                          textAlign: 'left',
                          lineHeight: 1.25,
                          fontSize: 12,
                          fontWeight: 600,
                          color: active ? 'var(--ink)' : 'var(--muted)',
                        }}
                      >
                        {T[col.label]}
                        <span aria-hidden="true" style={{ fontSize: 10, opacity: active ? 1 : 0.35 }}>
                          {active && sort.dir === 'desc' ? '▼' : '▲'}
                        </span>
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {shown.map((c) => (
                <ClientRow
                  key={c.phone}
                  T={T}
                  lang={lang}
                  client={c}
                  columns={columns}
                  master={masterOf(c.usual_master_id)}
                  onBook={() => onBookClient(c)}
                />
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}
    </div>
  );
}

// What each column shows for one client: the table's cells and the phone
// cards are made of the same pieces.
function clientCells({ T, lang, client: c, master }) {
  const others = c.names.filter((n) => n !== c.name);
  const small = { display: 'block', fontSize: 12, color: 'var(--muted)', marginTop: 2 };
  return {
    name: (
      <>
        <strong style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{c.name}</strong>
        {others.length > 0 && <span style={small}>{T.alsoBookedAs} {others.join(', ')}</span>}
        {c.telegram && <span style={small}>{T.clientTelegramOn}</span>}
      </>
    ),
    phone: <span style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{c.phone}</span>,
    allergies: c.allergies ? (
      <span style={{ display: 'block', minWidth: 120, color: 'var(--status-off)', fontWeight: 600 }}>⚠ {c.allergies}</span>
    ) : (
      <span style={{ color: 'var(--muted)' }}>—</span>
    ),
    visits: (
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>
        {c.visits}
        {c.upcoming > 0 && <span style={small}>{T.clientUpcoming(c.upcoming)}</span>}
      </span>
    ),
    averageCheck: <Money value={c.average_check} lang={lang} />,
    spent: <Money value={c.spent > 0 ? c.spent : null} lang={lang} />,
    lastVisit: <DateCell iso={c.last_visit} />,
    nextVisit: <DateCell iso={c.next_visit} />,
    noShows:
      c.no_shows + c.cancellations > 0 ? (
        <span style={{ whiteSpace: 'nowrap' }}>
          {c.no_shows > 0 && <span style={{ display: 'block' }}>{T.clientNoShows(c.no_shows)}</span>}
          {c.cancellations > 0 && <span style={{ display: 'block', color: 'var(--muted)' }}>{T.clientCancellations(c.cancellations)}</span>}
        </span>
      ) : (
        <span style={{ color: 'var(--muted)' }}>—</span>
      ),
    zones: c.zones.length ? (
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 140 }}>
        {c.zones.map((z) => (
          <span key={z.service_id}>
            {localName(z, lang)} <span style={{ color: 'var(--muted)' }}>×{z.count}</span>
          </span>
        ))}
      </span>
    ) : (
      <span style={{ color: 'var(--muted)' }}>—</span>
    ),
    master: master ? (
      <span style={{ whiteSpace: 'nowrap' }}>
        <MasterDot color={master.color} size={8} style={{ marginRight: 5 }} />
        {master.name || master.slug}
      </span>
    ) : (
      <span style={{ color: 'var(--muted)' }}>—</span>
    ),
  };
}

function ClientRow({ T, lang, client: c, columns, master, onBook }) {
  const cell = { padding: '10px 8px', borderBottom: '1px solid var(--line)', verticalAlign: 'top' };
  const content = clientCells({ T, lang, client: c, master });
  return (
    <tr>
      {/* First, so it's in reach however far the table scrolls sideways. */}
      <td style={cell}>
        <button className="btn-primary" style={{ whiteSpace: 'nowrap', padding: '6px 14px' }} onClick={onBook}>
          {T.bookClientBtn}
        </button>
      </td>
      {columns.map((col) => (
        <td key={col.key} style={col.key === 'name' ? { ...cell, minWidth: 150 } : cell}>
          {content[col.key]}
        </td>
      ))}
    </tr>
  );
}

// The same client on a phone: name, phone and allergies first, the numbers
// in two columns below, and "Book" in reach of a thumb.
function ClientCard({ T, lang, client: c, columns, master, onBook }) {
  const content = clientCells({ T, lang, client: c, master });
  const details = columns.filter((col) => !['name', 'phone', 'allergies'].includes(col.key));
  return (
    <li className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 14, listStyle: 'none' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ minWidth: 0, fontSize: 15 }}>
          {content.name}
          <div style={{ marginTop: 2, fontSize: 13.5 }}>{content.phone}</div>
        </div>
        <button className="btn-primary" style={{ flexShrink: 0, padding: '8px 16px' }} onClick={onBook}>
          {T.bookClientBtn}
        </button>
      </div>
      {c.allergies && <div style={{ fontSize: 13.5 }}>{content.allergies}</div>}
      <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 14px', fontSize: 13.5 }}>
        {details.map((col) => (
          <div key={col.key} style={col.key === 'zones' ? { gridColumn: '1 / -1' } : undefined}>
            <dt style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 2 }}>{T[col.label]}</dt>
            <dd style={{ margin: 0 }}>{content[col.key]}</dd>
          </div>
        ))}
      </dl>
    </li>
  );
}

function Money({ value, lang }) {
  if (value === null || value === undefined) return <span style={{ color: 'var(--muted)' }}>—</span>;
  return <span style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{formatPrice(value, lang)}</span>;
}

function DateCell({ iso }) {
  if (!iso) return <span style={{ color: 'var(--muted)' }}>—</span>;
  return <span style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{shortDate(iso)}</span>;
}

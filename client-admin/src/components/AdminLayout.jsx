import LangSwitcher from './LangSwitcher.jsx';
import { PRODUCT_NAME } from '../i18n.js';

const TAB_LABEL_KEY = {
  dashboard: 'navDashboard',
  bookings: 'navBookings',
  categories: 'navCategories',
  services: 'navServices',
  availability: 'navAvailability',
  profile: 'navProfile',
  settings: 'navSettings',
  platform: 'navPlatform',
};

const DAY_MS = 24 * 60 * 60 * 1000;

// One line above every screen about the account's standing, when there's
// something to say: days left of the trial, or why the page has stopped
// taking bookings. Its button opens Settings, where the subscription lives.
function AccessBanner({ T, access, onOpen }) {
  if (!access) return null;
  let text = null;
  let urgent = false;
  if (access.state === 'trial') {
    const days = Math.max(0, Math.ceil((new Date(access.trialEndsAt) - Date.now()) / DAY_MS));
    text = T.bannerTrial(days);
    urgent = days <= 2;
  } else if (access.state === 'expired') {
    text = T.bannerExpired;
    urgent = true;
  } else if (access.state === 'past_due') {
    text = T.bannerPastDue;
    urgent = true;
  } else if (access.state === 'suspended') {
    text = T.bannerSuspended;
    urgent = true;
  }
  if (!text) return null;

  return (
    <div style={{ background: urgent ? 'var(--terracotta-light)' : 'var(--sage-light)', borderBottom: '1px solid var(--line)' }}>
      <div
        className="admin-content"
        style={{ padding: '10px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}
      >
        <span style={{ fontSize: 13.5 }}>{text}</span>
        {access.state !== 'suspended' && (
          <button className="btn-primary" style={{ padding: '7px 14px', fontSize: 13 }} onClick={onOpen}>
            {T.subscribeBtn}
          </button>
        )}
      </div>
    </div>
  );
}

export default function AdminLayout({ T, lang, setLang, tabs, tab, setTab, onLogout, account, children }) {
  const siteUrl = account?.master?.siteUrl;
  return (
    <div className="admin-shell">
      <div style={{ borderBottom: '1px solid var(--line)', background: 'var(--white)' }}>
        <div
          className="admin-content"
          style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <h2 style={{ fontSize: 18, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {PRODUCT_NAME}
            </h2>
            {siteUrl && (
              <a
                href={siteUrl}
                target="_blank"
                rel="noreferrer"
                style={{ fontSize: 12.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
              >
                {siteUrl.replace(/^https?:\/\//, '')} ↗
              </a>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            <LangSwitcher lang={lang} setLang={setLang} />
            <button onClick={onLogout} className="btn-outline">
              {T.logout}
            </button>
          </div>
        </div>
      </div>

      <AccessBanner T={T} access={account?.access} onOpen={() => setTab('settings')} />

      <div style={{ borderBottom: '1px solid var(--line)', background: 'var(--surface)' }}>
        <div className="admin-content" style={{ padding: 0, display: 'flex', gap: 4, overflowX: 'auto' }}>
          {tabs.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                padding: '14px 16px',
                fontSize: 14,
                fontWeight: 600,
                color: tab === t ? 'var(--sage)' : 'var(--muted)',
                borderBottom: tab === t ? '2px solid var(--sage)' : '2px solid transparent',
                whiteSpace: 'nowrap',
              }}
            >
              {T[TAB_LABEL_KEY[t]]}
            </button>
          ))}
        </div>
      </div>

      <div className="admin-content">{children}</div>
    </div>
  );
}

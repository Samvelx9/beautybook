import { randomBytes } from 'node:crypto';
import { pool } from '../db.js';

// Columns every request handling a master needs: how to reach their page,
// their locale, and enough billing state to decide whether the page is open.
export const MASTER_COLUMNS = `m.id, m.slug, m.custom_domain, m.timezone, m.currency,
  m.languages, m.default_lang, m.notify_lang, m.telegram_chat_id, m.trial_ends_at,
  m.subscription_status, m.period_ends_at, m.customer_portal_url, m.suspended_at,
  m.min_notice_minutes, m.created_at`;

// Subdomains that will never be a master's page: the platform's own hosts and
// names a visitor would mistake for something official.
export const RESERVED_SLUGS = new Set([
  'www', 'app', 'api', 'admin', 'administrator', 'mail', 'email', 'smtp', 'imap', 'pop',
  'ftp', 'static', 'assets', 'cdn', 'media', 'img', 'images', 'files', 'help', 'support',
  'status', 'blog', 'docs', 'dev', 'staging', 'test', 'demo', 'billing', 'pay', 'payment',
  'payments', 'account', 'accounts', 'login', 'signup', 'register', 'auth', 'dashboard',
  'telegram', 'bot', 'root', 'system', 'platform', 'security', 'abuse', 'postmaster',
  'webmaster', 'hostmaster', 'ns1', 'ns2', 'mx', 'about', 'pricing', 'terms', 'privacy',
]);

export const SLUG_PATTERN = /^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$/;

export function slugProblem(slug) {
  if (typeof slug !== 'string' || !SLUG_PATTERN.test(slug)) return 'invalid_slug';
  if (slug.includes('--')) return 'invalid_slug';
  if (RESERVED_SLUGS.has(slug)) return 'slug_reserved';
  return null;
}

export const TRIAL_DAYS = 7;

export function platformDomain() {
  return (process.env.PLATFORM_DOMAIN ?? 'localhost').toLowerCase().replace(/^\.+|\.+$/g, '');
}

// The page a master's guests book on.
export function masterSiteUrl(master) {
  if (master.custom_domain) return `https://${master.custom_domain}`;
  const domain = platformDomain();
  // A dev machine serves the guest app on Vite's port with *.localhost names.
  if (domain === 'localhost') {
    return `http://${master.slug}.localhost:${process.env.GUEST_DEV_PORT ?? 5173}`;
  }
  return `https://${master.slug}.${domain}`;
}

// Whether a master's public booking page takes bookings right now.
//
// - A suspended master is off, whatever they've paid.
// - Lemon Squeezy's on_trial / active count, and so does past_due: Lemon
//   Squeezy retries a failed renewal for a while, and a page that closes on
//   the first declined card would cost the master clients over a bank hiccup.
// - A cancelled subscription keeps working until the period it paid for ends.
// - Otherwise the free trial decides.
export function hasAccess(master, now = new Date()) {
  if (!master || master.suspended_at) return false;
  const status = master.subscription_status;
  if (status === 'active' || status === 'on_trial' || status === 'past_due') return true;
  if (status === 'cancelled' && master.period_ends_at && new Date(master.period_ends_at) > now) {
    return true;
  }
  return new Date(master.trial_ends_at) > now;
}

// What the admin panel shows about the account's standing.
export function accessSummary(master) {
  const now = new Date();
  let state;
  if (master.suspended_at) state = 'suspended';
  else if (['active', 'on_trial', 'past_due', 'cancelled'].includes(master.subscription_status) && hasAccess(master, now)) {
    state = master.subscription_status;
  } else if (hasAccess(master, now)) state = 'trial';
  else state = 'expired';
  return {
    state,
    hasAccess: hasAccess(master, now),
    trialEndsAt: master.trial_ends_at,
    periodEndsAt: master.period_ends_at,
    subscriptionStatus: master.subscription_status,
    customerPortalUrl: master.customer_portal_url,
  };
}

export async function getMasterById(id, db = pool) {
  const { rows } = await db.query(`SELECT ${MASTER_COLUMNS} FROM masters m WHERE m.id = $1`, [id]);
  return rows[0] ?? null;
}

// The master a guest request is for, from the host it was made to:
// "<slug>.<platform domain>" or a master's own domain.
export async function getMasterByHost(rawHost) {
  const host = String(rawHost ?? '').toLowerCase().split(':')[0].replace(/\.$/, '');
  if (!host) return null;
  const domain = platformDomain();

  if (host.endsWith(`.${domain}`)) {
    const slug = host.slice(0, -(domain.length + 1));
    if (!SLUG_PATTERN.test(slug)) return null;
    const { rows } = await pool.query(`SELECT ${MASTER_COLUMNS} FROM masters m WHERE m.slug = $1`, [slug]);
    return rows[0] ?? null;
  }

  const bare = host.replace(/^www\./, '');
  const { rows } = await pool.query(
    `SELECT ${MASTER_COLUMNS} FROM masters m WHERE m.custom_domain = $1`,
    [bare]
  );
  return rows[0] ?? null;
}

export function newConnectToken() {
  // Telegram's start parameter allows A–Z a–z 0–9 _ - up to 64 characters; the
  // "m_" prefix tells a master's connect link from a guest's booking token.
  return `m_${randomBytes(18).toString('base64url')}`;
}

// A new master and everything their page needs to exist: a profile row (so
// the landing page renders, even blank), and a working week to start from —
// Monday to Friday 10–19, Saturday 10–16, Sunday off — which they adjust in
// the admin panel.
const DEFAULT_WEEK = [
  [0, false, null, null],
  [1, true, '10:00', '19:00'],
  [2, true, '10:00', '19:00'],
  [3, true, '10:00', '19:00'],
  [4, true, '10:00', '19:00'],
  [5, true, '10:00', '19:00'],
  [6, true, '10:00', '16:00'],
];

export async function createMaster(client, { slug, timezone, currency, languages, defaultLang, displayName }) {
  const { rows } = await client.query(
    `INSERT INTO masters (slug, timezone, currency, languages, default_lang, trial_ends_at)
     VALUES ($1, $2, $3, $4, $5, now() + make_interval(days => $6))
     RETURNING id`,
    [slug, timezone, currency, languages, defaultLang, TRIAL_DAYS]
  );
  const masterId = rows[0].id;

  // The name they signed up with goes into every language they offer, as a
  // starting point they can translate later.
  const name = (lang) => (languages.includes(lang) ? displayName : '');
  await client.query(
    `INSERT INTO salon_profile (master_id, owner_name_en, owner_name_ru, owner_name_hy)
     VALUES ($1, $2, $3, $4)`,
    [masterId, name('en'), name('ru'), name('hy')]
  );

  for (const [day, open, start, end] of DEFAULT_WEEK) {
    await client.query(
      `INSERT INTO weekly_hours (master_id, day_of_week, is_open, start_time, end_time)
       VALUES ($1, $2, $3, $4, $5)`,
      [masterId, day, open, start, end]
    );
  }
  return masterId;
}

// Removes a master and everything they own. The foreign keys cascade from
// `masters`, but a booked zone is protected (booking_items → services is
// RESTRICT), and Postgres checks that before it has cascaded away the
// bookings' items — so the bookings go first, in the same transaction.
export async function deleteMaster(masterId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM bookings WHERE master_id = $1', [masterId]);
    await client.query('DELETE FROM masters WHERE id = $1', [masterId]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

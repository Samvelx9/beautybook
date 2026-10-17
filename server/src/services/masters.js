import { randomBytes } from 'node:crypto';
import { pool } from '../db.js';

// Columns every request handling a master needs: how to reach their page,
// their locale, and enough billing state to decide whether the page is open.
// Billing belongs to the master's organization (a salon pays once for all its
// masters) and comes along under its own column names, so a master row is
// still all hasAccess() needs. Select them FROM MASTER_FROM.
export const MASTER_COLUMNS = `m.id, m.organization_id, o.kind AS organization_kind, m.slug,
  m.custom_domain, m.custom_domain_status, m.timezone, m.currency, m.languages, m.default_lang, m.notify_lang,
  m.telegram_chat_id, o.trial_ends_at, o.subscription_status, o.period_ends_at,
  o.customer_portal_url, o.suspended_at, m.min_notice_minutes, m.booking_window_days,
  m.deactivated_at, o.telegram_chat_id AS organization_chat_id,
  o.notify_lang AS organization_notify_lang, m.created_at`;

export const MASTER_FROM = 'masters m JOIN organizations o ON o.id = m.organization_id';

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

// The page a master's guests book on — or, given an organization, the salon's
// page. Both live at <slug>.<platform domain>; a master's own domain takes
// over once it's live (custom_domain_status 'active' — a row read without the
// status keeps to the platform address, which always works).
export function masterSiteUrl(page) {
  if (page.custom_domain && page.custom_domain_status === 'active') return `https://${page.custom_domain}`;
  const domain = platformDomain();
  // A dev machine serves the guest app on Vite's port with *.localhost names.
  if (domain === 'localhost') {
    return `http://${page.slug}.localhost:${process.env.GUEST_DEV_PORT ?? 5173}`;
  }
  return `https://${page.slug}.${domain}`;
}

// A master's new page address: valid, not reserved, and free across masters
// and salons (a unique violation or the namespace trigger, either way
// slug_taken). Returns {} or { status, error }.
export async function changeMasterSlug(masterId, rawSlug) {
  const slug = String(rawSlug ?? '').trim().toLowerCase();
  const problem = slugProblem(slug);
  if (problem) return { status: 400, error: problem };
  try {
    await pool.query('UPDATE masters SET slug = $2 WHERE id = $1', [masterId, slug]);
  } catch (err) {
    if (err.code === '23505') return { status: 409, error: 'slug_taken' };
    throw err;
  }
  return {};
}

// Whether a page address is free: neither a master's nor a salon's.
export async function isSlugTaken(slug, db = pool) {
  const { rows } = await db.query(
    'SELECT 1 FROM masters WHERE slug = $1 UNION ALL SELECT 1 FROM organizations WHERE slug = $1',
    [slug]
  );
  return rows.length > 0;
}

// Whether a master's public booking page takes bookings right now. Also
// answers for an organization row, which has the same billing columns.
//
// - A suspended organization is off, whatever it has paid, and so is a
//   master their salon has deactivated.
// - Lemon Squeezy's on_trial / active count, and so does past_due: Lemon
//   Squeezy retries a failed renewal for a while, and a page that closes on
//   the first declined card would cost the master clients over a bank hiccup.
// - A cancelled subscription keeps working until the period it paid for ends.
// - Otherwise the free trial decides.
export function hasAccess(master, now = new Date()) {
  if (!master || master.suspended_at || master.deactivated_at) return false;
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
  else if (master.deactivated_at) state = 'deactivated';
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
  const { rows } = await db.query(`SELECT ${MASTER_COLUMNS} FROM ${MASTER_FROM} WHERE m.id = $1`, [id]);
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
    const { rows } = await pool.query(`SELECT ${MASTER_COLUMNS} FROM ${MASTER_FROM} WHERE m.slug = $1`, [slug]);
    return rows[0] ?? null;
  }

  const bare = host.replace(/^www\./, '');
  const { rows } = await pool.query(
    `SELECT ${MASTER_COLUMNS} FROM ${MASTER_FROM} WHERE m.custom_domain = $1`,
    [bare]
  );
  return rows[0] ?? null;
}

// The salon whose page a guest request was made on, from its host
// ("<slug>.<platform domain>"), or null — a master's page, or nobody's.
export async function getSalonByHost(rawHost) {
  const host = String(rawHost ?? '').toLowerCase().split(':')[0].replace(/\.$/, '');
  const domain = platformDomain();
  if (!host.endsWith(`.${domain}`)) return null;
  const slug = host.slice(0, -(domain.length + 1));
  if (!SLUG_PATTERN.test(slug)) return null;
  const { rows } = await pool.query(
    `SELECT ${ORGANIZATION_COLUMNS} FROM organizations o WHERE o.slug = $1 AND o.kind = 'salon'`,
    [slug]
  );
  return rows[0] ?? null;
}

export function newConnectToken(prefix = 'm') {
  // Telegram's start parameter allows A–Z a–z 0–9 _ - up to 64 characters; the
  // prefix tells a master's connect link ("m_") and a salon owner's ("o_")
  // from a guest's booking token.
  return `${prefix}_${randomBytes(18).toString('base64url')}`;
}

export const ORGANIZATION_COLUMNS = `o.id, o.kind, o.name, o.slug, o.timezone, o.currency, o.languages,
  o.default_lang, o.notify_lang, o.telegram_chat_id, o.trial_ends_at, o.subscription_status,
  o.period_ends_at, o.customer_portal_url, o.suspended_at, o.master_share_percent, o.created_at`;

export async function getOrganizationById(id, db = pool) {
  const { rows } = await db.query(
    `SELECT ${ORGANIZATION_COLUMNS} FROM organizations o WHERE o.id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

// A new organization — the business a subscription pays for — with its free
// trial. A solo master's has just them; a salon's has its masters. The locale
// is the organization's: its masters share one price list, so one currency.
// A salon also gets its own page (`slug`) with a landing page of its own,
// headed with its name in every language it offers.
export async function createOrganization(
  client,
  { kind = 'solo', name = '', slug = null, timezone, currency, languages, defaultLang, notifyLang = 'hy' }
) {
  const { rows } = await client.query(
    `INSERT INTO organizations (kind, name, slug, timezone, currency, languages, default_lang,
                                notify_lang, trial_ends_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now() + make_interval(days => $9))
     RETURNING id`,
    [kind, name, slug, timezone, currency, languages, defaultLang, notifyLang, TRIAL_DAYS]
  );
  const id = rows[0].id;
  if (kind === 'salon') {
    const named = (lang) => (languages.includes(lang) ? name : '');
    await client.query(
      `INSERT INTO organization_profile (organization_id, owner_name_en, owner_name_ru, owner_name_hy)
       VALUES ($1, $2, $3, $4)`,
      [id, named('en'), named('ru'), named('hy')]
    );
  }
  return id;
}

// A change to the organization's timezone, currency or languages, which every
// one of its masters follows: their pages and messages read their own copy.
// Takes any of { timezone, currency, languages, defaultLang }.
export async function setOrganizationLocale(db, organizationId, locale) {
  const columns = { timezone: 'timezone', currency: 'currency', languages: 'languages', defaultLang: 'default_lang' };
  const fields = [];
  const values = [organizationId];
  for (const [key, column] of Object.entries(columns)) {
    if (locale[key] === undefined) continue;
    values.push(locale[key]);
    fields.push(`${column} = $${values.length}`);
  }
  if (fields.length === 0) return;
  await db.query(`UPDATE organizations SET ${fields.join(', ')} WHERE id = $1`, values);
  await db.query(`UPDATE masters SET ${fields.join(', ')} WHERE organization_id = $1`, values);
}

// A service just added to the price list is performed by every active master
// of the organization until the owner says otherwise — for a solo master,
// simply by them.
export async function offerByAllMasters(db, organizationId, serviceId) {
  await db.query(
    `INSERT INTO master_services (organization_id, master_id, service_id)
     SELECT $1, id, $2 FROM masters WHERE organization_id = $1 AND deactivated_at IS NULL
     ON CONFLICT DO NOTHING`,
    [organizationId, serviceId]
  );
}

// How many of an organization's masters are working — what a salon's plan
// is decided by.
export async function activeMasterCount(organizationId, db = pool) {
  const { rows } = await db.query(
    'SELECT COUNT(*)::int AS n FROM masters WHERE organization_id = $1 AND deactivated_at IS NULL',
    [organizationId]
  );
  return rows[0].n;
}

// The monthly plan a salon is on, by how many masters it has working:
// 1–5, 6–10, 11 and more. A solo master has the individual plan.
export function planFor(organization, activeMasters) {
  if (organization.kind === 'solo') return 'individual';
  if (activeMasters <= 5) return 'salon_5';
  if (activeMasters <= 10) return 'salon_10';
  return 'salon_unlimited';
}

// A new master and everything their page needs to exist: a profile row (so
// the landing page renders, even blank), a working week to start from —
// Monday to Friday 10–19, Saturday 10–16, Sunday off — which they adjust in
// the admin panel, and the whole of the organization's price list as what
// they perform (a salon's owner narrows it down).
const DEFAULT_WEEK = [
  [0, false, null, null],
  [1, true, '10:00', '19:00'],
  [2, true, '10:00', '19:00'],
  [3, true, '10:00', '19:00'],
  [4, true, '10:00', '19:00'],
  [5, true, '10:00', '19:00'],
  [6, true, '10:00', '16:00'],
];

export async function createMaster(
  client,
  { organizationId, slug, timezone, currency, languages, defaultLang, displayName }
) {
  const { rows } = await client.query(
    `INSERT INTO masters (organization_id, slug, timezone, currency, languages, default_lang)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [organizationId, slug, timezone, currency, languages, defaultLang]
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

  await client.query(
    `INSERT INTO master_services (organization_id, master_id, service_id)
     SELECT $1, $2, id FROM services WHERE organization_id = $1`,
    [organizationId, masterId]
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

// Removes an organization and everything it owns: its masters, their
// bookings, its price list and its logins. The foreign keys cascade from
// `organizations`, but a booked zone is protected (booking_items → services
// is RESTRICT), and Postgres checks that before it has cascaded away the
// bookings' items — so the bookings go first, in the same transaction.
export async function deleteOrganization(organizationId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM bookings WHERE organization_id = $1', [organizationId]);
    await client.query('DELETE FROM organizations WHERE id = $1', [organizationId]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

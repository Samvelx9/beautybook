import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { pool } from '../db.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { requirePlatformAdmin } from '../middleware/auth.js';
import {
  accessSummary,
  deleteOrganization,
  platformDomain,
  masterSiteUrl,
  planFor,
  MASTER_COLUMNS,
  MASTER_FROM,
  ORGANIZATION_COLUMNS,
} from '../services/masters.js';
import { changeOwnPassword } from '../services/accounts.js';
import { getPlatformSettings, planPriceMinor, updatePlatformSettings } from '../services/platformSettings.js';

// The platform operator's view of every master: who signed up, how their
// trial or subscription stands, and the few levers an operator needs —
// suspend, extend a trial, reset a password for someone locked out.
export const platformRouter = Router();
platformRouter.use(requirePlatformAdmin);

platformRouter.get('/masters', asyncHandler(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT ${MASTER_COLUMNS},
            u.email,
            p.owner_name_en, p.owner_name_ru, p.owner_name_hy,
            (SELECT COUNT(*)::int FROM bookings b WHERE b.master_id = m.id) AS bookings_total,
            (SELECT COUNT(*)::int FROM bookings b
              WHERE b.master_id = m.id AND b.created_at > now() - interval '30 days') AS bookings_30d,
            (SELECT COUNT(*)::int FROM services s
              WHERE s.organization_id = m.organization_id AND s.is_active) AS active_services
     FROM ${MASTER_FROM}
     LEFT JOIN users u ON u.master_id = m.id
     LEFT JOIN salon_profile p ON p.master_id = m.id
     ORDER BY m.created_at DESC`
  );
  const { rows: salons } = await pool.query(`SELECT id, name FROM organizations WHERE kind = 'salon'`);
  const salonName = new Map(salons.map((o) => [o.id, o.name]));
  res.json(
    rows.map((m) => ({
      id: m.id,
      slug: m.slug,
      email: m.email,
      name: m.owner_name_hy || m.owner_name_ru || m.owner_name_en || '',
      siteUrl: masterSiteUrl(m),
      customDomain: m.custom_domain,
      customDomainStatus: m.custom_domain_status,
      createdAt: m.created_at,
      telegramConnected: Boolean(m.telegram_chat_id),
      bookingsTotal: m.bookings_total,
      bookings30d: m.bookings_30d,
      activeServices: m.active_services,
      access: accessSummary(m),
      // The salon they work in, or null for an individual master.
      salon: salonName.has(m.organization_id) ? { id: m.organization_id, name: salonName.get(m.organization_id) } : null,
      deactivated: Boolean(m.deactivated_at),
    }))
  );
}));

// ---------------------------------------------------------------------------
// Overview: how the platform is doing
// ---------------------------------------------------------------------------

// Sign-ups per week (the last 12, empty weeks included), where every account
// stands now, how many finished trials turned into a subscription, and the
// monthly revenue paying accounts bring at the advertised prices.
platformRouter.get('/overview', asyncHandler(async (_req, res) => {
  const settings = await getPlatformSettings();
  const { rows: weeks } = await pool.query(
    `WITH weeks AS (
       SELECT generate_series(date_trunc('week', now()) - interval '11 weeks', date_trunc('week', now()), interval '1 week') AS week
     )
     SELECT to_char(weeks.week, 'YYYY-MM-DD') AS week,
            COUNT(o.id) FILTER (WHERE o.kind = 'solo')::int AS individual,
            COUNT(o.id) FILTER (WHERE o.kind = 'salon')::int AS salons
     FROM weeks
     LEFT JOIN organizations o ON date_trunc('week', o.created_at) = weeks.week
     GROUP BY weeks.week
     ORDER BY weeks.week`
  );

  const { rows } = await pool.query(`${ORGANIZATION_LIST} ORDER BY o.id`);
  const states = { trial: 0, paying: 0, cancelled: 0, expired: 0, suspended: 0 };
  const byPlan = {};
  let mrrMinor = 0;
  let trialsEnded = 0;
  let converted = 0;
  for (const o of rows) {
    const { state } = accessSummary(o);
    const paying = ['active', 'on_trial', 'past_due'].includes(state);
    if (state === 'suspended') states.suspended += 1;
    else if (paying) states.paying += 1;
    else if (state === 'cancelled') states.cancelled += 1;
    else if (state === 'trial') states.trial += 1;
    else states.expired += 1;

    if (paying) {
      const plan = planFor(o, o.active_masters);
      const price = planPriceMinor(settings, plan);
      mrrMinor += price;
      byPlan[plan] = byPlan[plan] ?? { accounts: 0, mrrMinor: 0 };
      byPlan[plan].accounts += 1;
      byPlan[plan].mrrMinor += price;
    }
    // Conversion counts only trials that are over: one still running hasn't
    // had the chance to convert.
    if (new Date(o.trial_ends_at) <= new Date() || o.subscription_status) {
      trialsEnded += 1;
      if (o.subscription_status) converted += 1;
    }
  }

  const { rows: bookingRows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM bookings WHERE created_at > now() - interval '30 days'`
  );

  res.json({
    weeks,
    accounts: rows.length,
    states,
    conversion: { trialsEnded, converted, rate: trialsEnded ? converted / trialsEnded : null },
    mrr: { minor: mrrMinor, currency: settings.priceCurrency, byPlan },
    bookings30d: bookingRows[0].n,
  });
}));

// ---------------------------------------------------------------------------
// Organizations: who pays — an individual master, or a salon and its masters
// ---------------------------------------------------------------------------

// Per organization: its masters (working / all), its owner's login, and its
// bookings — counts only.
const ORGANIZATION_LIST = `
  SELECT ${ORGANIZATION_COLUMNS},
         (SELECT COUNT(*)::int FROM masters m WHERE m.organization_id = o.id AND m.deactivated_at IS NULL) AS active_masters,
         (SELECT COUNT(*)::int FROM masters m WHERE m.organization_id = o.id) AS total_masters,
         (SELECT u.email FROM users u WHERE u.organization_id = o.id AND u.role = 'owner' ORDER BY u.id LIMIT 1) AS owner_email,
         (SELECT MIN(m.id) FROM masters m WHERE m.organization_id = o.id) AS first_master_id,
         (SELECT COUNT(*)::int FROM bookings b WHERE b.organization_id = o.id) AS bookings_total,
         (SELECT COUNT(*)::int FROM bookings b
           WHERE b.organization_id = o.id AND b.created_at > now() - interval '30 days') AS bookings_30d
  FROM organizations o`;

async function shapeOrganization(o, settings) {
  const plan = planFor(o, o.active_masters);
  // A solo master's page is theirs; a salon's is its own.
  let siteUrl = null;
  let name = o.name;
  if (o.kind === 'salon') {
    siteUrl = o.slug ? masterSiteUrl(o) : null;
  } else if (o.first_master_id) {
    const { rows } = await pool.query(
      `SELECT m.slug, m.custom_domain, m.custom_domain_status, p.owner_name_ru, p.owner_name_en, p.owner_name_hy
       FROM masters m LEFT JOIN salon_profile p ON p.master_id = m.id WHERE m.id = $1`,
      [o.first_master_id]
    );
    siteUrl = masterSiteUrl(rows[0]);
    name = rows[0].owner_name_hy || rows[0].owner_name_ru || rows[0].owner_name_en || rows[0].slug;
  }
  return {
    id: o.id,
    kind: o.kind,
    name,
    siteUrl,
    ownerEmail: o.owner_email,
    createdAt: o.created_at,
    activeMasters: o.active_masters,
    totalMasters: o.total_masters,
    // For an individual master, the one master — their detail page is the
    // organization's.
    masterId: o.kind === 'solo' ? o.first_master_id : null,
    plan,
    priceMonthlyMinor: planPriceMinor(settings, plan),
    priceCurrency: settings.priceCurrency,
    bookingsTotal: o.bookings_total,
    bookings30d: o.bookings_30d,
    access: accessSummary(o),
  };
}

platformRouter.get('/organizations', asyncHandler(async (_req, res) => {
  const settings = await getPlatformSettings();
  const { rows } = await pool.query(`${ORGANIZATION_LIST} ORDER BY o.created_at DESC`);
  res.json(await Promise.all(rows.map((o) => shapeOrganization(o, settings))));
}));

// One organization in depth: its standing and subscription, and each master's
// activity. Like a master's detail, only counts and totals — never a client.
platformRouter.get('/organizations/:id', asyncHandler(async (req, res) => {
  const id = idParam(req);
  if (id === null) return res.status(400).json({ error: 'invalid_organization_id' });
  const { rows } = await pool.query(`${ORGANIZATION_LIST} WHERE o.id = $1`, [id]);
  if (!rows[0]) return res.status(404).json({ error: 'organization_not_found' });
  const settings = await getPlatformSettings();
  const organization = await shapeOrganization(rows[0], settings);

  const { rows: billing } = await pool.query(
    'SELECT ls_subscription_id, ls_variant_id FROM organizations WHERE id = $1',
    [id]
  );
  const { rows: masters } = await pool.query(
    `SELECT m.id, m.slug, m.custom_domain, m.custom_domain_status, m.deactivated_at, m.telegram_chat_id, m.created_at,
            p.owner_name_ru, p.owner_name_en, p.owner_name_hy, u.email, u.role,
            COUNT(b.id) FILTER (WHERE b.status <> 'cancelled')::int AS bookings,
            COUNT(b.id) FILTER (WHERE b.created_at > now() - interval '30 days')::int AS bookings_30d,
            COUNT(b.id) FILTER (WHERE b.status = 'completed')::int AS completed,
            COALESCE(SUM(b.price_at_booking) FILTER (WHERE b.status = 'completed'), 0)::bigint AS revenue
     FROM masters m
     LEFT JOIN salon_profile p ON p.master_id = m.id
     LEFT JOIN users u ON u.master_id = m.id
     LEFT JOIN bookings b ON b.master_id = m.id
     WHERE m.organization_id = $1
     GROUP BY m.id, p.master_id, u.id
     ORDER BY m.deactivated_at NULLS FIRST, m.created_at, m.id`,
    [id]
  );
  const { rows: clientRows } = await pool.query(
    `SELECT COUNT(DISTINCT customer_phone)::int AS clients FROM bookings
     WHERE organization_id = $1 AND status <> 'cancelled'`,
    [id]
  );

  res.json({
    organization: {
      ...organization,
      subscriptionId: billing[0].ls_subscription_id,
      variantId: billing[0].ls_variant_id,
    },
    clients: clientRows[0].clients,
    masters: masters.map((m) => ({
      id: m.id,
      name: m.owner_name_hy || m.owner_name_ru || m.owner_name_en || m.slug,
      siteUrl: masterSiteUrl(m),
      email: m.email,
      isOwner: m.role === 'owner',
      active: !m.deactivated_at,
      telegramConnected: Boolean(m.telegram_chat_id),
      createdAt: m.created_at,
      bookings: m.bookings,
      bookings30d: m.bookings_30d,
      completed: m.completed,
      revenue: Number(m.revenue),
    })),
  });
}));

// Deletes an organization and everything it owns — an individual master's
// account, or a salon with all its masters, their logins, bookings and price
// list. Confirmed by typing the owner's email. Refused while a subscription
// is live: Lemon Squeezy would go on charging a card for an account that no
// longer exists, so it's cancelled there first.
platformRouter.delete('/organizations/:id', asyncHandler(async (req, res) => {
  const id = idParam(req);
  if (id === null) return res.status(400).json({ error: 'invalid_organization_id' });
  const { rows } = await pool.query(
    `SELECT o.subscription_status, o.period_ends_at,
            (SELECT u.email FROM users u WHERE u.organization_id = o.id AND u.role = 'owner' ORDER BY u.id LIMIT 1) AS owner_email
     FROM organizations o WHERE o.id = $1`,
    [id]
  );
  const o = rows[0];
  if (!o) return res.status(404).json({ error: 'organization_not_found' });
  const confirm = String(req.body?.confirm ?? '').trim().toLowerCase();
  if (!o.owner_email || confirm !== o.owner_email.toLowerCase()) {
    return res.status(400).json({ error: 'confirmation_mismatch' });
  }
  const paidUntil = o.subscription_status === 'cancelled' && o.period_ends_at && new Date(o.period_ends_at) > new Date();
  if (['active', 'on_trial', 'past_due', 'paused'].includes(o.subscription_status) || paidUntil) {
    return res.status(409).json({ error: 'subscription_live' });
  }
  await deleteOrganization(id);
  res.status(204).end();
}));

// { suspended: bool } | { extendTrialDays: n } — for the whole organization:
// a salon's every master at once.
platformRouter.patch('/organizations/:id', asyncHandler(async (req, res) => {
  const id = idParam(req);
  if (id === null) return res.status(400).json({ error: 'invalid_organization_id' });
  const fields = [];
  const values = [id];
  if (req.body?.suspended !== undefined) {
    fields.push(req.body.suspended ? 'suspended_at = now()' : 'suspended_at = NULL');
  }
  if (req.body?.extendTrialDays !== undefined) {
    const days = Number(req.body.extendTrialDays);
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      return res.status(400).json({ error: 'invalid_days' });
    }
    values.push(days);
    fields.push('trial_ends_at = GREATEST(trial_ends_at, now()) + make_interval(days => $2)');
  }
  if (fields.length === 0) return res.status(400).json({ error: 'no_fields_to_update' });
  const { rowCount } = await pool.query(`UPDATE organizations SET ${fields.join(', ')} WHERE id = $1`, values);
  if (rowCount === 0) return res.status(404).json({ error: 'organization_not_found' });
  res.json({ ok: true });
}));

// The operator's own password — they have no master Settings screen.
platformRouter.post('/password', asyncHandler(async (req, res) => {
  const result = await changeOwnPassword(req.user.id, req.body?.currentPassword, req.body?.newPassword);
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json({ token: result.token });
}));

// Platform-wide settings: the advertised monthly price and the support email.
platformRouter.get('/settings', asyncHandler(async (_req, res) => {
  res.json(await getPlatformSettings());
}));

platformRouter.patch('/settings', asyncHandler(async (req, res) => {
  const result = await updatePlatformSettings(req.body);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json(result);
}));

// A domain someone could own: labels of letters, digits and inner hyphens,
// a top-level part of letters, 253 characters at most — and not the
// platform's own domain or one under it, which already serve the platform.
// The server's domain script checks the same before using it.
function isCustomDomain(domain) {
  const label = '[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?';
  if (domain.length > 253 || !new RegExp(`^(${label}\\.)+[a-z]{2,63}$`).test(domain)) return false;
  const platform = platformDomain();
  return domain !== platform && !domain.endsWith(`.${platform}`);
}

const idParam = (req) => {
  const id = Number(req.params.id);
  return Number.isInteger(id) ? id : null;
};

// { suspended: bool } | { extendTrialDays: n } | { customDomain: "x.com" | null }
//
// Suspension and the trial belong to the master's organization — for a salon
// they switch every one of its masters at once. The domain is the master's own.
platformRouter.patch('/masters/:id', asyncHandler(async (req, res) => {
  const id = idParam(req);
  if (id === null) return res.status(400).json({ error: 'invalid_master_id' });

  // One UPDATE per table, each with its own parameters; `$1` is the master id.
  const org = { fields: [], values: [id] };
  const master = { fields: [], values: [id] };
  const set = (target, sql, value) => {
    target.values.push(value);
    target.fields.push(sql.replace('?', `$${target.values.length}`));
  };

  if (req.body?.suspended !== undefined) {
    org.fields.push(req.body.suspended ? 'suspended_at = now()' : 'suspended_at = NULL');
  }
  if (req.body?.extendTrialDays !== undefined) {
    const days = Number(req.body.extendTrialDays);
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      return res.status(400).json({ error: 'invalid_days' });
    }
    // From whichever is later — now or the current end — so extending an
    // expired trial gives the full number of days.
    set(org, 'trial_ends_at = GREATEST(trial_ends_at, now()) + make_interval(days => ?)', days);
  }
  if (req.body?.customDomain !== undefined) {
    const domain = req.body.customDomain
      ? String(req.body.customDomain).trim().toLowerCase().replace(/^www\./, '')
      : null;
    if (domain && !isCustomDomain(domain)) {
      return res.status(400).json({ error: 'invalid_domain' });
    }
    set(master, 'custom_domain = ?', domain);
    // The server puts a new domain live by itself (deploy/custom-domains) and
    // records how that goes; a removed one is taken down the same way.
    master.fields.push(domain ? "custom_domain_status = 'pending'" : 'custom_domain_status = NULL');
    master.fields.push('custom_domain_attempts = 0', 'custom_domain_checked_at = NULL');
  }
  if (org.fields.length === 0 && master.fields.length === 0) {
    return res.status(400).json({ error: 'no_fields_to_update' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rowCount } = await client.query('SELECT 1 FROM masters WHERE id = $1', [id]);
    if (rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'master_not_found' });
    }
    if (org.fields.length) {
      await client.query(
        `UPDATE organizations SET ${org.fields.join(', ')}
          WHERE id = (SELECT organization_id FROM masters WHERE id = $1)`,
        org.values
      );
    }
    if (master.fields.length) {
      await client.query(`UPDATE masters SET ${master.fields.join(', ')} WHERE id = $1`, master.values);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') return res.status(409).json({ error: 'domain_taken' });
    throw err;
  } finally {
    client.release();
  }
  res.json({ ok: true });
}));

// A one-time password for a master who's locked out, shown once to the
// operator to pass on. Ends the master's existing sessions.
platformRouter.post('/masters/:id/reset-password', asyncHandler(async (req, res) => {
  const id = idParam(req);
  if (id === null) return res.status(400).json({ error: 'invalid_master_id' });
  const password = randomBytes(9).toString('base64url');
  const { rowCount } = await pool.query(
    `UPDATE users SET password_hash = $2, token_version = token_version + 1 WHERE master_id = $1`,
    [id, await bcrypt.hash(password, 12)]
  );
  if (rowCount === 0) return res.status(404).json({ error: 'master_not_found' });
  res.json({ password });
}));

// One master in depth: their account and standing, their whole price list
// with how each zone sells, and how their bookings go overall.
//
// Only aggregates about the master's clients — counts, rates, totals — never a
// client's name or phone. Those belong to the master; the operator can run
// the platform without them.
platformRouter.get('/masters/:id', asyncHandler(async (req, res) => {
  const id = idParam(req);
  if (id === null) return res.status(400).json({ error: 'invalid_master_id' });

  const { rows: masterRows } = await pool.query(
    `SELECT ${MASTER_COLUMNS}, u.email,
            p.owner_name_en, p.owner_name_ru, p.owner_name_hy,
            p.phone, p.whatsapp, p.telegram, p.instagram, p.email AS contact_email,
            p.address_en, p.address_ru, p.address_hy,
            (p.photo_data IS NOT NULL) AS has_photo,
            (p.about_en <> '' OR p.about_ru <> '' OR p.about_hy <> '') AS has_about
     FROM ${MASTER_FROM}
     LEFT JOIN users u ON u.master_id = m.id
     LEFT JOIN salon_profile p ON p.master_id = m.id
     WHERE m.id = $1`,
    [id]
  );
  const m = masterRows[0];
  if (!m) return res.status(404).json({ error: 'master_not_found' });

  // The price list, each zone with what it has sold: bookings that weren't
  // cancelled, how many of those were completed, and what the completed ones
  // brought in (at the price they were booked at).
  const { rows: categories } = await pool.query(
    `SELECT id, name_en, name_ru, name_hy, is_active, is_hourly, sort_order
     FROM service_categories WHERE organization_id = $1 ORDER BY sort_order, id`,
    [m.organization_id]
  );
  const { rows: services } = await pool.query(
    `SELECT s.id, s.category_id, s.name_en, s.name_ru, s.name_hy, s.duration_minutes, s.price,
            s.is_active,
            COUNT(DISTINCT b.id) FILTER (WHERE b.status <> 'cancelled')::int AS bookings,
            COUNT(DISTINCT b.id) FILTER (WHERE b.status = 'completed')::int AS completed,
            COALESCE(SUM(i.price_at_booking) FILTER (WHERE b.status = 'completed'), 0)::bigint AS revenue
     FROM services s
     LEFT JOIN booking_items i ON i.service_id = s.id
     LEFT JOIN bookings b ON b.id = i.booking_id AND b.master_id = $2
     WHERE s.organization_id = $1
     GROUP BY s.id
     ORDER BY s.sort_order, s.id`,
    [m.organization_id, id]
  );
  const byCategory = new Map(categories.map((c) => [c.id, { ...c, services: [] }]));
  for (const s of services) {
    byCategory.get(s.category_id)?.services.push({ ...s, revenue: Number(s.revenue) });
  }

  // Overall booking statistics. "Online" bookings are the ones guests made on
  // the page (they carry a guest token); the rest the master entered by hand.
  const { rows: statRows } = await pool.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status = 'confirmed')::int AS confirmed,
            COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
            COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
            COUNT(*) FILTER (WHERE status = 'no_show')::int AS no_show,
            COUNT(*) FILTER (WHERE status = 'confirmed' AND start_time > now())::int AS upcoming,
            COUNT(*) FILTER (WHERE guest_token IS NOT NULL)::int AS online,
            COUNT(*) FILTER (WHERE guest_chat_id IS NOT NULL OR guest_linked_at IS NOT NULL)::int AS telegram_guests,
            COUNT(*) FILTER (WHERE created_at > now() - interval '30 days')::int AS created_30d,
            COALESCE(SUM(price_at_booking) FILTER (WHERE status = 'completed'), 0)::bigint AS revenue,
            COALESCE(SUM(price_at_booking) FILTER (
              WHERE status = 'completed' AND start_time > now() - interval '30 days'), 0)::bigint AS revenue_30d,
            MIN(created_at) AS first_booking_at,
            MAX(created_at) AS last_booking_at
     FROM bookings WHERE master_id = $1`,
    [id]
  );
  const st = statRows[0];

  // Clients are told apart by phone number, counted, never listed. A
  // returning client is one with more than one booking that wasn't cancelled.
  const { rows: clientRows } = await pool.query(
    `SELECT COUNT(*)::int AS clients, COUNT(*) FILTER (WHERE n > 1)::int AS returning
     FROM (SELECT customer_phone, COUNT(*) AS n FROM bookings
           WHERE master_id = $1 AND status <> 'cancelled' GROUP BY customer_phone) c`,
    [id]
  );

  // The last six months in the master's own calendar, oldest first, with
  // empty months included so a chart doesn't skip them.
  const { rows: monthly } = await pool.query(
    `WITH months AS (
       SELECT to_char(d, 'YYYY-MM') AS month
       FROM generate_series(
         date_trunc('month', now() AT TIME ZONE $2) - interval '5 months',
         date_trunc('month', now() AT TIME ZONE $2),
         interval '1 month') d
     )
     SELECT months.month,
            COUNT(b.id) FILTER (WHERE b.status <> 'cancelled')::int AS bookings,
            COUNT(b.id) FILTER (WHERE b.status = 'completed')::int AS completed,
            COALESCE(SUM(b.price_at_booking) FILTER (WHERE b.status = 'completed'), 0)::bigint AS revenue
     FROM months
     LEFT JOIN bookings b
       ON b.master_id = $1 AND to_char(b.start_time AT TIME ZONE $2, 'YYYY-MM') = months.month
     GROUP BY months.month
     ORDER BY months.month`,
    [id, m.timezone]
  );

  const settled = st.completed + st.no_show;
  res.json({
    master: {
      id: m.id,
      slug: m.slug,
      email: m.email,
      name: m.owner_name_hy || m.owner_name_ru || m.owner_name_en || '',
      names: { en: m.owner_name_en, ru: m.owner_name_ru, hy: m.owner_name_hy },
      siteUrl: masterSiteUrl(m),
      customDomain: m.custom_domain,
      customDomainStatus: m.custom_domain_status,
      timezone: m.timezone,
      currency: m.currency,
      languages: m.languages,
      createdAt: m.created_at,
      telegramConnected: Boolean(m.telegram_chat_id),
      access: accessSummary(m),
    },
    profile: {
      hasPhoto: m.has_photo,
      hasAbout: m.has_about,
      phone: m.phone,
      whatsapp: m.whatsapp,
      telegram: m.telegram,
      instagram: m.instagram,
      email: m.contact_email,
      address: m.address_hy || m.address_ru || m.address_en || '',
    },
    categories: [...byCategory.values()],
    stats: {
      total: st.total,
      byStatus: { confirmed: st.confirmed, completed: st.completed, cancelled: st.cancelled, no_show: st.no_show },
      upcoming: st.upcoming,
      online: st.online,
      telegramGuests: st.telegram_guests,
      created30d: st.created_30d,
      revenue: Number(st.revenue),
      revenue30d: Number(st.revenue_30d),
      // Of the visits whose outcome is known, how many happened.
      completionRate: settled ? st.completed / settled : null,
      cancellationRate: st.total ? st.cancelled / st.total : null,
      clients: clientRows[0].clients,
      returningClients: clientRows[0].returning,
      firstBookingAt: st.first_booking_at,
      lastBookingAt: st.last_booking_at,
    },
    monthly: monthly.map((r) => ({ ...r, revenue: Number(r.revenue) })),
  });
}));

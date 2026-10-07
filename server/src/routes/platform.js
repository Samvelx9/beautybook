import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { pool } from '../db.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { requirePlatformAdmin } from '../middleware/auth.js';
import { accessSummary, masterSiteUrl, MASTER_COLUMNS } from '../services/masters.js';
import { changeOwnPassword } from '../services/accounts.js';

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
            (SELECT COUNT(*)::int FROM services s WHERE s.master_id = m.id AND s.is_active) AS active_services
     FROM masters m
     LEFT JOIN users u ON u.master_id = m.id
     LEFT JOIN salon_profile p ON p.master_id = m.id
     ORDER BY m.created_at DESC`
  );
  res.json(
    rows.map((m) => ({
      id: m.id,
      slug: m.slug,
      email: m.email,
      name: m.owner_name_ru || m.owner_name_en || m.owner_name_hy || '',
      siteUrl: masterSiteUrl(m),
      customDomain: m.custom_domain,
      createdAt: m.created_at,
      telegramConnected: Boolean(m.telegram_chat_id),
      bookingsTotal: m.bookings_total,
      bookings30d: m.bookings_30d,
      activeServices: m.active_services,
      access: accessSummary(m),
    }))
  );
}));

// The operator's own password — they have no master Settings screen.
platformRouter.post('/password', asyncHandler(async (req, res) => {
  const result = await changeOwnPassword(req.user.id, req.body?.currentPassword, req.body?.newPassword);
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json({ token: result.token });
}));

const idParam = (req) => {
  const id = Number(req.params.id);
  return Number.isInteger(id) ? id : null;
};

// { suspended: bool } | { extendTrialDays: n } | { customDomain: "x.com" | null }
platformRouter.patch('/masters/:id', asyncHandler(async (req, res) => {
  const id = idParam(req);
  if (id === null) return res.status(400).json({ error: 'invalid_master_id' });

  const fields = [];
  const values = [];
  const set = (sql, value) => {
    values.push(value);
    fields.push(sql.replace('?', `$${values.length}`));
  };

  if (req.body?.suspended !== undefined) {
    fields.push(req.body.suspended ? 'suspended_at = now()' : 'suspended_at = NULL');
  }
  if (req.body?.extendTrialDays !== undefined) {
    const days = Number(req.body.extendTrialDays);
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      return res.status(400).json({ error: 'invalid_days' });
    }
    // From whichever is later — now or the current end — so extending an
    // expired trial gives the full number of days.
    set('trial_ends_at = GREATEST(trial_ends_at, now()) + make_interval(days => ?)', days);
  }
  if (req.body?.customDomain !== undefined) {
    const domain = req.body.customDomain
      ? String(req.body.customDomain).trim().toLowerCase().replace(/^www\./, '')
      : null;
    if (domain && !/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(domain)) {
      return res.status(400).json({ error: 'invalid_domain' });
    }
    set('custom_domain = ?', domain);
  }
  if (fields.length === 0) return res.status(400).json({ error: 'no_fields_to_update' });

  values.push(id);
  try {
    const { rowCount } = await pool.query(
      `UPDATE masters SET ${fields.join(', ')} WHERE id = $${values.length}`,
      values
    );
    if (rowCount === 0) return res.status(404).json({ error: 'master_not_found' });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'domain_taken' });
    throw err;
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
     FROM masters m
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
     FROM service_categories WHERE master_id = $1 ORDER BY sort_order, id`,
    [id]
  );
  const { rows: services } = await pool.query(
    `SELECT s.id, s.category_id, s.name_en, s.name_ru, s.name_hy, s.duration_minutes, s.price,
            s.is_active,
            COUNT(DISTINCT b.id) FILTER (WHERE b.status <> 'cancelled')::int AS bookings,
            COUNT(DISTINCT b.id) FILTER (WHERE b.status = 'completed')::int AS completed,
            COALESCE(SUM(i.price_at_booking) FILTER (WHERE b.status = 'completed'), 0)::bigint AS revenue
     FROM services s
     LEFT JOIN booking_items i ON i.service_id = s.id
     LEFT JOIN bookings b ON b.id = i.booking_id
     WHERE s.master_id = $1
     GROUP BY s.id
     ORDER BY s.sort_order, s.id`,
    [id]
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
      name: m.owner_name_ru || m.owner_name_en || m.owner_name_hy || '',
      names: { en: m.owner_name_en, ru: m.owner_name_ru, hy: m.owner_name_hy },
      siteUrl: masterSiteUrl(m),
      customDomain: m.custom_domain,
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
      address: m.address_ru || m.address_en || m.address_hy || '',
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

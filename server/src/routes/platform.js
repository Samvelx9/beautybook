import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { pool } from '../db.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { requirePlatformAdmin } from '../middleware/auth.js';
import { accessSummary, masterSiteUrl, MASTER_COLUMNS } from '../services/masters.js';

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

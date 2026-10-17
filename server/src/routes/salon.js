import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { pool } from '../db.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { cleanString, isValidDate } from '../lib/validate.js';
import { todayDateStr, addDaysToDateStr, localToUtc, isValidTimeZone } from '../lib/time.js';
import { requireAccount, requireOwner } from '../middleware/auth.js';
import { bookingsQuery } from '../services/bookings.js';
import {
  accessSummary,
  createMaster,
  getMasterById,
  getOrganizationById,
  masterSiteUrl,
  newConnectToken,
  planFor,
  setOrganizationLocale,
  slugProblem,
} from '../services/masters.js';
import { getBotUsername, telegramToken } from '../services/telegram.js';
import { EMAIL_PATTERN, readCurrency, readLanguages } from './auth.js';
import { syncPlan } from '../services/billing.js';
import { calendarRouter } from './calendar.js';
import { profileRouter } from './profileRoutes.js';
import { salonProfile } from '../services/profile.js';

// A salon's owner running the salon: its masters, who does what, every
// master's bookings in one list, and the owner's own Telegram chat.
//
// Everything is scoped to `req.organization`, taken from the logged-in owner.
// `/masters/:masterId/...` reaches one master's calendar — the same routes a
// master uses on their own (routes/calendar.js) — once the master is checked
// to be one of this salon's.
export const salonRouter = Router();
salonRouter.use(requireAccount, requireOwner, (req, res, next) => {
  if (req.organization.kind !== 'salon') return res.status(403).json({ error: 'not_a_salon' });
  next();
});

const UNIQUE_VIOLATION = '23505';
const LANGS = ['hy', 'ru', 'en'];
const BOOKING_STATUSES = ['confirmed', 'completed', 'cancelled', 'no_show'];
const TAX_PAYERS = ['master', 'salon', 'both'];

// A share in whole percent, 0–100, or null.
function readShare(raw) {
  const share = Number(raw);
  return raw !== null && raw !== '' && Number.isInteger(share) && share >= 0 && share <= 100 ? share : null;
}

const masterIdParam = (req) => {
  const id = Number(req.params.masterId);
  return Number.isInteger(id) ? id : null;
};

// The salon, its standing and its masters. `plan` is the monthly plan the
// number of working masters puts it on.
async function salonBody(organizationId) {
  const organization = await getOrganizationById(organizationId);
  const { rows: masters } = await pool.query(
    `SELECT m.id, m.slug, m.custom_domain, m.deactivated_at, m.telegram_chat_id, m.created_at,
            m.share_percent, current_master_share(m.id) AS effective_share,
            m.tax_payer, current_tax_payer(m.id) AS effective_tax_payer,
            p.owner_name_en, p.owner_name_ru, p.owner_name_hy,
            u.email, u.role,
            COALESCE(
              (SELECT array_agg(ms.service_id ORDER BY ms.service_id)
                 FROM master_services ms WHERE ms.master_id = m.id),
              '{}') AS service_ids
     FROM masters m
     LEFT JOIN salon_profile p ON p.master_id = m.id
     LEFT JOIN users u ON u.master_id = m.id
     WHERE m.organization_id = $1
     ORDER BY m.deactivated_at NULLS FIRST, m.created_at, m.id`,
    [organizationId]
  );
  const activeMasters = masters.filter((m) => !m.deactivated_at).length;
  return {
    organization: {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      // The salon's own booking page, once it has an address.
      siteUrl: organization.slug ? masterSiteUrl(organization) : null,
      timezone: organization.timezone,
      currency: organization.currency,
      languages: organization.languages,
      defaultLang: organization.default_lang,
      notifyLang: organization.notify_lang,
      // The masters' share of each visit's income, in percent.
      masterSharePercent: organization.master_share_percent,
      telegramConnected: Boolean(organization.telegram_chat_id),
      createdAt: organization.created_at,
    },
    access: accessSummary(organization),
    activeMasters,
    plan: planFor(organization, activeMasters),
    masters: masters.map((m) => ({
      id: m.id,
      slug: m.slug,
      name: m.owner_name_ru || m.owner_name_en || m.owner_name_hy || '',
      siteUrl: masterSiteUrl(m),
      // The login that works this calendar: a master's own, or the owner's
      // when the owner is one of the masters.
      email: m.email,
      isOwner: m.role === 'owner',
      active: !m.deactivated_at,
      telegramConnected: Boolean(m.telegram_chat_id),
      serviceIds: m.service_ids,
      // Their own share when it differs from the salon's (null: the salon's),
      // and the share their visits are paid at now — 0 for the owner.
      sharePercent: m.share_percent,
      effectiveSharePercent: m.effective_share,
      // Who pays the taxes on their visits: 'master', 'salon' or 'both' (each
      // on their own part). The owner's own visits are always the salon's.
      taxPayer: m.effective_tax_payer,
      createdAt: m.created_at,
    })),
  };
}

salonRouter.get('/', asyncHandler(async (req, res) => {
  res.json(await salonBody(req.organization.id));
}));

// { name, slug, timezone, currency, languages, defaultLang, notifyLang,
//   masterSharePercent } — slug is the salon page's address — the locale is copied onto every master; notifyLang
// is the language of the owner's own Telegram chat; masterSharePercent is the
// masters' share of each visit's income from now on.
salonRouter.patch('/', asyncHandler(async (req, res) => {
  const locale = {};
  const fields = [];
  const values = [req.organization.id];
  const set = (column, value) => {
    values.push(value);
    fields.push(`${column} = $${values.length}`);
  };

  if (req.body?.name !== undefined) {
    const name = cleanString(req.body.name, 100);
    if (!name) return res.status(400).json({ error: 'missing_salon_name' });
    set('name', name);
  }
  if (req.body?.slug !== undefined) {
    const slug = cleanString(req.body.slug, 40).toLowerCase();
    const problem = slugProblem(slug);
    if (problem) return res.status(400).json({ error: problem });
    set('slug', slug);
  }
  if (req.body?.notifyLang !== undefined) {
    if (!LANGS.includes(req.body.notifyLang)) return res.status(400).json({ error: 'invalid_lang' });
    set('notify_lang', req.body.notifyLang);
  }
  if (req.body?.masterSharePercent !== undefined) {
    const share = readShare(req.body.masterSharePercent);
    if (share === null) return res.status(400).json({ error: 'invalid_share' });
    set('master_share_percent', share);
  }
  if (req.body?.timezone !== undefined) {
    if (!isValidTimeZone(req.body.timezone)) return res.status(400).json({ error: 'invalid_timezone' });
    locale.timezone = req.body.timezone;
  }
  if (req.body?.currency !== undefined) {
    const currency = readCurrency(req.body.currency);
    if (!currency) return res.status(400).json({ error: 'invalid_currency' });
    locale.currency = currency;
  }
  if (req.body?.languages !== undefined || req.body?.defaultLang !== undefined) {
    const langs = readLanguages(
      req.body?.languages ?? req.organization.languages,
      req.body?.defaultLang ?? req.organization.default_lang
    );
    if (langs.error) return res.status(400).json({ error: langs.error });
    locale.languages = langs.languages;
    locale.defaultLang = langs.defaultLang;
  }
  if (fields.length === 0 && Object.keys(locale).length === 0) {
    return res.status(400).json({ error: 'no_fields_to_update' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (fields.length) {
      await client.query(`UPDATE organizations SET ${fields.join(', ')} WHERE id = $1`, values);
    }
    await setOrganizationLocale(client, req.organization.id, locale);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === UNIQUE_VIOLATION) return res.status(409).json({ error: 'slug_taken' });
    throw err;
  } finally {
    client.release();
  }
  res.json(await salonBody(req.organization.id));
}));

// The salon page's landing content: /salon/profile, /salon/profile/photo.
salonRouter.use(profileRouter((req) => salonProfile(req.organization.id)));

// ---------------------------------------------------------------------------
// Masters
// ---------------------------------------------------------------------------

// A new master: their page at `slug`, a profile under `displayName`, and the
// whole price list as what they perform.
//
// - With `email`: a login of their own, with a one-time password that's
//   answered once for the owner to pass on (there's no email sending yet).
// - With `self: true`: the owner becomes one of the masters — the calendar is
//   theirs, under their existing login.
salonRouter.post('/masters', asyncHandler(async (req, res) => {
  const self = req.body?.self === true;
  const email = cleanString(req.body?.email, 200).toLowerCase();
  const slug = cleanString(req.body?.slug, 40).toLowerCase();
  const displayName = cleanString(req.body?.displayName, 100);

  if (self && req.user.master_id) return res.status(409).json({ error: 'already_a_master' });
  if (!self && !EMAIL_PATTERN.test(email)) return res.status(400).json({ error: 'invalid_email' });
  const problem = slugProblem(slug);
  if (problem) return res.status(400).json({ error: problem });
  if (!displayName) return res.status(400).json({ error: 'missing_display_name' });

  const o = req.organization;
  const password = self ? null : randomBytes(9).toString('base64url');
  const passwordHash = password && (await bcrypt.hash(password, 12));

  const client = await pool.connect();
  let masterId;
  try {
    await client.query('BEGIN');
    masterId = await createMaster(client, {
      organizationId: o.id,
      slug,
      displayName,
      timezone: o.timezone,
      currency: o.currency,
      languages: o.languages,
      defaultLang: o.default_lang,
    });
    if (self) {
      await client.query('UPDATE users SET master_id = $2 WHERE id = $1', [req.user.id, masterId]);
    } else {
      await client.query(
        `INSERT INTO users (organization_id, master_id, role, email, password_hash)
         VALUES ($1, $2, 'master', $3, $4)`,
        [o.id, masterId, email, passwordHash]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === UNIQUE_VIOLATION) {
      const field = String(err.constraint ?? '').includes('email') ? 'email_taken' : 'slug_taken';
      return res.status(409).json({ error: field });
    }
    throw err;
  } finally {
    client.release();
  }

  // One more master working may mean the next plan up.
  await syncPlan(o.id);
  const body = await salonBody(o.id);
  res.status(201).json({
    master: body.masters.find((m) => m.id === masterId),
    ...(password ? { email, password } : {}),
  });
}));

// The salon's master named in the URL, or a 404 — a master of another
// organization is treated as not existing.
async function salonMaster(req, res) {
  const id = masterIdParam(req);
  const master = id === null ? null : await getMasterById(id);
  if (!master || master.organization_id !== req.organization.id) {
    res.status(404).json({ error: 'master_not_found' });
    return null;
  }
  return master;
}

// { active: bool } — a deactivated master keeps their bookings and history,
// but can't sign in and their page takes no bookings; they stop counting
// toward the plan.
// { serviceIds: [...] } — the services they perform, replacing the list.
// { sharePercent: n | null } — their own share of their visits' income, or
// null to follow the salon's.
// { taxPayer: 'master' | 'salon' | 'both' } — who pays the taxes on their
// visits, from visits completed now on.
// Neither for the owner's own calendar: the owner's visits are all theirs.
salonRouter.patch('/masters/:masterId', asyncHandler(async (req, res) => {
  const master = await salonMaster(req, res);
  if (!master) return;

  const active = req.body?.active;
  const rawServiceIds = req.body?.serviceIds;
  const rawShare = req.body?.sharePercent;
  const taxPayer = req.body?.taxPayer;
  if (active === undefined && rawServiceIds === undefined && rawShare === undefined && taxPayer === undefined) {
    return res.status(400).json({ error: 'no_fields_to_update' });
  }
  if (taxPayer !== undefined) {
    if (master.id === req.user.master_id) return res.status(400).json({ error: 'owner_keeps_all' });
    if (!TAX_PAYERS.includes(taxPayer)) return res.status(400).json({ error: 'invalid_tax_payer' });
  }
  let share;
  if (rawShare !== undefined) {
    if (master.id === req.user.master_id) return res.status(400).json({ error: 'owner_keeps_all' });
    share = rawShare === null ? null : readShare(rawShare);
    if (rawShare !== null && share === null) return res.status(400).json({ error: 'invalid_share' });
  }
  let serviceIds = null;
  if (rawServiceIds !== undefined) {
    if (!Array.isArray(rawServiceIds) || rawServiceIds.length > 1000) {
      return res.status(400).json({ error: 'invalid_service_ids' });
    }
    serviceIds = [...new Set(rawServiceIds.map(Number))];
    if (serviceIds.some((id) => !Number.isInteger(id))) {
      return res.status(400).json({ error: 'invalid_service_ids' });
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (active !== undefined) {
      await client.query(
        `UPDATE masters SET deactivated_at = CASE WHEN $2 THEN NULL ELSE COALESCE(deactivated_at, now()) END
          WHERE id = $1`,
        [master.id, Boolean(active)]
      );
    }
    if (rawShare !== undefined) {
      await client.query('UPDATE masters SET share_percent = $2 WHERE id = $1', [master.id, share]);
    }
    if (taxPayer !== undefined) {
      await client.query('UPDATE masters SET tax_payer = $2 WHERE id = $1', [master.id, taxPayer]);
    }
    if (serviceIds) {
      await client.query('DELETE FROM master_services WHERE master_id = $1', [master.id]);
      const { rowCount } = await client.query(
        `INSERT INTO master_services (organization_id, master_id, service_id)
         SELECT $1, $2, id FROM services WHERE organization_id = $1 AND id = ANY($3::int[])`,
        [req.organization.id, master.id, serviceIds]
      );
      // An id that isn't one of the salon's services.
      if (rowCount !== serviceIds.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'invalid_service_ids' });
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // Masters starting or stopping work may move the salon to another plan.
  if (active !== undefined) await syncPlan(req.organization.id);
  const body = await salonBody(req.organization.id);
  res.json(body.masters.find((m) => m.id === master.id));
}));

// A one-time password for a master who's locked out, shown once to the owner
// to pass on. Ends the master's existing sessions. The owner's own password is
// changed in their Settings instead.
salonRouter.post('/masters/:masterId/reset-password', asyncHandler(async (req, res) => {
  const master = await salonMaster(req, res);
  if (!master) return;
  const password = randomBytes(9).toString('base64url');
  const { rowCount } = await pool.query(
    `UPDATE users SET password_hash = $2, token_version = token_version + 1
      WHERE master_id = $1 AND role = 'master'`,
    [master.id, await bcrypt.hash(password, 12)]
  );
  if (rowCount === 0) return res.status(404).json({ error: 'no_master_login' });
  res.json({ password });
}));

// One master's calendar — profile, hours, days off, bookings — through the
// same routes the master uses on their own.
salonRouter.use('/masters/:masterId', asyncHandler(async (req, res, next) => {
  const master = await salonMaster(req, res);
  if (!master) return;
  req.master = master;
  next();
}), calendarRouter);

// ---------------------------------------------------------------------------
// Every master's bookings in one list
// ---------------------------------------------------------------------------

// ?from&to (the salon's local dates), ?masterId, ?status. Each booking carries
// its `master_id`.
salonRouter.get('/bookings', asyncHandler(async (req, res) => {
  const tz = req.organization.timezone;
  const today = todayDateStr(tz);
  const from = isValidDate(req.query.from) ? req.query.from : addDaysToDateStr(today, -30);
  const to = isValidDate(req.query.to) ? req.query.to : addDaysToDateStr(today, 60);

  const params = [
    req.organization.id,
    localToUtc(from, '00:00', tz),
    localToUtc(addDaysToDateStr(to, 1), '00:00', tz),
  ];
  let where = 'b.start_time >= $2 AND b.start_time < $3';
  if (req.query.masterId !== undefined) {
    const masterId = Number(req.query.masterId);
    if (!Number.isInteger(masterId)) return res.status(400).json({ error: 'invalid_master_id' });
    params.push(masterId);
    where += ` AND b.master_id = $${params.length}`;
  }
  if (req.query.status !== undefined) {
    if (!BOOKING_STATUSES.includes(req.query.status)) {
      return res.status(400).json({ error: 'invalid_status' });
    }
    params.push(req.query.status);
    where += ` AND b.status = $${params.length}`;
  }

  const { rows } = await pool.query(
    bookingsQuery({ scope: 'organization', where, extraFields: 'b.master_id' }),
    params
  );
  res.json(rows);
}));

// ---------------------------------------------------------------------------
// The owner's Telegram chat: every booking in the salon
// ---------------------------------------------------------------------------

// A one-time link to the platform bot; pressing Start on it sends
// "/start o_<token>", which routes/telegram.js turns into the salon's chat.
salonRouter.post('/telegram/connect', asyncHandler(async (req, res) => {
  if (!telegramToken()) return res.status(503).json({ error: 'telegram_not_configured' });
  const username = await getBotUsername();
  if (!username) return res.status(503).json({ error: 'telegram_unavailable' });
  const token = newConnectToken('o');
  await pool.query('UPDATE organizations SET telegram_connect_token = $2 WHERE id = $1', [
    req.organization.id,
    token,
  ]);
  res.json({ url: `https://t.me/${username}?start=${token}` });
}));

salonRouter.delete('/telegram', asyncHandler(async (req, res) => {
  await pool.query(
    'UPDATE organizations SET telegram_chat_id = NULL, telegram_connect_token = NULL WHERE id = $1',
    [req.organization.id]
  );
  res.json(await salonBody(req.organization.id));
}));

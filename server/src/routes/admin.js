import { Router, raw } from 'express';
import bcrypt from 'bcryptjs';
import { pool } from '../db.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { requireMasterAuth } from '../middleware/auth.js';
import { cleanString, isValidDate, isValidTime } from '../lib/validate.js';
import {
  todayDateStr,
  addDaysToDateStr,
  localToUtc,
  splitLocalDateTime,
  isValidTimeZone,
} from '../lib/time.js';
import {
  bookingsQuery,
  getBookingWithItems,
  resolveItems,
  insertBookingWithItems,
  replaceItems,
} from '../services/bookings.js';
import {
  PROFILE_TEXT_COLUMNS,
  getProfileRow,
  shapeProfile,
  maxLengthFor,
  toCamel,
} from '../services/profile.js';
import { notifyGuest } from '../services/guestNotifications.js';
import { MIN_NOTICE_CHOICES } from '../services/availability.js';
import {
  accessSummary,
  deleteMaster,
  getMasterById,
  masterSiteUrl,
  newConnectToken,
} from '../services/masters.js';
import { getBotUsername, telegramToken } from '../services/telegram.js';
import { billingConfig, createCheckout } from '../services/billing.js';
import { applyTemplate, TEMPLATES } from '../services/templates.js';
import { readCurrency, readLanguages } from './auth.js';
import { changeOwnPassword } from '../services/accounts.js';

// A master's own admin panel. `requireMasterAuth` sets `req.master` from the
// logged-in user, and every query below is scoped to `req.master.id` — an id
// in a URL or body only ever names a row *within* that master's data.
export const adminRouter = Router();
adminRouter.use(requireMasterAuth);

const FOREIGN_KEY_VIOLATION = '23503';
// A delete blocked by a RESTRICT foreign key: Postgres 16 reports it as a
// foreign-key violation, Postgres 17+ as its own restrict_violation.
const RESTRICT_VIOLATION = '23001';
const isBlockedDelete = (err) => err.code === FOREIGN_KEY_VIOLATION || err.code === RESTRICT_VIOLATION;
const CHECK_VIOLATION = '23514';
const UNIQUE_VIOLATION = '23505';
const EXCLUSION_VIOLATION = '23P01';
const BOOKING_STATUSES = ['confirmed', 'completed', 'cancelled', 'no_show'];
const PHOTO_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const LANGS = ['hy', 'ru', 'en'];

function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

// A slug for a treatment or zone, from whichever name has Latin letters, or a
// random one — a name written only in Armenian or Cyrillic slugifies to "".
function slugFor(sent, names) {
  const fromSent = slugify(cleanString(sent, 100));
  if (fromSent) return fromSent;
  for (const name of names) {
    const s = slugify(name || '');
    if (s) return s;
  }
  return `item-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

const idParam = (req) => {
  const id = Number(req.params.id);
  return Number.isInteger(id) ? id : null;
};

// ---------------------------------------------------------------------------
// Account: the master's settings, standing and integrations
// ---------------------------------------------------------------------------

async function accountBody(req) {
  const master = await getMasterById(req.master.id);
  return {
    email: req.user.email,
    isPlatformAdmin: req.user.is_platform_admin,
    master: {
      id: master.id,
      slug: master.slug,
      siteUrl: masterSiteUrl(master),
      customDomain: master.custom_domain,
      timezone: master.timezone,
      currency: master.currency,
      languages: master.languages,
      defaultLang: master.default_lang,
      notifyLang: master.notify_lang,
      minNoticeMinutes: master.min_notice_minutes,
      telegramConnected: Boolean(master.telegram_chat_id),
      createdAt: master.created_at,
    },
    access: accessSummary(master),
    telegramAvailable: Boolean(telegramToken()),
    billingAvailable: Boolean(billingConfig()),
  };
}

adminRouter.get('/account', asyncHandler(async (req, res) => {
  res.json(await accountBody(req));
}));

// Timezone, currency and languages. Changing the languages doesn't touch any
// content: names in a language that's switched off simply stop being shown.
adminRouter.patch('/account/settings', asyncHandler(async (req, res) => {
  const fields = [];
  const values = [];
  const set = (column, value) => {
    values.push(value);
    fields.push(`${column} = $${values.length}`);
  };

  if (req.body?.timezone !== undefined) {
    if (!isValidTimeZone(req.body.timezone)) return res.status(400).json({ error: 'invalid_timezone' });
    set('timezone', req.body.timezone);
  }
  if (req.body?.currency !== undefined) {
    const currency = readCurrency(req.body.currency);
    if (!currency) return res.status(400).json({ error: 'invalid_currency' });
    set('currency', currency);
  }
  if (req.body?.languages !== undefined || req.body?.defaultLang !== undefined) {
    const langs = readLanguages(
      req.body?.languages ?? req.master.languages,
      req.body?.defaultLang ?? req.master.default_lang
    );
    if (langs.error) return res.status(400).json({ error: langs.error });
    set('languages', langs.languages);
    set('default_lang', langs.defaultLang);
  }
  if (req.body?.notifyLang !== undefined) {
    if (!LANGS.includes(req.body.notifyLang)) return res.status(400).json({ error: 'invalid_lang' });
    set('notify_lang', req.body.notifyLang);
  }
  if (req.body?.minNoticeMinutes !== undefined) {
    const minutes = Number(req.body.minNoticeMinutes);
    if (!MIN_NOTICE_CHOICES.includes(minutes)) return res.status(400).json({ error: 'invalid_min_notice' });
    set('min_notice_minutes', minutes);
  }
  if (fields.length === 0) return res.status(400).json({ error: 'no_fields_to_update' });

  values.push(req.master.id);
  await pool.query(`UPDATE masters SET ${fields.join(', ')} WHERE id = $${values.length}`, values);
  res.json(await accountBody(req));
}));

adminRouter.post('/account/password', asyncHandler(async (req, res) => {
  const result = await changeOwnPassword(req.user.id, req.body?.currentPassword, req.body?.newPassword);
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json({ token: result.token });
}));

// Deleting the account removes the master and everything they own (the
// foreign keys cascade). Asks for the password again — it can't be undone.
adminRouter.delete('/account', asyncHandler(async (req, res) => {
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const { rows } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  if (!rows[0] || !(await bcrypt.compare(password, rows[0].password_hash))) {
    return res.status(403).json({ error: 'wrong_password' });
  }
  await deleteMaster(req.master.id);
  res.status(204).end();
}));

// "Connect Telegram": a one-time link to the platform bot. Pressing Start on
// it sends "/start m_<token>", which routes/telegram.js turns into this
// master's notification chat.
adminRouter.post('/telegram/connect', asyncHandler(async (req, res) => {
  if (!telegramToken()) return res.status(503).json({ error: 'telegram_not_configured' });
  const username = await getBotUsername();
  if (!username) return res.status(503).json({ error: 'telegram_unavailable' });
  const token = newConnectToken();
  await pool.query('UPDATE masters SET telegram_connect_token = $2 WHERE id = $1', [
    req.master.id,
    token,
  ]);
  res.json({ url: `https://t.me/${username}?start=${token}` });
}));

adminRouter.delete('/telegram', asyncHandler(async (req, res) => {
  await pool.query(
    'UPDATE masters SET telegram_chat_id = NULL, telegram_connect_token = NULL WHERE id = $1',
    [req.master.id]
  );
  res.json(await accountBody(req));
}));

// A Lemon Squeezy checkout for this master's subscription.
adminRouter.post('/billing/checkout', asyncHandler(async (req, res) => {
  const appUrl = (process.env.PUBLIC_URL ?? '').replace(/\/$/, '');
  const result = await createCheckout({
    master: req.master,
    email: req.user.email,
    redirectUrl: `${appUrl}/#settings?billing=done`,
  });
  if (result.error) {
    return res.status(result.error === 'billing_not_configured' ? 503 : 502).json(result);
  }
  res.json(result);
}));

// Adds a starter template's treatments (hidden, unpriced zones) to the list.
adminRouter.post('/templates/:key', asyncHandler(async (req, res) => {
  if (!TEMPLATES[req.params.key]) return res.status(404).json({ error: 'template_not_found' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const added = await applyTemplate(client, req.master, req.params.key);
    await client.query('COMMIT');
    res.json({ added });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

// ---------------------------------------------------------------------------
// Profile (the guest landing page's content)
// ---------------------------------------------------------------------------

adminRouter.get('/profile', asyncHandler(async (req, res) => {
  const row = await getProfileRow(req.master.id);
  if (!row) return res.status(404).json({ error: 'profile_not_found' });
  res.json(shapeProfile(row));
}));

// Every field is optional and may legitimately be blank — this is free-form
// copy, not validated business data — so a field simply omitted from the body
// keeps its current value, and one sent empty is cleared.
adminRouter.put('/profile', asyncHandler(async (req, res) => {
  const assignments = [];
  const values = [];

  for (const column of PROFILE_TEXT_COLUMNS) {
    const sent = req.body?.[toCamel(column)];
    if (sent === undefined) continue;
    values.push(cleanString(sent, maxLengthFor(column)));
    assignments.push(`${column} = $${values.length}`);
  }

  if (assignments.length === 0) {
    return res.status(400).json({ error: 'no_fields_to_update' });
  }

  assignments.push('updated_at = now()');
  values.push(req.master.id);
  await pool.query(
    `UPDATE salon_profile SET ${assignments.join(', ')} WHERE master_id = $${values.length}`,
    values
  );

  res.json(shapeProfile(await getProfileRow(req.master.id)));
}));

// The image arrives as a raw body with its own Content-Type rather than as
// multipart — one file, no other fields.
adminRouter.put(
  '/profile/photo',
  raw({ type: PHOTO_MIME_TYPES, limit: '4mb' }),
  asyncHandler(async (req, res) => {
    const mime = req.get('content-type');
    if (!Buffer.isBuffer(req.body) || req.body.length === 0 || !PHOTO_MIME_TYPES.includes(mime)) {
      return res.status(400).json({ error: 'invalid_image', accepts: PHOTO_MIME_TYPES });
    }

    await pool.query(
      `UPDATE salon_profile
       SET photo_mime = $1, photo_data = $2, photo_updated_at = now(), updated_at = now()
       WHERE master_id = $3`,
      [mime, req.body, req.master.id]
    );

    res.json(shapeProfile(await getProfileRow(req.master.id)));
  })
);

adminRouter.delete('/profile/photo', asyncHandler(async (req, res) => {
  await pool.query(
    `UPDATE salon_profile
     SET photo_mime = NULL, photo_data = NULL, photo_updated_at = NULL, updated_at = now()
     WHERE master_id = $1`,
    [req.master.id]
  );
  res.json(shapeProfile(await getProfileRow(req.master.id)));
}));

// ---------------------------------------------------------------------------
// Treatments (service categories)
// ---------------------------------------------------------------------------

const CATEGORY_COLUMNS = `id, slug, name_en, name_ru, name_hy,
       description_en, description_ru, description_hy, sort_order, is_active, is_hourly`;

const SERVICE_COLUMNS = `id, category_id, slug, name_en, name_ru, name_hy,
       duration_minutes, price, sort_order, is_active`;

const SERVICE_COLUMNS_WITH_MODE = `s.id, s.category_id, s.slug, s.name_en, s.name_ru, s.name_hy,
       s.duration_minutes, s.price, s.sort_order, s.is_active, c.is_hourly`;

// Names in the three languages. On create at least one must be filled; the
// others may stay blank (a master needn't translate into languages they don't
// offer).
function readNames(body) {
  return {
    name_en: cleanString(body?.nameEn, 200),
    name_ru: cleanString(body?.nameRu, 200),
    name_hy: cleanString(body?.nameHy, 200),
  };
}
const hasSomeName = (n) => Boolean(n.name_en || n.name_ru || n.name_hy);

adminRouter.get('/categories', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT ${CATEGORY_COLUMNS} FROM service_categories WHERE master_id = $1 ORDER BY sort_order, id`,
    [req.master.id]
  );
  res.json(rows);
}));

adminRouter.post('/categories', asyncHandler(async (req, res) => {
  const names = readNames(req.body);
  if (!hasSomeName(names)) return res.status(400).json({ error: 'missing_fields' });
  const slug = slugFor(req.body?.slug, [names.name_en, names.name_ru, names.name_hy]);

  const sortOrder = Number(req.body?.sortOrder);
  try {
    const { rows } = await pool.query(
      `INSERT INTO service_categories
         (master_id, slug, name_en, name_ru, name_hy, description_en, description_ru, description_hy,
          sort_order, is_hourly)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING ${CATEGORY_COLUMNS}`,
      [
        req.master.id,
        slug,
        names.name_en,
        names.name_ru,
        names.name_hy,
        cleanString(req.body?.descriptionEn, 500),
        cleanString(req.body?.descriptionRu, 500),
        cleanString(req.body?.descriptionHy, 500),
        Number.isInteger(sortOrder) ? sortOrder : 0,
        Boolean(req.body?.isHourly),
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === UNIQUE_VIOLATION) return res.status(409).json({ error: 'slug_taken' });
    throw err;
  }
}));

adminRouter.patch('/categories/:id', asyncHandler(async (req, res) => {
  const id = idParam(req);
  if (id === null) return res.status(400).json({ error: 'invalid_category_id' });

  const fields = [];
  const values = [];
  const set = (column, value) => {
    values.push(value);
    fields.push(`${column} = $${values.length}`);
  };

  const nameKeys = { nameEn: 'name_en', nameRu: 'name_ru', nameHy: 'name_hy' };
  for (const [bodyKey, column] of Object.entries(nameKeys)) {
    if (req.body?.[bodyKey] === undefined) continue;
    set(column, cleanString(req.body[bodyKey], 200));
  }

  const descriptionKeys = {
    descriptionEn: 'description_en',
    descriptionRu: 'description_ru',
    descriptionHy: 'description_hy',
  };
  for (const [bodyKey, column] of Object.entries(descriptionKeys)) {
    if (req.body?.[bodyKey] === undefined) continue;
    set(column, cleanString(req.body[bodyKey], 500));
  }

  if (req.body?.sortOrder !== undefined) {
    const sortOrder = Number(req.body.sortOrder);
    if (!Number.isInteger(sortOrder)) return res.status(400).json({ error: 'invalid_sort_order' });
    set('sort_order', sortOrder);
  }
  if (req.body?.isActive !== undefined) set('is_active', Boolean(req.body.isActive));
  if (req.body?.isHourly !== undefined) set('is_hourly', Boolean(req.body.isHourly));

  if (fields.length === 0) return res.status(400).json({ error: 'no_fields_to_update' });

  values.push(id, req.master.id);
  try {
    const { rows } = await pool.query(
      `UPDATE service_categories SET ${fields.join(', ')}
       WHERE id = $${values.length - 1} AND master_id = $${values.length}
       RETURNING ${CATEGORY_COLUMNS}`,
      values
    );
    if (!rows[0]) return res.status(404).json({ error: 'category_not_found' });
    res.json(rows[0]);
  } catch (err) {
    // Every name blanked at once.
    if (err.code === CHECK_VIOLATION) return res.status(400).json({ error: 'missing_fields' });
    throw err;
  }
}));

adminRouter.delete('/categories/:id', asyncHandler(async (req, res) => {
  const id = idParam(req);
  if (id === null) return res.status(400).json({ error: 'invalid_category_id' });

  try {
    const { rowCount } = await pool.query(
      'DELETE FROM service_categories WHERE id = $1 AND master_id = $2',
      [id, req.master.id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'category_not_found' });
    res.status(204).end();
  } catch (err) {
    if (isBlockedDelete(err)) {
      return res.status(409).json({
        error: 'category_has_services',
        hint: "Move or delete this category's services first, or deactivate it instead.",
      });
    }
    throw err;
  }
}));

// ---------------------------------------------------------------------------
// Zones (services)
// ---------------------------------------------------------------------------

adminRouter.get('/services', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT ${SERVICE_COLUMNS_WITH_MODE}
     FROM services s
     JOIN service_categories c ON c.id = s.category_id
     WHERE s.master_id = $1
     ORDER BY s.sort_order, s.id`,
    [req.master.id]
  );
  res.json(rows);
}));

adminRouter.post('/services', asyncHandler(async (req, res) => {
  const names = readNames(req.body);
  const duration_minutes = Number(req.body?.durationMinutes);
  const price = Number(req.body?.price);
  const category_id = Number(req.body?.categoryId);
  const sortOrder = Number(req.body?.sortOrder);

  if (!hasSomeName(names)) return res.status(400).json({ error: 'missing_fields' });
  if (!Number.isInteger(category_id)) return res.status(400).json({ error: 'invalid_category' });
  if (!Number.isInteger(duration_minutes) || duration_minutes <= 0) {
    return res.status(400).json({ error: 'invalid_duration' });
  }
  if (!Number.isInteger(price) || price < 0) return res.status(400).json({ error: 'invalid_price' });

  const slug = slugFor(req.body?.slug, [names.name_en, names.name_ru, names.name_hy]);

  try {
    const { rows } = await pool.query(
      `INSERT INTO services
         (master_id, slug, category_id, name_en, name_ru, name_hy, duration_minutes, price,
          sort_order, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING ${SERVICE_COLUMNS}`,
      [
        req.master.id,
        slug,
        category_id,
        names.name_en,
        names.name_ru,
        names.name_hy,
        duration_minutes,
        price,
        Number.isInteger(sortOrder) ? sortOrder : 0,
        req.body?.isActive === undefined ? true : Boolean(req.body.isActive),
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === UNIQUE_VIOLATION) return res.status(409).json({ error: 'slug_taken' });
    // The category is someone else's or doesn't exist: the composite foreign
    // key refuses it either way.
    if (err.code === FOREIGN_KEY_VIOLATION) return res.status(400).json({ error: 'invalid_category' });
    throw err;
  }
}));

adminRouter.patch('/services/:id', asyncHandler(async (req, res) => {
  const id = idParam(req);
  if (id === null) return res.status(400).json({ error: 'invalid_service_id' });

  const fields = [];
  const values = [];
  const set = (column, value) => {
    values.push(value);
    fields.push(`${column} = $${values.length}`);
  };

  for (const [bodyKey, column] of Object.entries({ nameEn: 'name_en', nameRu: 'name_ru', nameHy: 'name_hy' })) {
    if (req.body?.[bodyKey] === undefined) continue;
    set(column, cleanString(req.body[bodyKey], 200));
  }

  const integers = {
    categoryId: ['category_id', (v) => Number.isInteger(v), 'invalid_category'],
    durationMinutes: ['duration_minutes', (v) => Number.isInteger(v) && v > 0, 'invalid_duration'],
    price: ['price', (v) => Number.isInteger(v) && v >= 0, 'invalid_price'],
    sortOrder: ['sort_order', (v) => Number.isInteger(v), 'invalid_sort_order'],
  };
  for (const [bodyKey, [column, isValid, error]] of Object.entries(integers)) {
    if (req.body?.[bodyKey] === undefined) continue;
    const value = Number(req.body[bodyKey]);
    if (!isValid(value)) return res.status(400).json({ error });
    set(column, value);
  }
  if (req.body?.isActive !== undefined) set('is_active', Boolean(req.body.isActive));

  if (fields.length === 0) return res.status(400).json({ error: 'no_fields_to_update' });

  values.push(id, req.master.id);
  let rows;
  try {
    ({ rows } = await pool.query(
      `UPDATE services SET ${fields.join(', ')}
       WHERE id = $${values.length - 1} AND master_id = $${values.length}
       RETURNING ${SERVICE_COLUMNS}`,
      values
    ));
  } catch (err) {
    if (err.code === FOREIGN_KEY_VIOLATION) return res.status(400).json({ error: 'invalid_category' });
    if (err.code === CHECK_VIOLATION) return res.status(400).json({ error: 'missing_fields' });
    throw err;
  }

  if (!rows[0]) return res.status(404).json({ error: 'service_not_found' });
  res.json(rows[0]);
}));

adminRouter.delete('/services/:id', asyncHandler(async (req, res) => {
  const id = idParam(req);
  if (id === null) return res.status(400).json({ error: 'invalid_service_id' });

  try {
    const { rowCount } = await pool.query('DELETE FROM services WHERE id = $1 AND master_id = $2', [
      id,
      req.master.id,
    ]);
    if (rowCount === 0) return res.status(404).json({ error: 'service_not_found' });
    res.status(204).end();
  } catch (err) {
    if (isBlockedDelete(err)) {
      return res.status(409).json({
        error: 'service_has_bookings',
        hint: 'Deactivate the service instead (PATCH isActive:false) to preserve booking history.',
      });
    }
    throw err;
  }
}));

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

const WEEKLY_COLUMNS = 'day_of_week, is_open, start_time, end_time, lunch_start, lunch_end';

// Shared by the single-day and whole-week endpoints: a day is either closed
// (times cleared) or open with a start before its end, optionally with a lunch
// break that has to sit inside those hours. Returns { error } or { values }.
function readWeeklyDay(body, dayOfWeek) {
  const isOpen = Boolean(body?.isOpen);
  if (!isOpen) return { values: [dayOfWeek, false, null, null, null, null] };

  const startTime = body?.startTime;
  const endTime = body?.endTime;
  if (!isValidTime(startTime) || !isValidTime(endTime) || startTime >= endTime) {
    return { error: 'invalid_hours' };
  }

  const hasLunch = Boolean(body?.hasLunch ?? (body?.lunchStart && body?.lunchEnd));
  if (!hasLunch) return { values: [dayOfWeek, true, startTime, endTime, null, null] };

  const lunchStart = body?.lunchStart;
  const lunchEnd = body?.lunchEnd;
  if (!isValidTime(lunchStart) || !isValidTime(lunchEnd) || lunchStart >= lunchEnd) {
    return { error: 'invalid_lunch' };
  }
  if (lunchStart < startTime || lunchEnd > endTime) {
    return { error: 'lunch_outside_hours' };
  }
  return { values: [dayOfWeek, true, startTime, endTime, lunchStart, lunchEnd] };
}

async function weeklyHours(masterId) {
  const { rows } = await pool.query(
    `SELECT ${WEEKLY_COLUMNS} FROM weekly_hours WHERE master_id = $1 ORDER BY day_of_week`,
    [masterId]
  );
  return rows;
}

// Each day is upserted, so a master whose week was somehow never seeded still
// ends up with one.
const UPSERT_DAY = `INSERT INTO weekly_hours
    (master_id, day_of_week, is_open, start_time, end_time, lunch_start, lunch_end)
  VALUES ($1, $2, $3, $4, $5, $6, $7)
  ON CONFLICT (master_id, day_of_week) DO UPDATE SET
    is_open = EXCLUDED.is_open, start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time,
    lunch_start = EXCLUDED.lunch_start, lunch_end = EXCLUDED.lunch_end
  RETURNING ${WEEKLY_COLUMNS}`;

adminRouter.get('/availability/weekly', asyncHandler(async (req, res) => {
  res.json(await weeklyHours(req.master.id));
}));

// The admin screen edits the whole week at once behind a single Save, so the
// seven rows go up together and land in one transaction.
adminRouter.put('/availability/weekly', asyncHandler(async (req, res) => {
  const days = req.body?.days;
  if (!Array.isArray(days) || days.length === 0) {
    return res.status(400).json({ error: 'missing_days' });
  }

  const updates = [];
  const seen = new Set();
  for (const day of days) {
    const dayOfWeek = Number(day?.dayOfWeek);
    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6 || seen.has(dayOfWeek)) {
      return res.status(400).json({ error: 'invalid_day_of_week' });
    }
    seen.add(dayOfWeek);

    const parsed = readWeeklyDay(day, dayOfWeek);
    if (parsed.error) return res.status(400).json({ error: parsed.error, dayOfWeek });
    updates.push(parsed.values);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const values of updates) {
      await client.query(UPSERT_DAY, [req.master.id, ...values]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  res.json(await weeklyHours(req.master.id));
}));

adminRouter.put('/availability/weekly/:dayOfWeek', asyncHandler(async (req, res) => {
  const dayOfWeek = Number(req.params.dayOfWeek);
  if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
    return res.status(400).json({ error: 'invalid_day_of_week' });
  }
  const parsed = readWeeklyDay(req.body, dayOfWeek);
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  const { rows } = await pool.query(UPSERT_DAY, [req.master.id, ...parsed.values]);
  res.json(rows[0]);
}));

adminRouter.get('/availability/blocks', asyncHandler(async (req, res) => {
  const from = isValidDate(req.query.from) ? req.query.from : todayDateStr(req.master.timezone);
  const to = isValidDate(req.query.to) ? req.query.to : addDaysToDateStr(from, 365);

  const { rows } = await pool.query(
    `SELECT id, date, start_time, end_time, note FROM availability_blocks
     WHERE master_id = $1 AND date BETWEEN $2 AND $3 ORDER BY date, start_time NULLS FIRST`,
    [req.master.id, from, to]
  );
  res.json(rows);
}));

adminRouter.post('/availability/blocks', asyncHandler(async (req, res) => {
  const date = req.body?.date;
  const startTime = req.body?.startTime ?? null;
  const endTime = req.body?.endTime ?? null;
  const note = cleanString(req.body?.note, 300) || null;

  if (!isValidDate(date)) return res.status(400).json({ error: 'invalid_date' });
  if ((startTime === null) !== (endTime === null)) {
    return res.status(400).json({ error: 'provide_both_times_or_neither' });
  }
  if (startTime !== null && (!isValidTime(startTime) || !isValidTime(endTime) || startTime >= endTime)) {
    return res.status(400).json({ error: 'invalid_times' });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO availability_blocks (master_id, date, start_time, end_time, note)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, date, start_time, end_time, note`,
      [req.master.id, date, startTime, endTime, note]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === CHECK_VIOLATION) return res.status(400).json({ error: 'invalid_times' });
    throw err;
  }
}));

adminRouter.delete('/availability/blocks/:id', asyncHandler(async (req, res) => {
  const id = idParam(req);
  if (id === null) return res.status(400).json({ error: 'invalid_block_id' });

  const { rowCount } = await pool.query(
    'DELETE FROM availability_blocks WHERE id = $1 AND master_id = $2',
    [id, req.master.id]
  );
  if (rowCount === 0) return res.status(404).json({ error: 'block_not_found' });
  res.status(204).end();
}));

// ---------------------------------------------------------------------------
// Bookings
// ---------------------------------------------------------------------------

adminRouter.get('/bookings', asyncHandler(async (req, res) => {
  const tz = req.master.timezone;
  const today = todayDateStr(tz);
  const from = isValidDate(req.query.from) ? req.query.from : addDaysToDateStr(today, -30);
  const to = isValidDate(req.query.to) ? req.query.to : addDaysToDateStr(today, 60);
  const status = req.query.status;

  if (status && !BOOKING_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'invalid_status' });
  }

  const params = [req.master.id, localToUtc(from, '00:00', tz), localToUtc(addDaysToDateStr(to, 1), '00:00', tz)];
  let where = 'b.start_time >= $2 AND b.start_time < $3';
  if (status) {
    params.push(status);
    where += ' AND b.status = $4';
  }

  const { rows } = await pool.query(bookingsQuery({ where }), params);
  res.json(rows);
}));

// A booking the master takes themselves — over the phone, or a walk-in written
// down after the fact. Deliberately looser than the guest flow: no cutoff and
// no opening-hours check, because a master is allowed to squeeze someone in
// early, late, or on a day off. The one rule that still holds is the overlap
// constraint, enforced by the database. Allowed even after the trial ends:
// the master's records are theirs.
adminRouter.post('/bookings', asyncHandler(async (req, res) => {
  const master = req.master;
  const date = req.body?.date;
  const time = req.body?.time;
  const customerName = cleanString(req.body?.customerName, 100);
  const customerPhone = cleanString(req.body?.customerPhone, 30);
  const status = req.body?.status ?? 'confirmed';

  if (!isValidDate(date) || !isValidTime(time)) {
    return res.status(400).json({ error: 'invalid_request' });
  }
  if (!customerName || !customerPhone) {
    return res.status(400).json({ error: 'missing_customer_details' });
  }
  if (!BOOKING_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'invalid_status' });
  }

  // A master may book a zone they've since hidden — the price list moving on
  // shouldn't stop them recording what they actually did.
  const rawItems = req.body?.items ?? [{ serviceId: req.body?.serviceId, durationMinutes: req.body?.durationMinutes }];
  const resolved = await resolveItems(master.id, rawItems, { requireActive: false });
  if (resolved.error) {
    const httpStatus = resolved.error === 'service_not_found' ? 404 : 400;
    return res.status(httpStatus).json({ error: resolved.error });
  }

  const startTime = localToUtc(date, time, master.timezone);
  const endTime = new Date(startTime.getTime() + resolved.totalMinutes * 60_000);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const bookingId = await insertBookingWithItems(client, master.id, {
      startTime,
      endTime,
      customerName,
      customerPhone,
      status,
      totalPrice: resolved.totalPrice,
      items: resolved.items,
    });
    await client.query('COMMIT');
    res.status(201).json(await getBookingWithItems(master.id, bookingId));
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === EXCLUSION_VIOLATION) return res.status(409).json({ error: 'slot_taken' });
    throw err;
  } finally {
    client.release();
  }
}));

// Editing a booking that already exists. Same latitude as creating one by
// hand: no opening-hours or cutoff check, but the database still refuses an
// overlap. Every field is optional; whatever is left out keeps its value.
adminRouter.patch('/bookings/:id', asyncHandler(async (req, res) => {
  const master = req.master;
  const id = idParam(req);
  if (id === null) return res.status(400).json({ error: 'invalid_booking_id' });

  const existing = await getBookingWithItems(master.id, id);
  if (!existing) return res.status(404).json({ error: 'booking_not_found' });

  const fields = [];
  const values = [];
  const set = (column, value) => {
    values.push(value);
    fields.push(`${column} = $${values.length}`);
  };

  if (req.body?.customerName !== undefined) {
    const name = cleanString(req.body.customerName, 100);
    if (!name) return res.status(400).json({ error: 'missing_customer_details' });
    set('customer_name', name);
  }
  if (req.body?.customerPhone !== undefined) {
    const phone = cleanString(req.body.customerPhone, 30);
    if (!phone) return res.status(400).json({ error: 'missing_customer_details' });
    set('customer_phone', phone);
  }
  if (req.body?.status !== undefined) {
    if (!BOOKING_STATUSES.includes(req.body.status)) {
      return res.status(400).json({ error: 'invalid_status' });
    }
    set('status', req.body.status);
  }

  // Zones and time interact: changing the zones changes how long the visit
  // runs, so the end time is always recomputed from whichever of the two the
  // request touched.
  let resolved = null;
  if (req.body?.items !== undefined) {
    resolved = await resolveItems(master.id, req.body.items, { requireActive: false });
    if (resolved.error) {
      const httpStatus = resolved.error === 'service_not_found' ? 404 : 400;
      return res.status(httpStatus).json({ error: resolved.error });
    }
    set('price_at_booking', resolved.totalPrice);
  }

  const movingTime = req.body?.date !== undefined || req.body?.time !== undefined;
  if (movingTime || resolved) {
    const { dateStr, timeStr } = splitLocalDateTime(existing.start_time, master.timezone);
    const date = req.body?.date ?? dateStr;
    const time = req.body?.time ?? timeStr;
    if (!isValidDate(date) || !isValidTime(time)) {
      return res.status(400).json({ error: 'invalid_request' });
    }
    const minutes =
      resolved?.totalMinutes ??
      Math.round((new Date(existing.end_time) - new Date(existing.start_time)) / 60000);
    const startTime = localToUtc(date, time, master.timezone);
    set('start_time', startTime);
    set('end_time', new Date(startTime.getTime() + minutes * 60_000));
  }

  if (fields.length === 0) return res.status(400).json({ error: 'no_fields_to_update' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    values.push(id, master.id);
    await client.query(
      `UPDATE bookings SET ${fields.join(', ')}
       WHERE id = $${values.length - 1} AND master_id = $${values.length}`,
      values
    );
    if (resolved) await replaceItems(client, master.id, id, resolved.items);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === EXCLUSION_VIOLATION) return res.status(409).json({ error: 'slot_taken' });
    throw err;
  } finally {
    client.release();
  }

  const updated = await getBookingWithItems(master.id, id);
  res.json(updated);
  tellGuestAboutChange(existing, updated);
}));

// A guest who turned on Telegram reminders hears when the master moves or
// cancels their visit. Marking a visit completed or a no-show, or changing its
// zones, isn't news to them.
function tellGuestAboutChange(before, after) {
  if (!after) return;
  if (after.status === 'cancelled' && before.status !== 'cancelled') {
    notifyGuest({ type: 'cancelled', bookingId: after.id });
  } else if (
    after.status === 'confirmed' &&
    new Date(after.start_time).getTime() !== new Date(before.start_time).getTime()
  ) {
    notifyGuest({ type: 'moved', bookingId: after.id, previousStartTime: before.start_time });
  }
}

// Bulk delete, for clearing out cancelled bookings. Only cancelled rows can go:
// a confirmed booking is a commitment and a completed one is a line in the
// financial history.
adminRouter.delete('/bookings', asyncHandler(async (req, res) => {
  const ids = req.body?.ids;
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'missing_ids' });
  if (ids.length > 500) return res.status(400).json({ error: 'too_many_ids' });
  const numericIds = ids.map(Number);
  if (numericIds.some((id) => !Number.isInteger(id))) {
    return res.status(400).json({ error: 'invalid_booking_id' });
  }

  const { rows } = await pool.query(
    `DELETE FROM bookings WHERE master_id = $1 AND id = ANY($2::int[]) AND status = 'cancelled'
     RETURNING id`,
    [req.master.id, numericIds]
  );

  const deleted = new Set(rows.map((r) => r.id));
  res.json({ deleted: deleted.size, skipped: numericIds.filter((id) => !deleted.has(id)) });
}));

adminRouter.patch('/bookings/:id/status', asyncHandler(async (req, res) => {
  const id = idParam(req);
  const status = req.body?.status;
  if (id === null) return res.status(400).json({ error: 'invalid_booking_id' });
  if (!BOOKING_STATUSES.includes(status)) return res.status(400).json({ error: 'invalid_status' });

  const { rows: previous } = await pool.query(
    'SELECT status FROM bookings WHERE id = $1 AND master_id = $2',
    [id, req.master.id]
  );
  const { rows } = await pool.query(
    `UPDATE bookings SET status = $3 WHERE id = $1 AND master_id = $2
     RETURNING id, status, start_time, end_time`,
    [id, req.master.id, status]
  );

  if (!rows[0]) return res.status(404).json({ error: 'booking_not_found' });
  res.json(rows[0]);
  if (previous[0]) tellGuestAboutChange({ ...rows[0], status: previous[0].status }, rows[0]);
}));

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

const EXPENSE_COLUMNS = 'id, category, description, amount, date';

adminRouter.get('/expenses', asyncHandler(async (req, res) => {
  const today = todayDateStr(req.master.timezone);
  const from = isValidDate(req.query.from) ? req.query.from : addDaysToDateStr(today, -90);
  const to = isValidDate(req.query.to) ? req.query.to : today;
  const category = req.query.category ? cleanString(req.query.category, 100) : null;

  const params = [req.master.id, from, to];
  let query = `SELECT ${EXPENSE_COLUMNS} FROM expenses
                WHERE master_id = $1 AND date BETWEEN $2 AND $3`;
  if (category) {
    params.push(category);
    query += ' AND category = $4';
  }
  query += ' ORDER BY date DESC, id DESC';

  const { rows } = await pool.query(query, params);
  res.json(rows);
}));

adminRouter.get('/expenses/categories', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT category, MAX(date) AS last_used FROM expenses WHERE master_id = $1
     GROUP BY category ORDER BY last_used DESC LIMIT 50`,
    [req.master.id]
  );
  res.json(rows.map((r) => r.category));
}));

adminRouter.post('/expenses', asyncHandler(async (req, res) => {
  const category = cleanString(req.body?.category, 100);
  const description = cleanString(req.body?.description, 300) || null;
  const amount = Number(req.body?.amount);
  const date = req.body?.date;

  if (!category) return res.status(400).json({ error: 'missing_category' });
  if (!Number.isInteger(amount) || amount <= 0) return res.status(400).json({ error: 'invalid_amount' });
  if (!isValidDate(date)) return res.status(400).json({ error: 'invalid_date' });

  const { rows } = await pool.query(
    `INSERT INTO expenses (master_id, category, description, amount, date)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${EXPENSE_COLUMNS}`,
    [req.master.id, category, description, amount, date]
  );
  res.status(201).json(rows[0]);
}));

adminRouter.patch('/expenses/:id', asyncHandler(async (req, res) => {
  const id = idParam(req);
  if (id === null) return res.status(400).json({ error: 'invalid_expense_id' });

  const fields = [];
  const values = [];
  const set = (column, value) => {
    values.push(value);
    fields.push(`${column} = $${values.length}`);
  };

  if (req.body?.category !== undefined) {
    const category = cleanString(req.body.category, 100);
    if (!category) return res.status(400).json({ error: 'missing_category' });
    set('category', category);
  }
  if (req.body?.description !== undefined) {
    set('description', cleanString(req.body.description, 300) || null);
  }
  if (req.body?.amount !== undefined) {
    const amount = Number(req.body.amount);
    if (!Number.isInteger(amount) || amount <= 0) return res.status(400).json({ error: 'invalid_amount' });
    set('amount', amount);
  }
  if (req.body?.date !== undefined) {
    if (!isValidDate(req.body.date)) return res.status(400).json({ error: 'invalid_date' });
    set('date', req.body.date);
  }

  if (fields.length === 0) return res.status(400).json({ error: 'no_fields_to_update' });

  values.push(id, req.master.id);
  const { rows } = await pool.query(
    `UPDATE expenses SET ${fields.join(', ')}
     WHERE id = $${values.length - 1} AND master_id = $${values.length}
     RETURNING ${EXPENSE_COLUMNS}`,
    values
  );
  if (!rows[0]) return res.status(404).json({ error: 'expense_not_found' });
  res.json(rows[0]);
}));

adminRouter.delete('/expenses/:id', asyncHandler(async (req, res) => {
  const id = idParam(req);
  if (id === null) return res.status(400).json({ error: 'invalid_expense_id' });

  const { rowCount } = await pool.query('DELETE FROM expenses WHERE id = $1 AND master_id = $2', [
    id,
    req.master.id,
  ]);
  if (rowCount === 0) return res.status(404).json({ error: 'expense_not_found' });
  res.status(204).end();
}));

// ---------------------------------------------------------------------------
// Financials
// ---------------------------------------------------------------------------

adminRouter.get('/financials', asyncHandler(async (req, res) => {
  const master = req.master;
  const today = todayDateStr(master.timezone);
  const from = isValidDate(req.query.from) ? req.query.from : `${today.slice(0, 7)}-01`;
  const to = isValidDate(req.query.to) ? req.query.to : today;

  // Zone names repeat across treatments ("Deep bikini" is both waxing and
  // sugaring), so each row carries its treatment for the dashboard to group by.
  // Days are the master's local calendar days.
  const { rows: incomeByService } = await pool.query(
    `SELECT s.id AS service_id, s.name_en, s.name_ru, s.name_hy,
            c.id AS category_id, c.name_en AS category_name_en,
            c.name_ru AS category_name_ru, c.name_hy AS category_name_hy,
            COALESCE(SUM(i.price_at_booking), 0) AS total, COUNT(i.id) AS count
     FROM booking_items i
     JOIN bookings b ON b.id = i.booking_id
     JOIN services s ON s.id = i.service_id
     JOIN service_categories c ON c.id = s.category_id
     WHERE b.master_id = $1 AND b.status = 'completed'
       AND (b.start_time AT TIME ZONE $4)::date BETWEEN $2 AND $3
     GROUP BY s.id, c.id
     ORDER BY total DESC`,
    [master.id, from, to, master.timezone]
  );

  // One visit covering three zones is one completed booking but three rows
  // above, so the headline count is asked for separately.
  const { rows: completedRows } = await pool.query(
    `SELECT COUNT(*)::int AS count FROM bookings
     WHERE master_id = $1 AND status = 'completed'
       AND (start_time AT TIME ZONE $4)::date BETWEEN $2 AND $3`,
    [master.id, from, to, master.timezone]
  );

  const { rows: expensesByCategory } = await pool.query(
    `SELECT category, COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count
     FROM expenses
     WHERE master_id = $1 AND date BETWEEN $2 AND $3
     GROUP BY category
     ORDER BY total DESC`,
    [master.id, from, to]
  );

  const byService = incomeByService.map((row) => ({ ...row, total: Number(row.total), count: Number(row.count) }));
  const byCategory = expensesByCategory.map((row) => ({ ...row, total: Number(row.total), count: Number(row.count) }));

  const incomeTotal = byService.reduce((sum, row) => sum + row.total, 0);
  const expensesTotal = byCategory.reduce((sum, row) => sum + row.total, 0);

  res.json({
    period: { from, to },
    income: { total: incomeTotal, byService },
    expenses: { total: expensesTotal, byCategory },
    net: incomeTotal - expensesTotal,
    bookingsCompleted: completedRows[0].count,
  });
}));

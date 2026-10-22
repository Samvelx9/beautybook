import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { pool } from '../db.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { requireAccount, requireCalendar, requireOwner } from '../middleware/auth.js';
import { cleanString, isValidDate } from '../lib/validate.js';
import { todayDateStr, addDaysToDateStr, isValidTimeZone } from '../lib/time.js';
import { BOOKING_WINDOW_CHOICES, MIN_NOTICE_CHOICES } from '../services/availability.js';
import {
  accessSummary,
  deleteOrganization,
  getMasterById,
  getOrganizationById,
  masterSiteUrl,
  newConnectToken,
  offerByAllMasters,
  setOrganizationLocale,
  changeMasterSlug,
} from '../services/masters.js';
import { getBotUsername, telegramToken } from '../services/telegram.js';
import { billingConfig, createCheckout } from '../services/billing.js';
import { applyTemplate, TEMPLATES } from '../services/templates.js';
import { EMAIL_PATTERN, readCurrency, readLanguages } from './auth.js';
import { changeOwnPassword } from '../services/accounts.js';
import { sendCsv } from '../lib/csv.js';
import { RECENT_BOOKINGS_SQL } from '../lib/popularity.js';
import {
  OWN_CATEGORY_SQL,
  OWN_SERVICE_SQL,
  VISIBLE_CATEGORY_SQL,
  isSalonMaster,
  ownsCategory,
  ownsService,
  seesCategory,
} from '../services/priceListAccess.js';
import { calendarRouter } from './calendar.js';

// The admin panel of one login: an organization's owner, or one of a salon's
// masters. `requireAccount` sets `req.organization` and `req.master` (the
// login's own calendar, or null) from the logged-in user, never from the
// request. The price list, expenses and billing below are scoped to
// `req.organization.id`; the calendar routes (routes/calendar.js) to
// `req.master.id`. An id in a URL or body only ever names a row *within* that
// data.
//
// The owner manages the organization: billing, the price list, expenses. A
// salon's master works their own calendar and reads the price list.
export const adminRouter = Router();
adminRouter.use(requireAccount);
adminRouter.use(['/profile', '/availability', '/bookings'], requireCalendar);
adminRouter.use(calendarRouter);

const FOREIGN_KEY_VIOLATION = '23503';
// A delete blocked by a RESTRICT foreign key: Postgres 16 reports it as a
// foreign-key violation, Postgres 17+ as its own restrict_violation.
const RESTRICT_VIOLATION = '23001';
const isBlockedDelete = (err) => err.code === FOREIGN_KEY_VIOLATION || err.code === RESTRICT_VIOLATION;
const CHECK_VIOLATION = '23514';
const UNIQUE_VIOLATION = '23505';
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
// Account: the login's settings, standing and integrations
// ---------------------------------------------------------------------------

async function accountBody(req) {
  const organization = await getOrganizationById(req.organization.id);
  const master = req.master && (await getMasterById(req.master.id));
  return {
    email: req.user.email,
    isPlatformAdmin: req.user.is_platform_admin,
    role: req.user.role,
    // The locale is the organization's: an owner without a calendar formats
    // prices and dates by it too.
    organization: {
      id: organization.id,
      kind: organization.kind,
      name: organization.name,
      timezone: organization.timezone,
      currency: organization.currency,
      languages: organization.languages,
      defaultLang: organization.default_lang,
      notifyLang: organization.notify_lang,
      telegramConnected: Boolean(organization.telegram_chat_id),
    },
    // Null for a salon owner who isn't one of its masters.
    master: master && {
      id: master.id,
      slug: master.slug,
      color: master.color,
      siteUrl: masterSiteUrl(master),
      customDomain: master.custom_domain,
      timezone: master.timezone,
      currency: master.currency,
      languages: master.languages,
      defaultLang: master.default_lang,
      notifyLang: master.notify_lang,
      minNoticeMinutes: master.min_notice_minutes,
      bookingWindowDays: master.booking_window_days,
      telegramConnected: Boolean(master.telegram_chat_id),
      createdAt: master.created_at,
    },
    access: accessSummary(master ?? organization),
    telegramAvailable: Boolean(telegramToken()),
    billingAvailable: Boolean(billingConfig()),
  };
}

adminRouter.get('/account', asyncHandler(async (req, res) => {
  res.json(await accountBody(req));
}));

// Timezone, currency and languages are the organization's — a salon's masters
// share one price list — so only the owner changes them, and every master of
// the organization follows. Changing the languages doesn't touch any content:
// names in a language that's switched off simply stop being shown.
//
// Notification language, minimum notice and booking window are the calendar's
// own.
adminRouter.patch('/account/settings', asyncHandler(async (req, res) => {
  const locale = {};
  const fields = [];
  const values = [];
  const set = (column, value) => {
    values.push(value);
    fields.push(`${column} = $${values.length}`);
  };

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
  if (req.body?.notifyLang !== undefined) {
    if (!LANGS.includes(req.body.notifyLang)) return res.status(400).json({ error: 'invalid_lang' });
    set('notify_lang', req.body.notifyLang);
  }
  if (req.body?.minNoticeMinutes !== undefined) {
    const minutes = Number(req.body.minNoticeMinutes);
    if (!MIN_NOTICE_CHOICES.includes(minutes)) return res.status(400).json({ error: 'invalid_min_notice' });
    set('min_notice_minutes', minutes);
  }
  if (req.body?.bookingWindowDays !== undefined) {
    const days = Number(req.body.bookingWindowDays);
    if (!BOOKING_WINDOW_CHOICES.includes(days)) return res.status(400).json({ error: 'invalid_booking_window' });
    set('booking_window_days', days);
  }
  const changesLocale = Object.keys(locale).length > 0;
  if (fields.length === 0 && !changesLocale) return res.status(400).json({ error: 'no_fields_to_update' });
  if (changesLocale && req.user.role !== 'owner') return res.status(403).json({ error: 'not_owner' });
  if (fields.length > 0 && !req.master) return res.status(403).json({ error: 'no_master' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (changesLocale) await setOrganizationLocale(client, req.organization.id, locale);
    if (fields.length > 0) {
      values.push(req.master.id);
      await client.query(`UPDATE masters SET ${fields.join(', ')} WHERE id = $${values.length}`, values);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  res.json(await accountBody(req));
}));

// The login's email. Asks for the password again: the email is what signs in.
adminRouter.post('/account/email', asyncHandler(async (req, res) => {
  const email = cleanString(req.body?.email, 200).toLowerCase();
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!EMAIL_PATTERN.test(email)) return res.status(400).json({ error: 'invalid_email' });
  const { rows } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  if (!rows[0] || !(await bcrypt.compare(password, rows[0].password_hash))) {
    return res.status(403).json({ error: 'wrong_password' });
  }
  try {
    await pool.query('UPDATE users SET email = $2 WHERE id = $1', [req.user.id, email]);
  } catch (err) {
    if (err.code === UNIQUE_VIOLATION) return res.status(409).json({ error: 'email_taken' });
    throw err;
  }
  req.user.email = email;
  res.json(await accountBody(req));
}));

// The login's own page address. The old one stops working at once — links
// already shared, and those in guests' Telegram messages, with it.
adminRouter.patch('/account/slug', requireCalendar, asyncHandler(async (req, res) => {
  const result = await changeMasterSlug(req.master.id, req.body?.slug);
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json(await accountBody(req));
}));

adminRouter.post('/account/password', asyncHandler(async (req, res) => {
  const result = await changeOwnPassword(req.user.id, req.body?.currentPassword, req.body?.newPassword);
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json({ token: result.token });
}));

// Deleting the account removes the whole organization and everything it owns
// (the foreign keys cascade), so only its owner may. Asks for the password
// again — it can't be undone.
adminRouter.delete('/account', requireOwner, asyncHandler(async (req, res) => {
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const { rows } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  if (!rows[0] || !(await bcrypt.compare(password, rows[0].password_hash))) {
    return res.status(403).json({ error: 'wrong_password' });
  }
  await deleteOrganization(req.organization.id);
  res.status(204).end();
}));

// "Connect Telegram": a one-time link to the platform bot. Pressing Start on
// it sends "/start m_<token>", which routes/telegram.js turns into this
// master's notification chat.
adminRouter.post('/telegram/connect', requireCalendar, asyncHandler(async (req, res) => {
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

adminRouter.delete('/telegram', requireCalendar, asyncHandler(async (req, res) => {
  await pool.query(
    'UPDATE masters SET telegram_chat_id = NULL, telegram_connect_token = NULL WHERE id = $1',
    [req.master.id]
  );
  res.json(await accountBody(req));
}));

// A Lemon Squeezy checkout for the organization's subscription — the owner's
// to take out.
adminRouter.post('/billing/checkout', requireOwner, asyncHandler(async (req, res) => {
  const appUrl = (process.env.PUBLIC_URL ?? '').replace(/\/$/, '');
  const result = await createCheckout({
    organizationId: req.organization.id,
    email: req.user.email,
    redirectUrl: `${appUrl}/#settings?billing=done`,
  });
  if (result.error) {
    return res.status(result.error === 'billing_not_configured' ? 503 : 502).json(result);
  }
  res.json(result);
}));

// Adds a starter template's treatments (hidden, unpriced zones) to the list.
adminRouter.post('/templates/:key', requireOwner, asyncHandler(async (req, res) => {
  if (!TEMPLATES[req.params.key]) return res.status(404).json({ error: 'template_not_found' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const added = await applyTemplate(client, req.organization, req.params.key);
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

// Each treatment says whether this login may change it (`editable`). A salon's
// master sees only the treatments that hold a service they perform, or that
// they created — see services/priceListAccess.js.
adminRouter.get('/categories', asyncHandler(async (req, res) => {
  if (isSalonMaster(req)) {
    const { rows } = await pool.query(
      `SELECT ${CATEGORY_COLUMNS}, ${OWN_CATEGORY_SQL('c', '$2')} AS editable
       FROM service_categories c
       WHERE c.organization_id = $1 AND ${VISIBLE_CATEGORY_SQL('c', '$2')}
       ORDER BY c.sort_order, c.id`,
      [req.organization.id, req.master.id]
    );
    return res.json(rows);
  }
  const { rows } = await pool.query(
    `SELECT ${CATEGORY_COLUMNS}, true AS editable
     FROM service_categories WHERE organization_id = $1 ORDER BY sort_order, id`,
    [req.organization.id]
  );
  res.json(rows);
}));

// A salon's master may change a treatment only when it's theirs alone.
const mayChangeCategory = asyncHandler(async (req, res, next) => {
  if (!isSalonMaster(req)) return next();
  const id = idParam(req);
  if (id === null) return res.status(400).json({ error: 'invalid_category_id' });
  if (!(await ownsCategory(req.master.id, id))) return res.status(403).json({ error: 'not_your_category' });
  next();
});

adminRouter.post('/categories', asyncHandler(async (req, res) => {
  const names = readNames(req.body);
  if (!hasSomeName(names)) return res.status(400).json({ error: 'missing_fields' });
  const slug = slugFor(req.body?.slug, [names.name_en, names.name_ru, names.name_hy]);

  const sortOrder = Number(req.body?.sortOrder);
  try {
    const { rows } = await pool.query(
      `INSERT INTO service_categories
         (organization_id, slug, name_en, name_ru, name_hy, description_en, description_ru,
          description_hy, sort_order, is_hourly, created_by_master_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING ${CATEGORY_COLUMNS}, true AS editable`,
      [
        req.organization.id,
        slug,
        names.name_en,
        names.name_ru,
        names.name_hy,
        cleanString(req.body?.descriptionEn, 500),
        cleanString(req.body?.descriptionRu, 500),
        cleanString(req.body?.descriptionHy, 500),
        Number.isInteger(sortOrder) ? sortOrder : 0,
        Boolean(req.body?.isHourly),
        isSalonMaster(req) ? req.master.id : null,
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === UNIQUE_VIOLATION) return res.status(409).json({ error: 'slug_taken' });
    throw err;
  }
}));

adminRouter.patch('/categories/:id', mayChangeCategory, asyncHandler(async (req, res) => {
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

  values.push(id, req.organization.id);
  try {
    const { rows } = await pool.query(
      `UPDATE service_categories SET ${fields.join(', ')}
       WHERE id = $${values.length - 1} AND organization_id = $${values.length}
       RETURNING ${CATEGORY_COLUMNS}, true AS editable`,
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

adminRouter.delete('/categories/:id', mayChangeCategory, asyncHandler(async (req, res) => {
  const id = idParam(req);
  if (id === null) return res.status(400).json({ error: 'invalid_category_id' });

  try {
    const { rowCount } = await pool.query(
      'DELETE FROM service_categories WHERE id = $1 AND organization_id = $2',
      [id, req.organization.id]
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

// Each service with `master_ids` (the working masters who perform it, which
// the owner's booking form narrows by), `editable` (may this login change it)
// and `shared_with` (the other masters who perform it, by name, for a salon's
// master to see why a service isn't theirs to change). A salon's master gets
// only the services they perform.
adminRouter.get('/services', asyncHandler(async (req, res) => {
  const salonMaster = isSalonMaster(req);
  const me = salonMaster ? req.master.id : null;
  const { rows } = await pool.query(
    `SELECT ${SERVICE_COLUMNS_WITH_MODE},
            COALESCE(pop.recent_bookings, 0) AS recent_bookings,
            ARRAY(SELECT ms.master_id FROM master_services ms
                   JOIN masters m ON m.id = ms.master_id AND m.deactivated_at IS NULL
                   WHERE ms.service_id = s.id ORDER BY ms.master_id) AS master_ids,
            ${salonMaster ? OWN_SERVICE_SQL('s', '$2') : 'true'} AS editable,
            COALESCE((SELECT json_agg(json_build_object('slug', m.slug, 'name_en', p.owner_name_en,
                                      'name_ru', p.owner_name_ru, 'name_hy', p.owner_name_hy) ORDER BY m.id)
                        FROM master_services ms
                        JOIN masters m ON m.id = ms.master_id AND m.deactivated_at IS NULL
                        LEFT JOIN salon_profile p ON p.master_id = m.id
                       WHERE ms.service_id = s.id AND m.id IS DISTINCT FROM $2::int), '[]') AS shared_with
     FROM services s
     JOIN service_categories c ON c.id = s.category_id
     LEFT JOIN (${RECENT_BOOKINGS_SQL}) pop ON pop.service_id = s.id
     WHERE s.organization_id = $1
       ${salonMaster ? 'AND EXISTS (SELECT 1 FROM master_services mine WHERE mine.service_id = s.id AND mine.master_id = $2)' : ''}
     ORDER BY s.sort_order, s.id`,
    [req.organization.id, me]
  );
  res.json(rows);
}));

// A salon's master may change a service only when it's theirs alone, and may
// put one only into a treatment they can see.
const mayChangeService = asyncHandler(async (req, res, next) => {
  if (!isSalonMaster(req)) return next();
  const id = idParam(req);
  if (id === null) return res.status(400).json({ error: 'invalid_service_id' });
  if (!(await ownsService(req.master.id, id))) return res.status(403).json({ error: 'not_your_service' });
  next();
});
const mayUseCategory = asyncHandler(async (req, res, next) => {
  if (!isSalonMaster(req) || req.body?.categoryId === undefined) return next();
  const categoryId = Number(req.body.categoryId);
  if (!Number.isInteger(categoryId) || !(await seesCategory(req.master.id, categoryId))) {
    return res.status(400).json({ error: 'invalid_category' });
  }
  next();
});

adminRouter.post('/services', mayUseCategory, asyncHandler(async (req, res) => {
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

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO services
         (organization_id, slug, category_id, name_en, name_ru, name_hy, duration_minutes, price,
          sort_order, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING ${SERVICE_COLUMNS}`,
      [
        req.organization.id,
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
    // The owner's new service is everyone's to perform until they say
    // otherwise; a salon's master adds one for themselves alone.
    if (isSalonMaster(req)) {
      await client.query(
        'INSERT INTO master_services (organization_id, master_id, service_id) VALUES ($1, $2, $3)',
        [req.organization.id, req.master.id, rows[0].id]
      );
    } else {
      await offerByAllMasters(client, req.organization.id, rows[0].id);
    }
    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === UNIQUE_VIOLATION) return res.status(409).json({ error: 'slug_taken' });
    // The category is someone else's or doesn't exist: the composite foreign
    // key refuses it either way.
    if (err.code === FOREIGN_KEY_VIOLATION) return res.status(400).json({ error: 'invalid_category' });
    throw err;
  } finally {
    client.release();
  }
}));

adminRouter.patch('/services/:id', mayChangeService, mayUseCategory, asyncHandler(async (req, res) => {
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

  values.push(id, req.organization.id);
  let rows;
  try {
    ({ rows } = await pool.query(
      `UPDATE services SET ${fields.join(', ')}
       WHERE id = $${values.length - 1} AND organization_id = $${values.length}
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

adminRouter.delete('/services/:id', mayChangeService, asyncHandler(async (req, res) => {
  const id = idParam(req);
  if (id === null) return res.status(400).json({ error: 'invalid_service_id' });

  try {
    const { rowCount } = await pool.query('DELETE FROM services WHERE id = $1 AND organization_id = $2', [
      id,
      req.organization.id,
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
// Taxes: what the organization pays on its income, as percentages of what
// clients paid. The owner's to keep; each visit is taxed at the list as it
// stood when the visit was completed (booking_taxes).
// ---------------------------------------------------------------------------

adminRouter.use('/taxes', requireOwner);

const TAX_COLUMNS = 'id, name, rate_percent, sort_order';
const shapeTax = (row) => ({ id: row.id, name: row.name, ratePercent: Number(row.rate_percent), sortOrder: row.sort_order });

// A rate in percent with at most two decimals, above 0 and at most 100.
function readRate(raw) {
  const rate = Number(raw);
  if (!Number.isFinite(rate) || rate <= 0 || rate > 100) return null;
  return Math.round(rate * 100) === rate * 100 ? rate : null;
}

adminRouter.get('/taxes', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT ${TAX_COLUMNS} FROM taxes WHERE organization_id = $1 ORDER BY sort_order, id`,
    [req.organization.id]
  );
  res.json(rows.map(shapeTax));
}));

adminRouter.post('/taxes', asyncHandler(async (req, res) => {
  const name = cleanString(req.body?.name, 100);
  const rate = readRate(req.body?.ratePercent);
  if (!name) return res.status(400).json({ error: 'missing_tax_name' });
  if (rate === null) return res.status(400).json({ error: 'invalid_tax_rate' });
  const { rows } = await pool.query(
    `INSERT INTO taxes (organization_id, name, rate_percent, sort_order)
     VALUES ($1, $2, $3, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM taxes WHERE organization_id = $1))
     RETURNING ${TAX_COLUMNS}`,
    [req.organization.id, name, rate]
  );
  res.status(201).json(shapeTax(rows[0]));
}));

adminRouter.patch('/taxes/:id', asyncHandler(async (req, res) => {
  const id = idParam(req);
  if (id === null) return res.status(400).json({ error: 'invalid_tax_id' });
  const fields = [];
  const values = [];
  const set = (column, value) => {
    values.push(value);
    fields.push(`${column} = $${values.length}`);
  };
  if (req.body?.name !== undefined) {
    const name = cleanString(req.body.name, 100);
    if (!name) return res.status(400).json({ error: 'missing_tax_name' });
    set('name', name);
  }
  if (req.body?.ratePercent !== undefined) {
    const rate = readRate(req.body.ratePercent);
    if (rate === null) return res.status(400).json({ error: 'invalid_tax_rate' });
    set('rate_percent', rate);
  }
  if (fields.length === 0) return res.status(400).json({ error: 'no_fields_to_update' });

  values.push(id, req.organization.id);
  const { rows } = await pool.query(
    `UPDATE taxes SET ${fields.join(', ')}
     WHERE id = $${values.length - 1} AND organization_id = $${values.length}
     RETURNING ${TAX_COLUMNS}`,
    values
  );
  if (!rows[0]) return res.status(404).json({ error: 'tax_not_found' });
  res.json(shapeTax(rows[0]));
}));

// Visits already completed keep the taxes they were paid at.
adminRouter.delete('/taxes/:id', asyncHandler(async (req, res) => {
  const id = idParam(req);
  if (id === null) return res.status(400).json({ error: 'invalid_tax_id' });
  const { rowCount } = await pool.query('DELETE FROM taxes WHERE id = $1 AND organization_id = $2', [
    id,
    req.organization.id,
  ]);
  if (rowCount === 0) return res.status(404).json({ error: 'tax_not_found' });
  res.status(204).end();
}));

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

// The business's costs — rent, supplies — so the organization's, and the
// owner's to keep.
const EXPENSE_COLUMNS = 'id, category, description, amount, date';
adminRouter.use('/expenses', requireOwner);

adminRouter.get('/expenses', asyncHandler(async (req, res) => {
  const today = todayDateStr(req.organization.timezone);
  const from = isValidDate(req.query.from) ? req.query.from : addDaysToDateStr(today, -90);
  const to = isValidDate(req.query.to) ? req.query.to : today;
  const category = req.query.category ? cleanString(req.query.category, 100) : null;

  const params = [req.organization.id, from, to];
  let query = `SELECT ${EXPENSE_COLUMNS} FROM expenses
                WHERE organization_id = $1 AND date BETWEEN $2 AND $3`;
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
    `SELECT category, MAX(date) AS last_used FROM expenses WHERE organization_id = $1
     GROUP BY category ORDER BY last_used DESC LIMIT 50`,
    [req.organization.id]
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
    `INSERT INTO expenses (organization_id, category, description, amount, date)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${EXPENSE_COLUMNS}`,
    [req.organization.id, category, description, amount, date]
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

  values.push(id, req.organization.id);
  const { rows } = await pool.query(
    `UPDATE expenses SET ${fields.join(', ')}
     WHERE id = $${values.length - 1} AND organization_id = $${values.length}
     RETURNING ${EXPENSE_COLUMNS}`,
    values
  );
  if (!rows[0]) return res.status(404).json({ error: 'expense_not_found' });
  res.json(rows[0]);
}));

adminRouter.delete('/expenses/:id', asyncHandler(async (req, res) => {
  const id = idParam(req);
  if (id === null) return res.status(400).json({ error: 'invalid_expense_id' });

  const { rowCount } = await pool.query('DELETE FROM expenses WHERE id = $1 AND organization_id = $2', [
    id,
    req.organization.id,
  ]);
  if (rowCount === 0) return res.status(404).json({ error: 'expense_not_found' });
  res.status(204).end();
}));

// ---------------------------------------------------------------------------
// Export: bookings and clients as CSV
// ---------------------------------------------------------------------------

// Whose records an export covers: a salon's master their own; the owner the
// whole organization, or one master with ?masterId. Returns the SQL condition
// on `b` and its parameters (starting at $1), or { error }.
function exportScope(req) {
  if (req.user.role !== 'owner') {
    if (!req.master) return { error: 'no_master' };
    return { where: 'b.master_id = $1', params: [req.master.id] };
  }
  if (req.query.masterId !== undefined) {
    const masterId = Number(req.query.masterId);
    if (!Number.isInteger(masterId)) return { error: 'invalid_master_id' };
    return { where: 'b.organization_id = $1 AND b.master_id = $2', params: [req.organization.id, masterId] };
  }
  return { where: 'b.organization_id = $1', params: [req.organization.id] };
}

// GET /api/admin/export/bookings.csv?from&to — every booking in the period
// (the organization's local dates), in time order.
adminRouter.get('/export/bookings.csv', asyncHandler(async (req, res) => {
  const scope = exportScope(req);
  if (scope.error) return res.status(400).json({ error: scope.error });
  const tz = req.organization.timezone;
  const today = todayDateStr(tz);
  const from = isValidDate(req.query.from) ? req.query.from : addDaysToDateStr(today, -365);
  const to = isValidDate(req.query.to) ? req.query.to : addDaysToDateStr(today, 365);
  const n = scope.params.length;

  const { rows } = await pool.query(
    `SELECT to_char(b.start_time AT TIME ZONE $${n + 3}, 'YYYY-MM-DD') AS date,
            to_char(b.start_time AT TIME ZONE $${n + 3}, 'HH24:MI') AS start,
            to_char(b.end_time AT TIME ZONE $${n + 3}, 'HH24:MI') AS finish,
            COALESCE(NULLIF(p.owner_name_hy, ''), NULLIF(p.owner_name_ru, ''), NULLIF(p.owner_name_en, ''), m.slug) AS master,
            b.customer_name, b.customer_phone,
            (SELECT string_agg(COALESCE(NULLIF(s.name_hy, ''), NULLIF(s.name_ru, ''), s.name_en), ' + ' ORDER BY i.sort_order, i.id)
               FROM booking_items i JOIN services s ON s.id = i.service_id WHERE i.booking_id = b.id) AS services,
            b.price_at_booking, b.status,
            to_char(b.created_at AT TIME ZONE $${n + 3}, 'YYYY-MM-DD HH24:MI') AS created
     FROM bookings b
     JOIN masters m ON m.id = b.master_id
     LEFT JOIN salon_profile p ON p.master_id = m.id
     WHERE ${scope.where}
       AND (b.start_time AT TIME ZONE $${n + 3})::date BETWEEN $${n + 1} AND $${n + 2}
     ORDER BY b.start_time, b.id`,
    [...scope.params, from, to, tz]
  );
  sendCsv(
    res,
    `bookings-${from}-${to}.csv`,
    ['date', 'start', 'end', 'master', 'client', 'phone', 'services', 'price', 'currency', 'status', 'booked at'],
    rows.map((r) => [
      r.date, r.start, r.finish, r.master, r.customer_name, r.customer_phone, r.services,
      r.price_at_booking, req.organization.currency, r.status, r.created,
    ])
  );
}));

// GET /api/admin/export/clients.csv — everyone who has booked, told apart by
// phone number: their latest name, how often they came, and what they spent.
adminRouter.get('/export/clients.csv', asyncHandler(async (req, res) => {
  const scope = exportScope(req);
  if (scope.error) return res.status(400).json({ error: scope.error });
  const n = scope.params.length;
  const { rows } = await pool.query(
    `SELECT b.customer_phone AS phone,
            (array_agg(b.customer_name ORDER BY b.start_time DESC))[1] AS name,
            COUNT(*) FILTER (WHERE b.status <> 'cancelled')::int AS bookings,
            COUNT(*) FILTER (WHERE b.status = 'completed')::int AS visits,
            COUNT(*) FILTER (WHERE b.status = 'no_show')::int AS no_shows,
            to_char(MIN(b.start_time) FILTER (WHERE b.status = 'completed') AT TIME ZONE $${n + 1}, 'YYYY-MM-DD') AS first_visit,
            to_char(MAX(b.start_time) FILTER (WHERE b.status = 'completed') AT TIME ZONE $${n + 1}, 'YYYY-MM-DD') AS last_visit,
            COALESCE(SUM(b.price_at_booking) FILTER (WHERE b.status = 'completed'), 0)::bigint AS spent
     FROM bookings b
     WHERE ${scope.where}
     GROUP BY b.customer_phone
     ORDER BY MAX(b.start_time) DESC`,
    [...scope.params, req.organization.timezone]
  );
  sendCsv(
    res,
    'clients.csv',
    ['phone', 'name', 'bookings', 'visits', 'no-shows', 'first visit', 'last visit', 'spent', 'currency'],
    rows.map((r) => [
      r.phone, r.name, r.bookings, r.visits, r.no_shows, r.first_visit, r.last_visit, Number(r.spent),
      req.organization.currency,
    ])
  );
}));

// ---------------------------------------------------------------------------
// Financials
// ---------------------------------------------------------------------------

// What came in and what went out over a period.
//
// The owner sees the whole organization — every master's completed visits at
// what the clients paid (`total`), the owner's part of that once the masters'
// shares are paid (`ownerShare`), and the expenses — and may narrow the
// income to one master with ?masterId. Net is the owner's part less expenses:
// a master's share was never the salon's money.
//
// A salon's master sees only what is theirs: their share of their own visits,
// as `total`, the taxes they pay on it, and what's left. Each visit is split
// at the share it was completed at (bookings.master_share_percent), and taxed
// at the taxes it was completed with (booking_taxes): a tax the master pays
// comes out of their share, one the salon pays out of the salon's, and with
// "both" each pays on their own part.
//
// `taxes` sums them for the period, per tax — what is due to the tax office —
// split into what the masters and the salon pay. Net is the owner's part less
// the salon's taxes and the expenses.
adminRouter.get('/financials', asyncHandler(async (req, res) => {
  const isOwner = req.user.role === 'owner';
  const tz = req.organization.timezone;
  const today = todayDateStr(tz);
  const from = isValidDate(req.query.from) ? req.query.from : `${today.slice(0, 7)}-01`;
  const to = isValidDate(req.query.to) ? req.query.to : today;

  let masterId = null;
  if (!isOwner) {
    if (!req.master) return res.status(403).json({ error: 'no_master' });
    masterId = req.master.id;
  } else if (req.query.masterId !== undefined) {
    masterId = Number(req.query.masterId);
    if (!Number.isInteger(masterId)) return res.status(400).json({ error: 'invalid_master_id' });
  }

  // `$1` is always the organization; `$5`, when set, one master within it.
  const params = [req.organization.id, from, to, tz];
  let onlyMaster = '';
  if (masterId !== null) {
    params.push(masterId);
    onlyMaster = ' AND b.master_id = $5';
  }
  const completed = `b.organization_id = $1 AND b.status = 'completed'
       AND (b.start_time AT TIME ZONE $4)::date BETWEEN $2 AND $3${onlyMaster}`;
  // The master's part of an amount, rounded to whole units per visit.
  const masterPart = (amount) => `round(${amount} * b.master_share_percent / 100.0)`;

  // Zone names repeat across treatments ("Deep bikini" is both waxing and
  // sugaring), so each row carries its treatment for the dashboard to group by.
  // Days are the organization's local calendar days.
  const { rows: incomeByService } = await pool.query(
    `SELECT s.id AS service_id, s.name_en, s.name_ru, s.name_hy,
            c.id AS category_id, c.name_en AS category_name_en,
            c.name_ru AS category_name_ru, c.name_hy AS category_name_hy,
            COALESCE(SUM(i.price_at_booking), 0) AS total,
            COALESCE(SUM(${masterPart('i.price_at_booking')}), 0) AS master_share,
            COUNT(i.id) AS count
     FROM booking_items i
     JOIN bookings b ON b.id = i.booking_id
     JOIN services s ON s.id = i.service_id
     JOIN service_categories c ON c.id = s.category_id
     WHERE ${completed}
     GROUP BY s.id, c.id
     ORDER BY total DESC`,
    params
  );

  // Per master — also the headline numbers, summed below: one visit covering
  // three zones is one completed booking but three rows above.
  const { rows: incomeByMaster } = await pool.query(
    `SELECT b.master_id, COALESCE(SUM(b.price_at_booking), 0) AS total,
            COALESCE(SUM(${masterPart('b.price_at_booking')}), 0) AS master_share,
            COUNT(*) AS count
     FROM bookings b
     WHERE ${completed}
     GROUP BY b.master_id
     ORDER BY total DESC`,
    params
  );

  // Every tax line of every completed visit, with each side's part of it,
  // rounded to whole units per visit.
  const { rows: taxRows } = await pool.query(
    `WITH v AS (
       SELECT b.id, b.master_id, b.price_at_booking AS price,
              ${masterPart('b.price_at_booking')} AS master_part
       FROM bookings b
       WHERE ${completed}
     )
     SELECT v.master_id, t.name, t.rate_percent,
            SUM(CASE t.payer
                  WHEN 'master' THEN round(v.price * t.rate_percent / 100)
                  WHEN 'both' THEN round(v.master_part * t.rate_percent / 100)
                  ELSE 0 END) AS master_tax,
            SUM(CASE t.payer
                  WHEN 'salon' THEN round(v.price * t.rate_percent / 100)
                  WHEN 'both' THEN round((v.price - v.master_part) * t.rate_percent / 100)
                  ELSE 0 END) AS salon_tax
     FROM v JOIN booking_taxes t ON t.booking_id = v.id
     GROUP BY v.master_id, t.name, t.rate_percent
     -- The heaviest tax first, so the list reads the same every time.
     ORDER BY t.rate_percent DESC, t.name`,
    params
  );
  const taxLines = taxRows.map((r) => ({
    masterId: r.master_id,
    name: r.name,
    ratePercent: Number(r.rate_percent),
    masterTax: Number(r.master_tax),
    salonTax: Number(r.salon_tax),
  }));
  // Per tax (name and rate), summed over masters.
  const byTax = new Map();
  for (const line of taxLines) {
    const key = `${line.name}|${line.ratePercent}`;
    const entry = byTax.get(key) ?? { name: line.name, ratePercent: line.ratePercent, mastersPay: 0, salonPays: 0 };
    entry.mastersPay += line.masterTax;
    entry.salonPays += line.salonTax;
    byTax.set(key, entry);
  }
  const taxesOf = (masterId, side) =>
    taxLines.filter((l) => masterId === null || l.masterId === masterId).reduce((sum, l) => sum + l[side], 0);

  const { rows: expensesByCategory } = isOwner
    ? await pool.query(
        `SELECT category, COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count
         FROM expenses
         WHERE organization_id = $1 AND date BETWEEN $2 AND $3
         GROUP BY category
         ORDER BY total DESC`,
        [req.organization.id, from, to]
      )
    : { rows: [] };

  // For the owner: the whole amount and their part of it. For a master: their
  // part, as the only amount they see.
  const shaped = ({ master_share: share, ...row }) => {
    const total = Number(row.total);
    const masterShare = Number(share);
    return isOwner
      ? { ...row, total, ownerShare: total - masterShare, count: Number(row.count) }
      : { ...row, total: masterShare, count: Number(row.count) };
  };
  const byService = incomeByService.map(shaped);
  const byMaster = incomeByMaster.map(shaped);
  const byCategory = expensesByCategory.map((row) => ({ ...row, total: Number(row.total), count: Number(row.count) }));

  const incomeTotal = byMaster.reduce((sum, row) => sum + row.total, 0);
  const ownerShare = byMaster.reduce((sum, row) => sum + (row.ownerShare ?? 0), 0);
  const expensesTotal = byCategory.reduce((sum, row) => sum + row.total, 0);
  const completedCount = byMaster.reduce((sum, row) => sum + row.count, 0);

  if (!isOwner) {
    const taxes = taxesOf(null, 'masterTax');
    return res.json({
      period: { from, to },
      income: { total: incomeTotal, byService, byMaster: [] },
      taxes: {
        total: taxes,
        byTax: [...byTax.values()]
          .filter((t) => t.mastersPay > 0)
          .map((t) => ({ name: t.name, ratePercent: t.ratePercent, total: t.mastersPay })),
      },
      expenses: { total: 0, byCategory: [] },
      net: incomeTotal - taxes,
      bookingsCompleted: completedCount,
    });
  }

  const salonTaxes = taxesOf(null, 'salonTax');
  res.json({
    period: { from, to },
    income: {
      total: incomeTotal,
      ownerShare,
      byService,
      byMaster: byMaster.map((row) => ({
        ...row,
        masterShare: row.total - row.ownerShare,
        masterTaxes: taxesOf(row.master_id, 'masterTax'),
        salonTaxes: taxesOf(row.master_id, 'salonTax'),
      })),
    },
    taxes: {
      // What the salon pays itself; the masters' part comes out of their shares.
      total: salonTaxes,
      mastersPay: taxesOf(null, 'masterTax'),
      byTax: [...byTax.values()].map((t) => ({ ...t, total: t.mastersPay + t.salonPays })),
    },
    expenses: { total: expensesTotal, byCategory },
    net: ownerShare - salonTaxes - expensesTotal,
    bookingsCompleted: completedCount,
  });
}));

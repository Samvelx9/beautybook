import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { pool } from '../db.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { cleanString } from '../lib/validate.js';
import { rateLimit } from '../lib/rateLimit.js';
import { isValidTimeZone, DEFAULT_TIMEZONE } from '../lib/time.js';
import { signToken } from '../middleware/auth.js';
import { createMaster, getMasterById, slugProblem } from '../services/masters.js';
import { applyTemplate, templateList, TEMPLATES } from '../services/templates.js';

// Signing up and logging in — public, at app.<PLATFORM_DOMAIN>.
export const authRouter = Router();

const LANGS = ['hy', 'ru', 'en'];
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MIN_PASSWORD_LENGTH = 8;

const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);

const signupLimit = rateLimit({ name: 'signup', windowMs: 60 * 60_000, max: 10 });
const loginLimit = rateLimit({ name: 'login', windowMs: 15 * 60_000, max: 20 });
const slugLimit = rateLimit({ name: 'slug', windowMs: 60_000, max: 60 });

// Whatever the client sends, languages end up a non-empty subset of the
// supported three in their canonical order, and the default is one of them.
export function readLanguages(rawLanguages, rawDefault) {
  const languages = LANGS.filter((l) => Array.isArray(rawLanguages) && rawLanguages.includes(l));
  if (languages.length === 0) return { error: 'invalid_languages' };
  const defaultLang = languages.includes(rawDefault) ? rawDefault : languages[0];
  return { languages, defaultLang };
}

export function readCurrency(raw) {
  const currency = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
  return /^[A-Z]{3}$/.test(currency) ? currency : null;
}

// GET /api/auth/slug?slug=anna — is this address free?
authRouter.get('/slug', slugLimit, asyncHandler(async (req, res) => {
  const slug = String(req.query.slug ?? '').toLowerCase();
  const problem = slugProblem(slug);
  if (problem) return res.json({ available: false, reason: problem });
  const { rows } = await pool.query('SELECT 1 FROM masters WHERE slug = $1', [slug]);
  res.json(rows[0] ? { available: false, reason: 'slug_taken' } : { available: true });
}));

// GET /api/auth/templates — the starter price lists sign-up offers.
authRouter.get('/templates', (_req, res) => {
  res.json(templateList());
});

// POST /api/auth/signup — a new master, their login, their (empty) page and a
// free trial, all in one transaction. Answers with a session token so the new
// master lands straight in their admin panel.
authRouter.post('/signup', signupLimit, asyncHandler(async (req, res) => {
  const email = cleanString(req.body?.email, 200).toLowerCase();
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const slug = cleanString(req.body?.slug, 40).toLowerCase();
  const displayName = cleanString(req.body?.displayName, 100);
  const timezone = req.body?.timezone ?? DEFAULT_TIMEZONE;
  const currency = readCurrency(req.body?.currency ?? 'AMD');
  const langs = readLanguages(req.body?.languages ?? LANGS, req.body?.defaultLang);
  const notifyLang = LANGS.includes(req.body?.notifyLang) ? req.body.notifyLang : 'ru';
  const templates = Array.isArray(req.body?.templates)
    ? req.body.templates.filter((key) => TEMPLATES[key])
    : [];

  if (!EMAIL_PATTERN.test(email)) return res.status(400).json({ error: 'invalid_email' });
  if (password.length < MIN_PASSWORD_LENGTH || password.length > 200) {
    return res.status(400).json({ error: 'weak_password', minLength: MIN_PASSWORD_LENGTH });
  }
  const problem = slugProblem(slug);
  if (problem) return res.status(400).json({ error: problem });
  if (!displayName) return res.status(400).json({ error: 'missing_display_name' });
  if (!isValidTimeZone(timezone)) return res.status(400).json({ error: 'invalid_timezone' });
  if (!currency) return res.status(400).json({ error: 'invalid_currency' });
  if (langs.error) return res.status(400).json({ error: langs.error });

  const passwordHash = await bcrypt.hash(password, 12);

  const client = await pool.connect();
  let user;
  try {
    await client.query('BEGIN');
    const masterId = await createMaster(client, {
      slug,
      timezone,
      currency,
      languages: langs.languages,
      defaultLang: langs.defaultLang,
      displayName,
    });
    await client.query('UPDATE masters SET notify_lang = $2 WHERE id = $1', [masterId, notifyLang]);
    const { rows } = await client.query(
      `INSERT INTO users (master_id, email, password_hash) VALUES ($1, $2, $3)
       RETURNING id, token_version`,
      [masterId, email, passwordHash]
    );
    user = rows[0];

    const master = await getMasterById(masterId, client);
    for (const key of templates) {
      await applyTemplate(client, master, key);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      const field = String(err.constraint ?? '').includes('email') ? 'email_taken' : 'slug_taken';
      return res.status(409).json({ error: field });
    }
    throw err;
  } finally {
    client.release();
  }

  res.status(201).json({ token: signToken(user) });
}));

// POST /api/auth/login
authRouter.post('/login', loginLimit, asyncHandler(async (req, res) => {
  const email = cleanString(req.body?.email, 200).toLowerCase();
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!email || !password) {
    return res.status(400).json({ error: 'missing_credentials' });
  }

  const { rows } = await pool.query(
    'SELECT id, password_hash, token_version FROM users WHERE lower(email) = $1',
    [email]
  );
  const user = rows[0];
  // Compared against a dummy hash when there's no such user, so a wrong email
  // takes as long to refuse as a wrong password.
  const valid = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH);
  if (!user || !valid) {
    return res.status(401).json({ error: 'invalid_credentials' });
  }

  res.json({ token: signToken(user) });
}));

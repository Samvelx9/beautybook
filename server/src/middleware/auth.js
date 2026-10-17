import jwt from 'jsonwebtoken';
import { pool } from '../db.js';
import { getMasterById, getOrganizationById } from '../services/masters.js';

export function signToken(user) {
  return jwt.sign(
    { sub: String(user.id), v: user.token_version },
    process.env.JWT_SECRET,
    { expiresIn: '30d' }
  );
}

// Who is calling, from their bearer token. The user is read fresh on every
// request rather than trusted from the token, so a password change (which
// bumps token_version) or a deleted account ends existing sessions at once.
async function authenticate(req) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return { error: 'missing_token' };

  let claims;
  try {
    claims = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return { error: 'invalid_token' };
  }

  const { rows } = await pool.query(
    `SELECT id, master_id, organization_id, role, email, is_platform_admin, token_version
     FROM users WHERE id = $1`,
    [Number(claims.sub)]
  );
  const user = rows[0];
  if (!user || user.token_version !== claims.v) return { error: 'invalid_token' };
  return { user };
}

// A login of an organization: an owner or one of a salon's masters.
//
// - `req.organization` is the organization the login belongs to — taken from
//   the logged-in user, never from the request. The price list, expenses and
//   billing are scoped to it.
// - `req.master` is the login's own calendar, or null for a salon owner who
//   isn't one of its masters. Whatever is scoped to a calendar uses it.
//
// A master the salon has deactivated can't sign in at all.
export async function requireAccount(req, res, next) {
  try {
    const { user, error } = await authenticate(req);
    if (error) return res.status(401).json({ error });
    if (!user.organization_id) return res.status(403).json({ error: 'no_master' });

    const organization = await getOrganizationById(user.organization_id);
    const master = user.master_id ? await getMasterById(user.master_id) : null;
    if (!organization || (user.master_id && !master)) {
      return res.status(401).json({ error: 'invalid_token' });
    }
    if (user.role === 'master' && master.deactivated_at) {
      return res.status(403).json({ error: 'master_deactivated' });
    }

    req.user = user;
    req.organization = organization;
    req.master = master;
    next();
  } catch (err) {
    next(err);
  }
}

// After requireAccount, for what only makes sense with a calendar.
export function requireCalendar(req, res, next) {
  if (!req.master) return res.status(403).json({ error: 'no_master' });
  next();
}

// After requireAccount, for what is the owner's alone: billing, the price
// list, expenses, the salon's masters.
export function requireOwner(req, res, next) {
  if (req.user.role !== 'owner') return res.status(403).json({ error: 'not_owner' });
  next();
}

// The platform operator's screens (routes/platform.js).
export async function requirePlatformAdmin(req, res, next) {
  try {
    const { user, error } = await authenticate(req);
    if (error) return res.status(401).json({ error });
    if (!user.is_platform_admin) return res.status(403).json({ error: 'forbidden' });
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

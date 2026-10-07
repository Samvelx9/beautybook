import jwt from 'jsonwebtoken';
import { pool } from '../db.js';
import { getMasterById } from '../services/masters.js';

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
    'SELECT id, master_id, email, is_platform_admin, token_version FROM users WHERE id = $1',
    [Number(claims.sub)]
  );
  const user = rows[0];
  if (!user || user.token_version !== claims.v) return { error: 'invalid_token' };
  return { user };
}

// A master's own admin panel. `req.master` is the master every query in
// routes/admin.js is scoped to — taken from the logged-in user, never from the
// request.
export async function requireMasterAuth(req, res, next) {
  try {
    const { user, error } = await authenticate(req);
    if (error) return res.status(401).json({ error });
    if (!user.master_id) return res.status(403).json({ error: 'no_master' });

    const master = await getMasterById(user.master_id);
    if (!master) return res.status(401).json({ error: 'invalid_token' });

    req.user = user;
    req.master = master;
    next();
  } catch (err) {
    next(err);
  }
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

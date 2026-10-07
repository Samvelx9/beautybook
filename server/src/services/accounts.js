import bcrypt from 'bcryptjs';
import { pool } from '../db.js';
import { signToken } from '../middleware/auth.js';

export const MIN_PASSWORD_LENGTH = 8;

// A logged-in user changing their own password — a master in Settings or the
// platform operator on theirs. The current password is asked for again, and
// bumping token_version ends every other session; the caller gets a fresh
// token for this one. Returns { token } or { status, error }.
export async function changeOwnPassword(userId, currentPassword, newPassword) {
  const current = typeof currentPassword === 'string' ? currentPassword : '';
  const next = typeof newPassword === 'string' ? newPassword : '';
  if (next.length < MIN_PASSWORD_LENGTH || next.length > 200) {
    return { status: 400, error: 'weak_password' };
  }

  const { rows } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [userId]);
  if (!rows[0] || !(await bcrypt.compare(current, rows[0].password_hash))) {
    return { status: 403, error: 'wrong_password' };
  }

  const { rows: updated } = await pool.query(
    `UPDATE users SET password_hash = $2, token_version = token_version + 1
     WHERE id = $1 RETURNING id, token_version`,
    [userId, await bcrypt.hash(next, 12)]
  );
  return { token: signToken(updated[0]) };
}

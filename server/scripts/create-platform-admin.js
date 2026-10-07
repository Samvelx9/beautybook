// Creates (or resets) the platform operator's login — the account that sees
// every master on the Platform screen. It has no booking page of its own.
//
//   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='...' npm run create-platform-admin
//
// An existing user with that email (say, the operator's own master account)
// is promoted instead, and its password is left alone.
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { pool } from '../src/db.js';

const email = String(process.env.ADMIN_EMAIL ?? '').trim().toLowerCase();
const password = String(process.env.ADMIN_PASSWORD ?? '');

if (!email || password.length < 12) {
  console.error('Set ADMIN_EMAIL and ADMIN_PASSWORD (at least 12 characters).');
  process.exit(1);
}

const { rows } = await pool.query('SELECT id FROM users WHERE lower(email) = $1', [email]);
if (rows[0]) {
  await pool.query('UPDATE users SET is_platform_admin = true WHERE id = $1', [rows[0].id]);
  console.log(`Promoted ${email} to platform admin.`);
} else {
  await pool.query(
    'INSERT INTO users (email, password_hash, is_platform_admin) VALUES ($1, $2, true)',
    [email, await bcrypt.hash(password, 12)]
  );
  console.log(`Created platform admin ${email}.`);
}
await pool.end();

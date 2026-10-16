import { pool } from '../db.js';

// The single platform_settings row, shaped for the API. Prices travel in minor
// units (cents) with an ISO currency code; the clients format them.
export async function getPlatformSettings() {
  const { rows } = await pool.query(
    'SELECT price_monthly_minor, price_currency, support_email FROM platform_settings WHERE id'
  );
  const row = rows[0] ?? { price_monthly_minor: 1000, price_currency: 'USD', support_email: null };
  return {
    priceMonthlyMinor: row.price_monthly_minor,
    priceCurrency: row.price_currency,
    supportEmail: row.support_email,
  };
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// { priceMonthlyMinor?, priceCurrency?, supportEmail? } from the operator.
// Answers { error } for a bad value, or the updated settings.
export async function updatePlatformSettings(body) {
  const sets = [];
  const values = [];
  if (body?.priceMonthlyMinor !== undefined) {
    const minor = Number(body.priceMonthlyMinor);
    if (!Number.isInteger(minor) || minor < 0 || minor > 100_000_000) return { error: 'invalid_price' };
    values.push(minor);
    sets.push(`price_monthly_minor = $${values.length}`);
  }
  if (body?.priceCurrency !== undefined) {
    const currency = String(body.priceCurrency).toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) return { error: 'invalid_currency' };
    values.push(currency);
    sets.push(`price_currency = $${values.length}`);
  }
  if (body?.supportEmail !== undefined) {
    const email = body.supportEmail === null ? '' : String(body.supportEmail).trim();
    if (email && (email.length > 200 || !EMAIL_PATTERN.test(email))) return { error: 'invalid_email' };
    values.push(email || null);
    sets.push(`support_email = $${values.length}`);
  }
  if (sets.length > 0) {
    await pool.query(`UPDATE platform_settings SET ${sets.join(', ')}, updated_at = now() WHERE id`, values);
  }
  return getPlatformSettings();
}

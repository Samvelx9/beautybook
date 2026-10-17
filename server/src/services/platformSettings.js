import { pool } from '../db.js';

// The salon plans' prices, by plan (services/masters.js → planFor), and the
// columns they're kept in.
const SALON_PRICE_COLUMNS = {
  salon_5: 'salon_5_price_minor',
  salon_10: 'salon_10_price_minor',
  salon_unlimited: 'salon_unlimited_price_minor',
};

// The single platform_settings row, shaped for the API. Prices travel in minor
// units (cents) with an ISO currency code; the clients format them.
// `priceMonthlyMinor` is an individual master's; `salonPricesMinor` a salon's
// by plan — all in the one currency.
export async function getPlatformSettings() {
  const { rows } = await pool.query(
    `SELECT price_monthly_minor, price_currency, support_email,
            ${Object.values(SALON_PRICE_COLUMNS).join(', ')}
     FROM platform_settings WHERE id`
  );
  const row = rows[0] ?? {
    price_monthly_minor: 1000,
    price_currency: 'USD',
    support_email: null,
    salon_5_price_minor: 3000,
    salon_10_price_minor: 5000,
    salon_unlimited_price_minor: 8000,
  };
  return {
    priceMonthlyMinor: row.price_monthly_minor,
    priceCurrency: row.price_currency,
    supportEmail: row.support_email,
    salonPricesMinor: Object.fromEntries(
      Object.entries(SALON_PRICE_COLUMNS).map(([plan, column]) => [plan, row[column]])
    ),
  };
}

// What a plan costs a month, in minor units.
export function planPriceMinor(settings, plan) {
  return plan === 'individual' ? settings.priceMonthlyMinor : settings.salonPricesMinor[plan];
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// { priceMonthlyMinor?, priceCurrency?, supportEmail?,
//   salonPricesMinor?: { salon_5?, salon_10?, salon_unlimited? } } from the operator.
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
  for (const [plan, column] of Object.entries(SALON_PRICE_COLUMNS)) {
    const raw = body?.salonPricesMinor?.[plan];
    if (raw === undefined) continue;
    const minor = Number(raw);
    if (!Number.isInteger(minor) || minor < 0 || minor > 100_000_000) return { error: 'invalid_price' };
    values.push(minor);
    sets.push(`${column} = $${values.length}`);
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

export const shorthands = undefined;

// Platform-wide settings the operator edits on their Settings screen, kept in
// a single row (id is always true). The price is what the welcome page shows —
// what a master is actually charged is the Lemon Squeezy product's price, so
// the two are changed together. Stored in minor units (cents) to keep money
// out of floating point. support_email is where the privacy policy tells
// people to write; empty until the operator sets it.
export const up = (pgm) => {
  pgm.createTable('platform_settings', {
    id: { type: 'boolean', primaryKey: true, default: true },
    price_monthly_minor: { type: 'integer', notNull: true, default: 1000 },
    price_currency: { type: 'text', notNull: true, default: 'USD' },
    support_email: { type: 'text' },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('platform_settings', 'platform_settings_single_row', { check: 'id' });
  pgm.addConstraint('platform_settings', 'platform_settings_price_range', {
    check: 'price_monthly_minor BETWEEN 0 AND 100000000',
  });
  pgm.addConstraint('platform_settings', 'platform_settings_currency_code', {
    check: "price_currency ~ '^[A-Z]{3}$'",
  });
  pgm.sql('INSERT INTO platform_settings DEFAULT VALUES');
};

export const down = (pgm) => {
  pgm.dropTable('platform_settings');
};

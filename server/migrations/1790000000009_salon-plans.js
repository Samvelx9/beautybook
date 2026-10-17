export const shorthands = undefined;

// Salons pay by how many masters work there: up to 5, 6–10, 11 and more —
// $30, $50 and $80 a month to start with. The operator edits the advertised
// prices beside the individual one (platform_settings); what is actually
// charged is the Lemon Squeezy variant of each plan, set in the environment.
//
// organizations.ls_variant_id is the variant the organization's subscription
// is on, from Lemon Squeezy's webhooks — what tells the server a salon that
// gained or lost masters has to move to another plan.
export const up = (pgm) => {
  pgm.addColumns('platform_settings', {
    salon_5_price_minor: { type: 'integer', notNull: true, default: 3000 },
    salon_10_price_minor: { type: 'integer', notNull: true, default: 5000 },
    salon_unlimited_price_minor: { type: 'integer', notNull: true, default: 8000 },
  });
  pgm.addConstraint('platform_settings', 'platform_settings_salon_prices_range', {
    check: `salon_5_price_minor BETWEEN 0 AND 100000000
        AND salon_10_price_minor BETWEEN 0 AND 100000000
        AND salon_unlimited_price_minor BETWEEN 0 AND 100000000`,
  });
  pgm.addColumns('organizations', { ls_variant_id: { type: 'text' } });
};

export const down = (pgm) => {
  pgm.dropColumns('organizations', ['ls_variant_id']);
  pgm.dropConstraint('platform_settings', 'platform_settings_salon_prices_range');
  pgm.dropColumns('platform_settings', ['salon_5_price_minor', 'salon_10_price_minor', 'salon_unlimited_price_minor']);
};

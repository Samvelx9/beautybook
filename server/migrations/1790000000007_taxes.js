export const shorthands = undefined;

// The taxes an organization pays on its income — turnover tax, VAT — each a
// percentage of what the client paid for a visit. The owner lists them; a
// master fills in nothing.
//
// Who pays a visit's taxes is decided per master (masters.tax_payer):
//   master — out of the master's share;
//   salon  — out of the salon's share;
//   both   — each on their own part: with a 40/60 split and a 10% tax, the
//            master pays 10% of her 40% and the salon 10% of its 60%.
// The owner's own visits, and an individual master's, are the salon side's.
//
// As with the master's share, the taxes a visit is paid at are copied onto it
// (booking_taxes) when it's completed — the rates and who pays them at that
// moment — so changing a rate later doesn't rewrite what was already earned.
// A trigger does it, however the visit gets completed, and again if a
// completed visit is handed to another master.
export const up = (pgm) => {
  pgm.createTable('taxes', {
    id: 'id',
    organization_id: { type: 'integer', notNull: true, references: 'organizations', onDelete: 'CASCADE' },
    name: { type: 'text', notNull: true },
    // A percentage of what the client paid; VAT included in a price is
    // entered as its share of that price (20% VAT → 16.67).
    rate_percent: { type: 'numeric(5,2)', notNull: true },
    sort_order: { type: 'integer', notNull: true, default: 0 },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('taxes', 'taxes_name', { check: "length(name) BETWEEN 1 AND 100" });
  pgm.addConstraint('taxes', 'taxes_rate_range', { check: 'rate_percent > 0 AND rate_percent <= 100' });
  pgm.createIndex('taxes', 'organization_id');

  pgm.addColumns('masters', {
    tax_payer: { type: 'text', notNull: true, default: 'both' },
  });
  pgm.addConstraint('masters', 'masters_tax_payer', { check: "tax_payer IN ('master', 'salon', 'both')" });

  pgm.createTable('booking_taxes', {
    id: 'id',
    booking_id: { type: 'integer', notNull: true, references: 'bookings', onDelete: 'CASCADE' },
    // The tax it came from, while that still exists; the name and rate are
    // copied, so deleting a tax keeps the history.
    tax_id: { type: 'integer', references: 'taxes', onDelete: 'SET NULL' },
    name: { type: 'text', notNull: true },
    rate_percent: { type: 'numeric(5,2)', notNull: true },
    payer: { type: 'text', notNull: true },
  });
  pgm.addConstraint('booking_taxes', 'booking_taxes_payer', { check: "payer IN ('master', 'salon', 'both')" });
  pgm.createIndex('booking_taxes', 'booking_id');

  // Who pays this master's visits' taxes now: the salon side for the owner's
  // own calendar (a solo master's included), else the master's setting.
  pgm.sql(`
    CREATE FUNCTION current_tax_payer(master integer) RETURNS text
    LANGUAGE sql STABLE AS $$
      SELECT CASE
        WHEN EXISTS (SELECT 1 FROM users u WHERE u.master_id = m.id AND u.role = 'owner') THEN 'salon'
        ELSE m.tax_payer
      END
      FROM masters m WHERE m.id = master
    $$`);

  pgm.sql(`
    CREATE FUNCTION bookings_fix_taxes() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.status = 'completed' AND (
           TG_OP = 'INSERT'
           OR OLD.status IS DISTINCT FROM 'completed'
           OR OLD.master_id IS DISTINCT FROM NEW.master_id) THEN
        DELETE FROM booking_taxes WHERE booking_id = NEW.id;
        INSERT INTO booking_taxes (booking_id, tax_id, name, rate_percent, payer)
        SELECT NEW.id, t.id, t.name, t.rate_percent, COALESCE(current_tax_payer(NEW.master_id), 'salon')
        FROM taxes t WHERE t.organization_id = NEW.organization_id;
      ELSIF TG_OP = 'UPDATE' AND NEW.status <> 'completed' AND OLD.status = 'completed' THEN
        DELETE FROM booking_taxes WHERE booking_id = NEW.id;
      END IF;
      RETURN NULL;
    END
    $$`);
  pgm.sql(`
    CREATE TRIGGER bookings_fix_taxes
      AFTER INSERT OR UPDATE OF status, master_id ON bookings
      FOR EACH ROW EXECUTE FUNCTION bookings_fix_taxes()`);
};

export const down = (pgm) => {
  pgm.sql('DROP TRIGGER bookings_fix_taxes ON bookings');
  pgm.sql('DROP FUNCTION bookings_fix_taxes()');
  pgm.sql('DROP FUNCTION current_tax_payer(integer)');
  pgm.dropTable('booking_taxes');
  pgm.dropConstraint('masters', 'masters_tax_payer');
  pgm.dropColumns('masters', ['tax_payer']);
  pgm.dropTable('taxes');
};

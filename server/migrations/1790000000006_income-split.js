export const shorthands = undefined;

// How a salon shares a visit's income with the master who did it — say 40% to
// the master, 60% to the salon. A salon-wide split, which the owner may
// override for one master; the owner's own visits are all theirs, and so is
// everything an individual master earns.
//
// The split a visit was paid at is kept on the booking, fixed when it's
// marked completed — the moment it became income — the same way a booking
// keeps the price it was booked at: changing the percentage later doesn't
// rewrite what was already earned. A trigger sets it, so it holds however a
// visit gets completed (the admin panel, the master's Telegram button, an
// edit), and again if a completed visit is handed to another master.
export const up = (pgm) => {
  pgm.addColumns('organizations', {
    // The master's share of each visit, in percent.
    master_share_percent: { type: 'integer', notNull: true, default: 40 },
  });
  pgm.addConstraint('organizations', 'organizations_master_share_range', {
    check: 'master_share_percent BETWEEN 0 AND 100',
  });

  pgm.addColumns('masters', {
    // This master's own share, when it differs from the salon's; null follows it.
    share_percent: { type: 'integer' },
  });
  pgm.addConstraint('masters', 'masters_share_range', {
    check: 'share_percent IS NULL OR share_percent BETWEEN 0 AND 100',
  });

  pgm.addColumns('bookings', {
    // The master's share of this visit's income, fixed when it was completed.
    master_share_percent: { type: 'integer', notNull: true, default: 0 },
  });
  pgm.addConstraint('bookings', 'bookings_master_share_range', {
    check: 'master_share_percent BETWEEN 0 AND 100',
  });

  // The share a master gets now: nothing when they're the organization's
  // owner (a solo master always is), else their own share or the salon's.
  pgm.sql(`
    CREATE FUNCTION current_master_share(master integer) RETURNS integer
    LANGUAGE sql STABLE AS $$
      SELECT CASE
        WHEN EXISTS (SELECT 1 FROM users u WHERE u.master_id = m.id AND u.role = 'owner') THEN 0
        ELSE COALESCE(m.share_percent, o.master_share_percent)
      END
      FROM masters m JOIN organizations o ON o.id = m.organization_id
      WHERE m.id = master
    $$`);

  pgm.sql(`
    CREATE FUNCTION bookings_fix_master_share() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.status = 'completed' AND (
           TG_OP = 'INSERT'
           OR OLD.status IS DISTINCT FROM 'completed'
           OR OLD.master_id IS DISTINCT FROM NEW.master_id) THEN
        NEW.master_share_percent := COALESCE(current_master_share(NEW.master_id), 0);
      END IF;
      RETURN NEW;
    END
    $$`);
  pgm.sql(`
    CREATE TRIGGER bookings_fix_master_share
      BEFORE INSERT OR UPDATE OF status, master_id ON bookings
      FOR EACH ROW EXECUTE FUNCTION bookings_fix_master_share()`);

  pgm.sql(`UPDATE bookings SET master_share_percent = COALESCE(current_master_share(master_id), 0)
            WHERE status = 'completed'`);
};

export const down = (pgm) => {
  pgm.sql('DROP TRIGGER bookings_fix_master_share ON bookings');
  pgm.sql('DROP FUNCTION bookings_fix_master_share()');
  pgm.sql('DROP FUNCTION current_master_share(integer)');
  pgm.dropConstraint('bookings', 'bookings_master_share_range');
  pgm.dropColumns('bookings', ['master_share_percent']);
  pgm.dropConstraint('masters', 'masters_share_range');
  pgm.dropColumns('masters', ['share_percent']);
  pgm.dropConstraint('organizations', 'organizations_master_share_range');
  pgm.dropColumns('organizations', ['master_share_percent']);
};

export const shorthands = undefined;

// Salons. Until now one account was one master; now every master belongs to
// an organization — the business a subscription pays for. An individual
// master is an organization of one (`kind = 'solo'`); a salon has several
// masters and an owner who runs it, who may be one of the masters or not.
//
// What moves to the organization:
// - Billing and suspension. A salon pays once for all its masters, and a
//   salon that stops paying closes every one of its masters' pages at once.
// - The price list. A salon has one shared list of treatments and prices;
//   each master keeps their own calendar, hours and days off.
//
// The database keeps the same line it always has, one level up: a booking's
// zones can only be services of the booking's own organization, and its master
// must belong to that organization (composite foreign keys, as before).
//
// Every existing master gets a solo organization with the same id, so the
// subscription that already names a master (Lemon Squeezy's custom data
// carries master_id) still finds its organization.
export const up = (pgm) => {
  pgm.createTable('organizations', {
    id: 'id',
    kind: { type: 'text', notNull: true, default: 'solo' },
    // The salon's name; blank for a solo master, whose name is on their profile.
    name: { type: 'text', notNull: true, default: '' },

    trial_ends_at: { type: 'timestamptz', notNull: true },
    subscription_status: { type: 'text' },
    ls_subscription_id: { type: 'text', unique: true },
    ls_customer_id: { type: 'text' },
    period_ends_at: { type: 'timestamptz' },
    customer_portal_url: { type: 'text' },
    suspended_at: { type: 'timestamptz' },

    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('organizations', 'organizations_kind', { check: "kind IN ('solo', 'salon')" });

  pgm.sql(`
    INSERT INTO organizations (id, kind, trial_ends_at, subscription_status, ls_subscription_id,
                               ls_customer_id, period_ends_at, customer_portal_url, suspended_at,
                               created_at)
    SELECT id, 'solo', trial_ends_at, subscription_status, ls_subscription_id, ls_customer_id,
           period_ends_at, customer_portal_url, suspended_at, created_at
    FROM masters`);
  pgm.sql(`SELECT setval(pg_get_serial_sequence('organizations', 'id'),
                         GREATEST((SELECT MAX(id) FROM organizations), 1),
                         (SELECT MAX(id) FROM organizations) IS NOT NULL)`);

  // -------------------------------------------------------------------------
  // Masters belong to an organization; billing leaves them
  // -------------------------------------------------------------------------

  pgm.addColumns('masters', {
    organization_id: { type: 'integer', references: 'organizations', onDelete: 'CASCADE' },
  });
  pgm.sql('UPDATE masters SET organization_id = id');
  pgm.alterColumn('masters', 'organization_id', { notNull: true });
  pgm.addConstraint('masters', 'masters_id_organization', { unique: ['id', 'organization_id'] });
  pgm.createIndex('masters', 'organization_id');
  pgm.dropColumns('masters', [
    'trial_ends_at', 'subscription_status', 'ls_subscription_id', 'ls_customer_id',
    'period_ends_at', 'customer_portal_url', 'suspended_at',
  ]);

  // -------------------------------------------------------------------------
  // Logins: who in the organization they are
  // -------------------------------------------------------------------------

  // `owner` runs the organization (billing, the price list, every master's
  // calendar) and has a calendar of their own when `master_id` is set — a
  // solo master is always one. `master` is a salon's master: their own
  // calendar only. A platform operator with no booking page has neither.
  pgm.addColumns('users', {
    organization_id: { type: 'integer', references: 'organizations', onDelete: 'CASCADE' },
    role: { type: 'text' },
  });
  pgm.sql(`UPDATE users u SET organization_id = m.organization_id, role = 'owner'
             FROM masters m WHERE m.id = u.master_id`);
  pgm.addConstraint('users', 'users_role', {
    check: `(role IS NULL AND organization_id IS NULL AND master_id IS NULL)
            OR (role = 'owner' AND organization_id IS NOT NULL)
            OR (role = 'master' AND organization_id IS NOT NULL AND master_id IS NOT NULL)`,
  });
  // A login's calendar is one of its own organization's masters.
  pgm.addConstraint('users', 'users_master_same_organization', {
    foreignKeys: {
      columns: ['master_id', 'organization_id'],
      references: 'masters(id, organization_id)',
      onDelete: 'CASCADE',
    },
  });
  pgm.createIndex('users', 'organization_id');

  // -------------------------------------------------------------------------
  // The price list belongs to the organization
  // -------------------------------------------------------------------------

  pgm.addColumns('service_categories', { organization_id: { type: 'integer' } });
  pgm.addColumns('services', { organization_id: { type: 'integer' } });
  pgm.sql('UPDATE service_categories c SET organization_id = m.organization_id FROM masters m WHERE m.id = c.master_id');
  pgm.sql('UPDATE services s SET organization_id = m.organization_id FROM masters m WHERE m.id = s.master_id');
  // (alterColumn ignores `references`, so the foreign keys are added on their own.)
  for (const table of ['service_categories', 'services']) {
    pgm.alterColumn(table, 'organization_id', { notNull: true });
    pgm.addConstraint(table, `${table}_organization_id_fkey`, {
      foreignKeys: { columns: 'organization_id', references: 'organizations', onDelete: 'CASCADE' },
    });
  }

  // What used to tie them to a master, rebuilt on the organization.
  pgm.dropConstraint('booking_items', 'booking_items_service_same_master');
  pgm.dropConstraint('services', 'services_category_same_master');
  pgm.dropConstraint('services', 'services_slug_per_master');
  pgm.dropConstraint('services', 'services_id_master');
  pgm.dropConstraint('service_categories', 'service_categories_slug_per_master');
  pgm.dropConstraint('service_categories', 'service_categories_id_master');
  pgm.dropIndex('services', ['master_id', 'category_id']);
  pgm.dropColumns('services', ['master_id']);
  pgm.dropColumns('service_categories', ['master_id']);

  pgm.addConstraint('service_categories', 'service_categories_slug_per_organization', {
    unique: ['organization_id', 'slug'],
  });
  pgm.addConstraint('service_categories', 'service_categories_id_organization', {
    unique: ['id', 'organization_id'],
  });
  pgm.addConstraint('services', 'services_category_same_organization', {
    foreignKeys: {
      columns: ['category_id', 'organization_id'],
      references: 'service_categories(id, organization_id)',
      onDelete: 'RESTRICT',
    },
  });
  pgm.addConstraint('services', 'services_slug_per_organization', { unique: ['organization_id', 'slug'] });
  pgm.addConstraint('services', 'services_id_organization', { unique: ['id', 'organization_id'] });
  pgm.createIndex('services', ['organization_id', 'category_id']);

  // -------------------------------------------------------------------------
  // Bookings: the master's calendar, the organization's price list
  // -------------------------------------------------------------------------

  pgm.addColumns('bookings', { organization_id: { type: 'integer' } });
  pgm.addColumns('booking_items', { organization_id: { type: 'integer' } });
  pgm.sql('UPDATE bookings b SET organization_id = m.organization_id FROM masters m WHERE m.id = b.master_id');
  pgm.sql('UPDATE booking_items i SET organization_id = m.organization_id FROM masters m WHERE m.id = i.master_id');
  pgm.alterColumn('bookings', 'organization_id', { notNull: true });
  pgm.alterColumn('booking_items', 'organization_id', { notNull: true });

  pgm.addConstraint('bookings', 'bookings_master_same_organization', {
    foreignKeys: {
      columns: ['master_id', 'organization_id'],
      references: 'masters(id, organization_id)',
      onDelete: 'CASCADE',
    },
  });
  pgm.addConstraint('bookings', 'bookings_id_organization', { unique: ['id', 'organization_id'] });
  pgm.addConstraint('booking_items', 'booking_items_booking_same_organization', {
    foreignKeys: {
      columns: ['booking_id', 'organization_id'],
      references: 'bookings(id, organization_id)',
      onDelete: 'CASCADE',
    },
  });
  pgm.addConstraint('booking_items', 'booking_items_service_same_organization', {
    foreignKeys: {
      columns: ['service_id', 'organization_id'],
      references: 'services(id, organization_id)',
      onDelete: 'RESTRICT',
    },
  });

  // -------------------------------------------------------------------------
  // Billing events name the organization
  // -------------------------------------------------------------------------

  pgm.renameColumn('billing_events', 'master_id', 'organization_id');
  pgm.dropConstraint('billing_events', 'billing_events_master_id_fkey');
  pgm.addConstraint('billing_events', 'billing_events_organization_id_fkey', {
    foreignKeys: { columns: 'organization_id', references: 'organizations', onDelete: 'SET NULL' },
  });
};

// Only while every organization is still a solo one with its master's id —
// the shape `up` left it in. A salon can't be folded back into one master.
export const down = (pgm) => {
  pgm.sql(`DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM organizations o
               WHERE o.kind <> 'solo'
                  OR (SELECT COUNT(*) FROM masters m WHERE m.organization_id = o.id) <> 1
                  OR NOT EXISTS (SELECT 1 FROM masters m WHERE m.id = o.id AND m.organization_id = o.id)) THEN
      RAISE EXCEPTION 'organizations other than one-master solo ones exist; cannot migrate down';
    END IF;
  END $$`);

  pgm.dropConstraint('billing_events', 'billing_events_organization_id_fkey');
  pgm.renameColumn('billing_events', 'organization_id', 'master_id');
  pgm.addConstraint('billing_events', 'billing_events_master_id_fkey', {
    foreignKeys: { columns: 'master_id', references: 'masters', onDelete: 'SET NULL' },
  });

  pgm.dropConstraint('booking_items', 'booking_items_service_same_organization');
  pgm.dropConstraint('booking_items', 'booking_items_booking_same_organization');
  pgm.dropConstraint('bookings', 'bookings_id_organization');
  pgm.dropConstraint('bookings', 'bookings_master_same_organization');
  pgm.dropColumns('booking_items', ['organization_id']);
  pgm.dropColumns('bookings', ['organization_id']);

  pgm.addColumns('service_categories', { master_id: { type: 'integer' } });
  pgm.addColumns('services', { master_id: { type: 'integer' } });
  pgm.sql('UPDATE service_categories SET master_id = organization_id');
  pgm.sql('UPDATE services SET master_id = organization_id');
  pgm.dropIndex('services', ['organization_id', 'category_id']);
  pgm.dropConstraint('services', 'services_id_organization');
  pgm.dropConstraint('services', 'services_slug_per_organization');
  pgm.dropConstraint('services', 'services_category_same_organization');
  pgm.dropConstraint('service_categories', 'service_categories_id_organization');
  pgm.dropConstraint('service_categories', 'service_categories_slug_per_organization');
  pgm.dropColumns('services', ['organization_id']);
  pgm.dropColumns('service_categories', ['organization_id']);
  for (const table of ['service_categories', 'services']) {
    pgm.alterColumn(table, 'master_id', { notNull: true });
    pgm.addConstraint(table, `${table}_master_id_fkey`, {
      foreignKeys: { columns: 'master_id', references: 'masters', onDelete: 'CASCADE' },
    });
  }
  pgm.addConstraint('service_categories', 'service_categories_slug_per_master', { unique: ['master_id', 'slug'] });
  pgm.addConstraint('service_categories', 'service_categories_id_master', { unique: ['id', 'master_id'] });
  pgm.addConstraint('services', 'services_category_same_master', {
    foreignKeys: {
      columns: ['category_id', 'master_id'],
      references: 'service_categories(id, master_id)',
      onDelete: 'RESTRICT',
    },
  });
  pgm.addConstraint('services', 'services_slug_per_master', { unique: ['master_id', 'slug'] });
  pgm.addConstraint('services', 'services_id_master', { unique: ['id', 'master_id'] });
  pgm.createIndex('services', ['master_id', 'category_id']);
  pgm.addConstraint('booking_items', 'booking_items_service_same_master', {
    foreignKeys: {
      columns: ['service_id', 'master_id'],
      references: 'services(id, master_id)',
      onDelete: 'RESTRICT',
    },
  });

  pgm.dropIndex('users', 'organization_id');
  pgm.dropConstraint('users', 'users_master_same_organization');
  pgm.dropConstraint('users', 'users_role');
  pgm.dropColumns('users', ['organization_id', 'role']);

  pgm.addColumns('masters', {
    trial_ends_at: { type: 'timestamptz' },
    subscription_status: { type: 'text' },
    ls_subscription_id: { type: 'text', unique: true },
    ls_customer_id: { type: 'text' },
    period_ends_at: { type: 'timestamptz' },
    customer_portal_url: { type: 'text' },
    suspended_at: { type: 'timestamptz' },
  });
  pgm.sql(`UPDATE masters m SET trial_ends_at = o.trial_ends_at, subscription_status = o.subscription_status,
             ls_subscription_id = o.ls_subscription_id, ls_customer_id = o.ls_customer_id,
             period_ends_at = o.period_ends_at, customer_portal_url = o.customer_portal_url,
             suspended_at = o.suspended_at
           FROM organizations o WHERE o.id = m.organization_id`);
  pgm.alterColumn('masters', 'trial_ends_at', { notNull: true });
  pgm.dropIndex('masters', 'organization_id');
  pgm.dropConstraint('masters', 'masters_id_organization');
  pgm.dropColumns('masters', ['organization_id']);
  pgm.dropTable('organizations');
};

export const shorthands = undefined;

// What a salon needs beyond phase 1's organizations:
//
// - Who does what. A salon shares one price list, but its nail master doesn't
//   do haircuts: `master_services` lists the services each master performs.
//   A master's page offers only those, and "any available master" picks among
//   the masters who perform everything the guest chose. Every existing master
//   performs their whole list, as before.
// - Masters leave. A deactivated master keeps their bookings and history but
//   can't log in, and their page takes no bookings.
// - One locale per salon. The prices are shared, so the currency must be; the
//   timezone and languages are the salon's too. They live on the organization
//   and are copied onto each master, whose page and messages read them there.
// - The owner's own Telegram chat, told about every booking in the salon.
// - Expenses are the business's (rent, supplies), so the organization's.
// - A booking can move to another master of the same salon.
export const up = (pgm) => {
  pgm.addColumns('organizations', {
    timezone: { type: 'text', notNull: true, default: 'Asia/Yerevan' },
    currency: { type: 'text', notNull: true, default: 'AMD' },
    languages: { type: 'text[]', notNull: true, default: pgm.func("'{hy,ru,en}'") },
    default_lang: { type: 'text', notNull: true, default: 'hy' },
    notify_lang: { type: 'text', notNull: true, default: 'ru' },
    telegram_chat_id: { type: 'bigint' },
    telegram_connect_token: { type: 'text', unique: true },
  });
  pgm.sql(`UPDATE organizations o SET timezone = m.timezone, currency = m.currency,
             languages = m.languages, default_lang = m.default_lang, notify_lang = m.notify_lang
           FROM masters m WHERE m.organization_id = o.id`);
  pgm.addConstraint('organizations', 'organizations_default_lang', {
    check: "default_lang IN ('hy', 'ru', 'en') AND default_lang = ANY(languages)",
  });
  pgm.addConstraint('organizations', 'organizations_notify_lang', {
    check: "notify_lang IN ('hy', 'ru', 'en')",
  });
  pgm.addConstraint('organizations', 'organizations_languages', {
    check: "languages <@ ARRAY['hy', 'ru', 'en'] AND cardinality(languages) > 0",
  });
  pgm.addConstraint('organizations', 'organizations_currency', { check: "currency ~ '^[A-Z]{3}$'" });

  pgm.addColumns('masters', { deactivated_at: { type: 'timestamptz' } });

  pgm.createTable('master_services', {
    organization_id: { type: 'integer', notNull: true },
    master_id: { type: 'integer', notNull: true },
    service_id: { type: 'integer', notNull: true },
  });
  pgm.addConstraint('master_services', 'master_services_pkey', {
    primaryKey: ['master_id', 'service_id'],
  });
  pgm.addConstraint('master_services', 'master_services_master_same_organization', {
    foreignKeys: {
      columns: ['master_id', 'organization_id'],
      references: 'masters(id, organization_id)',
      onDelete: 'CASCADE',
    },
  });
  pgm.addConstraint('master_services', 'master_services_service_same_organization', {
    foreignKeys: {
      columns: ['service_id', 'organization_id'],
      references: 'services(id, organization_id)',
      onDelete: 'CASCADE',
    },
  });
  pgm.createIndex('master_services', 'service_id');
  pgm.sql(`INSERT INTO master_services (organization_id, master_id, service_id)
           SELECT m.organization_id, m.id, s.id
           FROM masters m JOIN services s ON s.organization_id = m.organization_id`);

  // A salon's owner moves a visit from one master to another; its zones follow
  // the booking rather than block the move.
  pgm.dropConstraint('booking_items', 'booking_items_booking_same_master');
  pgm.addConstraint('booking_items', 'booking_items_booking_same_master', {
    foreignKeys: {
      columns: ['booking_id', 'master_id'],
      references: 'bookings(id, master_id)',
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
  });

  pgm.addColumns('expenses', {
    organization_id: { type: 'integer' },
  });
  pgm.sql('UPDATE expenses e SET organization_id = m.organization_id FROM masters m WHERE m.id = e.master_id');
  pgm.alterColumn('expenses', 'organization_id', { notNull: true });
  pgm.addConstraint('expenses', 'expenses_organization_id_fkey', {
    foreignKeys: { columns: 'organization_id', references: 'organizations', onDelete: 'CASCADE' },
  });
  pgm.dropIndex('expenses', ['master_id', 'date']);
  pgm.dropColumns('expenses', ['master_id']);
  pgm.createIndex('expenses', ['organization_id', 'date']);
};

// Only while every organization is one master: expenses go back to it.
export const down = (pgm) => {
  pgm.sql(`DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM organizations o
               WHERE (SELECT COUNT(*) FROM masters m WHERE m.organization_id = o.id) <> 1) THEN
      RAISE EXCEPTION 'organizations with other than one master exist; cannot migrate down';
    END IF;
  END $$`);

  pgm.addColumns('expenses', { master_id: { type: 'integer' } });
  pgm.sql('UPDATE expenses e SET master_id = m.id FROM masters m WHERE m.organization_id = e.organization_id');
  pgm.alterColumn('expenses', 'master_id', { notNull: true });
  pgm.addConstraint('expenses', 'expenses_master_id_fkey', {
    foreignKeys: { columns: 'master_id', references: 'masters', onDelete: 'CASCADE' },
  });
  pgm.dropIndex('expenses', ['organization_id', 'date']);
  pgm.dropColumns('expenses', ['organization_id']);
  pgm.createIndex('expenses', ['master_id', 'date']);

  pgm.dropConstraint('booking_items', 'booking_items_booking_same_master');
  pgm.addConstraint('booking_items', 'booking_items_booking_same_master', {
    foreignKeys: {
      columns: ['booking_id', 'master_id'],
      references: 'bookings(id, master_id)',
      onDelete: 'CASCADE',
    },
  });

  pgm.dropTable('master_services');
  pgm.dropColumns('masters', ['deactivated_at']);
  pgm.dropConstraint('organizations', 'organizations_currency');
  pgm.dropConstraint('organizations', 'organizations_languages');
  pgm.dropConstraint('organizations', 'organizations_notify_lang');
  pgm.dropConstraint('organizations', 'organizations_default_lang');
  pgm.dropColumns('organizations', [
    'timezone', 'currency', 'languages', 'default_lang', 'notify_lang',
    'telegram_chat_id', 'telegram_connect_token',
  ]);
};

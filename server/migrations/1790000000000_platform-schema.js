export const shorthands = undefined;

// The whole platform schema in one step. Every master (a tenant: one beauty
// professional with their own booking page) owns rows in every table through
// `master_id`, and nothing a query does may cross that line.
//
// The application scopes every query by master, but the database backs it up
// where a slip would do real damage: a service can only sit in its own
// master's treatment, a booking item can only point at a service of the same
// master as its booking — both through composite foreign keys on
// (id, master_id) — and the no-double-booking rule is per master, so two
// masters' appointments at the same hour don't collide.
export const up = (pgm) => {
  pgm.createExtension('btree_gist', { ifNotExists: true });

  // -------------------------------------------------------------------------
  // Masters and their logins
  // -------------------------------------------------------------------------

  pgm.createTable('masters', {
    id: 'id',
    // The booking page lives at <slug>.<PLATFORM_DOMAIN>.
    slug: { type: 'text', notNull: true, unique: true },
    // Optional own domain (e.g. "annabeauty.com") pointed at the platform.
    custom_domain: { type: 'text', unique: true },

    timezone: { type: 'text', notNull: true, default: 'Asia/Yerevan' },
    currency: { type: 'text', notNull: true, default: 'AMD' },
    // Which languages the guest page offers, and which it opens in.
    languages: { type: 'text[]', notNull: true, default: pgm.func("'{hy,ru,en}'") },
    default_lang: { type: 'text', notNull: true, default: 'hy' },
    // The language of the master's own Telegram notifications.
    notify_lang: { type: 'text', notNull: true, default: 'ru' },

    // The chat the platform bot sends this master's notifications to, linked
    // by the master pressing Start on `t.me/<bot>?start=m_<connect token>`.
    telegram_chat_id: { type: 'bigint' },
    telegram_connect_token: { type: 'text', unique: true },

    // Billing. Access to the public booking page is decided from these by
    // services/billing.js → hasAccess(). `subscription_status` is Lemon
    // Squeezy's own vocabulary (on_trial, active, paused, past_due, unpaid,
    // cancelled, expired); null until the master first subscribes.
    trial_ends_at: { type: 'timestamptz', notNull: true },
    subscription_status: { type: 'text' },
    ls_subscription_id: { type: 'text', unique: true },
    ls_customer_id: { type: 'text' },
    // When a cancelled subscription stops giving access, or the next renewal.
    period_ends_at: { type: 'timestamptz' },
    customer_portal_url: { type: 'text' },

    // Set by a platform admin to switch a master off regardless of billing.
    suspended_at: { type: 'timestamptz' },

    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('masters', 'masters_slug_format', {
    check: "slug ~ '^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$'",
  });
  pgm.addConstraint('masters', 'masters_default_lang', {
    check: "default_lang IN ('hy', 'ru', 'en') AND default_lang = ANY(languages)",
  });
  pgm.addConstraint('masters', 'masters_notify_lang', {
    check: "notify_lang IN ('hy', 'ru', 'en')",
  });
  pgm.addConstraint('masters', 'masters_languages', {
    check: "languages <@ ARRAY['hy', 'ru', 'en'] AND cardinality(languages) > 0",
  });
  pgm.addConstraint('masters', 'masters_currency', { check: "currency ~ '^[A-Z]{3}$'" });

  pgm.createTable('users', {
    id: 'id',
    // Null only for a platform operator who has no booking page of their own.
    master_id: { type: 'integer', references: 'masters', onDelete: 'CASCADE' },
    email: { type: 'text', notNull: true },
    password_hash: { type: 'text', notNull: true },
    is_platform_admin: { type: 'boolean', notNull: true, default: false },
    // Bumped on a password change; tokens carry it, so old sessions end.
    token_version: { type: 'integer', notNull: true, default: 0 },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('users', 'lower(email)', { unique: true, name: 'users_email_unique' });
  pgm.createIndex('users', 'master_id');

  // -------------------------------------------------------------------------
  // The landing page
  // -------------------------------------------------------------------------

  pgm.createTable('salon_profile', {
    master_id: { type: 'integer', primaryKey: true, references: 'masters', onDelete: 'CASCADE' },

    owner_name_en: { type: 'text', notNull: true, default: '' },
    owner_name_ru: { type: 'text', notNull: true, default: '' },
    owner_name_hy: { type: 'text', notNull: true, default: '' },
    tagline_en: { type: 'text', notNull: true, default: '' },
    tagline_ru: { type: 'text', notNull: true, default: '' },
    tagline_hy: { type: 'text', notNull: true, default: '' },
    about_en: { type: 'text', notNull: true, default: '' },
    about_ru: { type: 'text', notNull: true, default: '' },
    about_hy: { type: 'text', notNull: true, default: '' },
    address_en: { type: 'text', notNull: true, default: '' },
    address_ru: { type: 'text', notNull: true, default: '' },
    address_hy: { type: 'text', notNull: true, default: '' },
    map_url: { type: 'text', notNull: true, default: '' },
    phone: { type: 'text', notNull: true, default: '' },
    whatsapp: { type: 'text', notNull: true, default: '' },
    telegram: { type: 'text', notNull: true, default: '' },
    instagram: { type: 'text', notNull: true, default: '' },
    email: { type: 'text', notNull: true, default: '' },

    // In the database rather than on disk: the API container has no volume.
    photo_mime: { type: 'text' },
    photo_data: { type: 'bytea' },
    photo_updated_at: { type: 'timestamptz' },

    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  // -------------------------------------------------------------------------
  // Treatments and their zones (the price list)
  // -------------------------------------------------------------------------

  // A name may be given in any of the master's languages — a master who only
  // works in Russian fills in only Russian — but in at least one.
  const someName = "name_en <> '' OR name_ru <> '' OR name_hy <> ''";

  pgm.createTable('service_categories', {
    id: 'id',
    master_id: { type: 'integer', notNull: true, references: 'masters', onDelete: 'CASCADE' },
    slug: { type: 'text', notNull: true },
    name_en: { type: 'text', notNull: true, default: '' },
    name_ru: { type: 'text', notNull: true, default: '' },
    name_hy: { type: 'text', notNull: true, default: '' },
    description_en: { type: 'text', notNull: true, default: '' },
    description_ru: { type: 'text', notNull: true, default: '' },
    description_hy: { type: 'text', notNull: true, default: '' },
    sort_order: { type: 'integer', notNull: true, default: 0 },
    is_active: { type: 'boolean', notNull: true, default: true },
    // For an hourly treatment a zone's price is its hourly rate and the guest
    // chooses how long to book.
    is_hourly: { type: 'boolean', notNull: true, default: false },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('service_categories', 'service_categories_slug_per_master', {
    unique: ['master_id', 'slug'],
  });
  pgm.addConstraint('service_categories', 'service_categories_id_master', {
    unique: ['id', 'master_id'],
  });
  pgm.addConstraint('service_categories', 'service_categories_some_name', { check: someName });

  pgm.createTable('services', {
    id: 'id',
    master_id: { type: 'integer', notNull: true, references: 'masters', onDelete: 'CASCADE' },
    category_id: { type: 'integer', notNull: true },
    slug: { type: 'text', notNull: true },
    name_en: { type: 'text', notNull: true, default: '' },
    name_ru: { type: 'text', notNull: true, default: '' },
    name_hy: { type: 'text', notNull: true, default: '' },
    duration_minutes: { type: 'integer', notNull: true },
    // Whole units of the master's currency.
    price: { type: 'integer', notNull: true },
    sort_order: { type: 'integer', notNull: true, default: 0 },
    is_active: { type: 'boolean', notNull: true, default: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('services', 'services_category_same_master', {
    foreignKeys: {
      columns: ['category_id', 'master_id'],
      references: 'service_categories(id, master_id)',
      onDelete: 'RESTRICT',
    },
  });
  pgm.addConstraint('services', 'services_slug_per_master', { unique: ['master_id', 'slug'] });
  pgm.addConstraint('services', 'services_id_master', { unique: ['id', 'master_id'] });
  pgm.addConstraint('services', 'services_some_name', { check: someName });
  pgm.addConstraint('services', 'services_duration_positive', { check: 'duration_minutes > 0' });
  pgm.addConstraint('services', 'services_price_non_negative', { check: 'price >= 0' });
  pgm.createIndex('services', ['master_id', 'category_id']);

  // -------------------------------------------------------------------------
  // Working hours
  // -------------------------------------------------------------------------

  // One row per weekday per master (0 = Sunday .. 6 = Saturday), seeded at
  // sign-up. Times are wall-clock times in the master's own timezone.
  pgm.createTable('weekly_hours', {
    master_id: { type: 'integer', notNull: true, references: 'masters', onDelete: 'CASCADE' },
    day_of_week: { type: 'smallint', notNull: true },
    is_open: { type: 'boolean', notNull: true, default: true },
    start_time: { type: 'time' },
    end_time: { type: 'time' },
    lunch_start: { type: 'time' },
    lunch_end: { type: 'time' },
  });
  pgm.addConstraint('weekly_hours', 'weekly_hours_pkey', {
    primaryKey: ['master_id', 'day_of_week'],
  });
  pgm.addConstraint('weekly_hours', 'weekly_hours_day_of_week_range', {
    check: 'day_of_week BETWEEN 0 AND 6',
  });
  pgm.addConstraint('weekly_hours', 'weekly_hours_time_order', {
    check: 'NOT is_open OR (start_time IS NOT NULL AND end_time IS NOT NULL AND start_time < end_time)',
  });
  pgm.addConstraint('weekly_hours', 'weekly_hours_lunch_pair', {
    check: '(lunch_start IS NULL AND lunch_end IS NULL) OR (lunch_start IS NOT NULL AND lunch_end IS NOT NULL AND lunch_start < lunch_end)',
  });
  pgm.addConstraint('weekly_hours', 'weekly_hours_lunch_within_day', {
    check: 'lunch_start IS NULL OR (is_open AND lunch_start >= start_time AND lunch_end <= end_time)',
  });

  // A whole day off (both times null) or a window within a day.
  pgm.createTable('availability_blocks', {
    id: 'id',
    master_id: { type: 'integer', notNull: true, references: 'masters', onDelete: 'CASCADE' },
    date: { type: 'date', notNull: true },
    start_time: { type: 'time' },
    end_time: { type: 'time' },
    note: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('availability_blocks', 'availability_blocks_time_order', {
    check: '(start_time IS NULL AND end_time IS NULL) OR (start_time IS NOT NULL AND end_time IS NOT NULL AND start_time < end_time)',
  });
  pgm.createIndex('availability_blocks', ['master_id', 'date']);

  // -------------------------------------------------------------------------
  // Bookings
  // -------------------------------------------------------------------------

  pgm.createType('booking_status', ['confirmed', 'completed', 'cancelled', 'no_show']);

  pgm.createTable('bookings', {
    id: 'id',
    master_id: { type: 'integer', notNull: true, references: 'masters', onDelete: 'CASCADE' },
    start_time: { type: 'timestamptz', notNull: true },
    end_time: { type: 'timestamptz', notNull: true },
    customer_name: { type: 'text', notNull: true },
    customer_phone: { type: 'text', notNull: true },
    status: { type: 'booking_status', notNull: true, default: 'confirmed' },
    // The whole visit's price when it was booked, so re-pricing a zone later
    // doesn't rewrite what a client paid.
    price_at_booking: { type: 'integer', notNull: true },
    // A random id the guest page sends with one set of choices, so a repeat
    // of a booking whose answer was lost returns that booking.
    request_key: { type: 'text', unique: true },
    // The guest's secret: it names the booking in the calendar-file URL, the
    // Telegram link and the manage link, and proves a request comes from the
    // guest who booked.
    guest_token: { type: 'text', unique: true },
    guest_lang: { type: 'text' },
    guest_chat_id: { type: 'bigint' },
    guest_linked_at: { type: 'timestamptz' },
    day_reminder_for: { type: 'timestamptz' },
    soon_reminder_for: { type: 'timestamptz' },
    guest_confirmed_at: { type: 'timestamptz' },
    // When the master was asked on Telegram whether the visit happened.
    completion_asked_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('bookings', 'bookings_time_order', { check: 'start_time < end_time' });
  pgm.addConstraint('bookings', 'bookings_guest_lang', {
    check: "guest_lang IN ('hy', 'ru', 'en')",
  });
  pgm.addConstraint('bookings', 'bookings_id_master', { unique: ['id', 'master_id'] });
  // One master can't be in two places at once; two masters can.
  pgm.addConstraint('bookings', 'bookings_no_overlap', {
    exclude:
      "USING gist (master_id WITH =, tstzrange(start_time, end_time, '[)') WITH &&) WHERE (status <> 'cancelled')",
  });
  pgm.createIndex('bookings', ['master_id', 'start_time']);
  pgm.createIndex('bookings', ['master_id', 'customer_phone']);
  pgm.createIndex('bookings', 'guest_chat_id', { where: 'guest_chat_id IS NOT NULL' });

  // The zones a visit covers, each with its own price and length as booked.
  pgm.createTable('booking_items', {
    id: 'id',
    booking_id: { type: 'integer', notNull: true },
    master_id: { type: 'integer', notNull: true },
    service_id: { type: 'integer', notNull: true },
    duration_minutes: { type: 'integer', notNull: true },
    price_at_booking: { type: 'integer', notNull: true },
    sort_order: { type: 'integer', notNull: true, default: 0 },
  });
  pgm.addConstraint('booking_items', 'booking_items_booking_same_master', {
    foreignKeys: {
      columns: ['booking_id', 'master_id'],
      references: 'bookings(id, master_id)',
      onDelete: 'CASCADE',
    },
  });
  pgm.addConstraint('booking_items', 'booking_items_service_same_master', {
    foreignKeys: {
      columns: ['service_id', 'master_id'],
      references: 'services(id, master_id)',
      onDelete: 'RESTRICT',
    },
  });
  pgm.addConstraint('booking_items', 'booking_items_duration_positive', {
    check: 'duration_minutes > 0',
  });
  pgm.addConstraint('booking_items', 'booking_items_price_non_negative', {
    check: 'price_at_booking >= 0',
  });
  pgm.createIndex('booking_items', 'booking_id');
  pgm.createIndex('booking_items', 'service_id');

  // -------------------------------------------------------------------------
  // Expenses
  // -------------------------------------------------------------------------

  pgm.createTable('expenses', {
    id: 'id',
    master_id: { type: 'integer', notNull: true, references: 'masters', onDelete: 'CASCADE' },
    category: { type: 'text', notNull: true },
    description: { type: 'text' },
    amount: { type: 'integer', notNull: true },
    date: { type: 'date', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('expenses', 'expenses_amount_positive', { check: 'amount > 0' });
  pgm.createIndex('expenses', ['master_id', 'date']);

  // -------------------------------------------------------------------------
  // Billing events, kept so a replayed webhook is recognised and so there is
  // a trail when a master asks why their page closed.
  // -------------------------------------------------------------------------

  pgm.createTable('billing_events', {
    id: 'id',
    master_id: { type: 'integer', references: 'masters', onDelete: 'SET NULL' },
    event_name: { type: 'text', notNull: true },
    payload: { type: 'jsonb', notNull: true },
    received_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('billing_events', 'master_id');
};

export const down = (pgm) => {
  pgm.dropTable('billing_events');
  pgm.dropTable('expenses');
  pgm.dropTable('booking_items');
  pgm.dropTable('bookings');
  pgm.dropType('booking_status');
  pgm.dropTable('availability_blocks');
  pgm.dropTable('weekly_hours');
  pgm.dropTable('services');
  pgm.dropTable('service_categories');
  pgm.dropTable('salon_profile');
  pgm.dropTable('users');
  pgm.dropTable('masters');
};

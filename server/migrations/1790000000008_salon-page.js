export const shorthands = undefined;

// A salon's own booking page, at <salon slug>.<PLATFORM_DOMAIN>: its landing
// page, its masters, and booking with one of them or with whichever is free.
//
// - organizations.slug: the salon page's address. Salon and master addresses
//   are one namespace — both are subdomains of the platform — so a trigger on
//   each table refuses an address the other already has, as a unique
//   violation named `slug_taken`, like a duplicate within one table.
// - organization_profile: the salon's landing page, the same fields as a
//   master's (salon_profile), keyed by the organization.
export const up = (pgm) => {
  pgm.addColumns('organizations', { slug: { type: 'text', unique: true } });
  pgm.addConstraint('organizations', 'organizations_slug_format', {
    check: "slug IS NULL OR slug ~ '^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$'",
  });

  pgm.sql(`
    CREATE FUNCTION slug_free_across_pages() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.slug IS NOT NULL AND (
           (TG_TABLE_NAME = 'masters' AND EXISTS (SELECT 1 FROM organizations WHERE slug = NEW.slug))
        OR (TG_TABLE_NAME = 'organizations' AND EXISTS (SELECT 1 FROM masters WHERE slug = NEW.slug))) THEN
        RAISE EXCEPTION 'page address % is taken', NEW.slug
          USING ERRCODE = 'unique_violation', CONSTRAINT = 'slug_taken';
      END IF;
      RETURN NEW;
    END
    $$`);
  pgm.sql(`CREATE TRIGGER masters_slug_free BEFORE INSERT OR UPDATE OF slug ON masters
             FOR EACH ROW EXECUTE FUNCTION slug_free_across_pages()`);
  pgm.sql(`CREATE TRIGGER organizations_slug_free BEFORE INSERT OR UPDATE OF slug ON organizations
             FOR EACH ROW EXECUTE FUNCTION slug_free_across_pages()`);

  pgm.sql('CREATE TABLE organization_profile (LIKE salon_profile INCLUDING DEFAULTS)');
  pgm.dropColumns('organization_profile', ['master_id']);
  pgm.addColumns('organization_profile', {
    organization_id: { type: 'integer', primaryKey: true, references: 'organizations', onDelete: 'CASCADE' },
  });
  pgm.sql(`INSERT INTO organization_profile (organization_id, owner_name_en, owner_name_ru, owner_name_hy)
           SELECT id, name, name, name FROM organizations WHERE kind = 'salon'`);
};

export const down = (pgm) => {
  pgm.dropTable('organization_profile');
  pgm.sql('DROP TRIGGER organizations_slug_free ON organizations');
  pgm.sql('DROP TRIGGER masters_slug_free ON masters');
  pgm.sql('DROP FUNCTION slug_free_across_pages()');
  pgm.dropConstraint('organizations', 'organizations_slug_format');
  pgm.dropColumns('organizations', ['slug']);
};

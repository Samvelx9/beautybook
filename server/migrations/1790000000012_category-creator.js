export const shorthands = undefined;

// Which master added a treatment, when a salon's master did (null for the
// owner's own, for templates, and for everything before this). A salon's
// master manages the parts of the shared price list that are theirs alone —
// the services only they perform — and a treatment is theirs when everything
// in it is. A treatment with nothing in it yet has no services to judge by, so
// it is theirs only if they created it.
export const up = (pgm) => {
  pgm.addColumns('service_categories', {
    created_by_master_id: { type: 'integer', references: 'masters', onDelete: 'SET NULL' },
  });
};

export const down = (pgm) => {
  pgm.dropColumns('service_categories', ['created_by_master_id']);
};

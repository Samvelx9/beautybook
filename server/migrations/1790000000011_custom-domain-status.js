export const shorthands = undefined;

// A master's own domain is now put live by the server (deploy/custom-domains):
// once its DNS points at the server, a certificate is issued and an nginx
// server block written. What happened is recorded here for the operator:
//
//   pending      just set; not looked at yet
//   waiting_dns  the domain doesn't point at the server (yet)
//   active       certificate issued, nginx serving it
//   conflict     another site on the server already serves this domain
//   failed       the certificate couldn't be issued; retried with back-off
//
// custom_domain_attempts counts failed certificate attempts, for the back-off
// (Let's Encrypt limits failed validations).
export const up = (pgm) => {
  pgm.addColumns('masters', {
    custom_domain_status: { type: 'text' },
    custom_domain_checked_at: { type: 'timestamptz' },
    custom_domain_attempts: { type: 'integer', notNull: true, default: 0 },
  });
  pgm.addConstraint('masters', 'masters_custom_domain_status', {
    check: "custom_domain_status IN ('pending', 'waiting_dns', 'active', 'conflict', 'failed')",
  });
  // A domain set before this ran was put live by hand.
  pgm.sql("UPDATE masters SET custom_domain_status = 'active' WHERE custom_domain IS NOT NULL");
};

export const down = (pgm) => {
  pgm.dropConstraint('masters', 'masters_custom_domain_status');
  pgm.dropColumns('masters', ['custom_domain_status', 'custom_domain_checked_at', 'custom_domain_attempts']);
};

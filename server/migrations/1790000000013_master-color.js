export const shorthands = undefined;

// The colour a master's bookings wear on the salon owner's Bookings screen
// (and in the master's own panel), one of a fixed palette the admin app
// defines (client-admin/src/masterColors.js; MASTER_COLORS in
// services/masters.js). Null means automatic: the master's place among the
// salon's masters picks one, so a salon gets distinct colours without anyone
// choosing.
export const up = (pgm) => {
  pgm.addColumns('masters', { color: { type: 'text' } });
  pgm.addConstraint('masters', 'masters_color', {
    check: "color IN ('rose', 'orange', 'mustard', 'green', 'teal', 'blue', 'violet', 'magenta')",
  });
};

export const down = (pgm) => {
  pgm.dropConstraint('masters', 'masters_color');
  pgm.dropColumns('masters', ['color']);
};

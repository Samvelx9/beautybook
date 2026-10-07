export const shorthands = undefined;

// How far ahead a guest must book: no slot closer than this to now is offered,
// and a booking or reschedule into it is refused. Each master sets their own
// on the Availability screen; 90 minutes was the platform-wide rule before, so
// it's the default and existing masters keep it. 0 means "any time still
// ahead". Capped at two days — the booking window is a week.
export const up = (pgm) => {
  pgm.addColumns('masters', {
    min_notice_minutes: { type: 'integer', notNull: true, default: 90 },
  });
  pgm.addConstraint('masters', 'masters_min_notice_range', {
    check: 'min_notice_minutes BETWEEN 0 AND 2880',
  });
};

export const down = (pgm) => {
  pgm.dropConstraint('masters', 'masters_min_notice_range');
  pgm.dropColumns('masters', ['min_notice_minutes']);
};

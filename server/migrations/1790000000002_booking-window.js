export const shorthands = undefined;

// How many days ahead guests can book, counting today: the slot picker shows
// this many days, and a booking or reschedule beyond the last one is refused.
// 7 was the platform-wide window before, so it's the default and existing
// masters keep it. Each master sets their own on the Availability screen.
// Always more than the longest minimum notice (2 days), so a page can never be
// left with nothing bookable by those two settings alone.
export const up = (pgm) => {
  pgm.addColumns('masters', {
    booking_window_days: { type: 'integer', notNull: true, default: 7 },
  });
  pgm.addConstraint('masters', 'masters_booking_window_range', {
    check: 'booking_window_days BETWEEN 7 AND 90',
  });
};

export const down = (pgm) => {
  pgm.dropConstraint('masters', 'masters_booking_window_range');
  pgm.dropColumns('masters', ['booking_window_days']);
};

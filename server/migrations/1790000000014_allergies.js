export const shorthands = undefined;

// What a client is allergic to, written down by the master on a booking. A
// client is told apart by phone number (there is no clients table), so their
// allergies are whatever their latest booking that mentions any says; the
// booking form suggests that on their next visit. Never shown to guests.
export const up = (pgm) => {
  pgm.addColumns('bookings', { allergies: { type: 'text' } });
  // A client's earlier bookings, looked up by phone on every admin list.
  pgm.createIndex('bookings', ['organization_id', 'customer_phone']);
};

export const down = (pgm) => {
  pgm.dropIndex('bookings', ['organization_id', 'customer_phone']);
  pgm.dropColumns('bookings', ['allergies']);
};

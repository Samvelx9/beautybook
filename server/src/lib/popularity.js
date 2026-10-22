// How in-demand each zone is right now: how many visits in a rolling 90-day
// window (upcoming ones included) have it in their basket. Cancelled visits
// don't count; no-shows do — the guest still wanted it. The window keeps the
// order seasonal instead of frozen by last year's bookings. A zone belongs to
// one organization, so the count is the organization's: on a salon, every
// master's visits.
//
// Join as `LEFT JOIN (${RECENT_BOOKINGS_SQL}) pop ON pop.service_id = s.id`;
// zones nobody booked come through as NULL, so read COALESCE(pop.recent_bookings, 0).
export const RECENT_BOOKINGS_SQL = `
  SELECT i.service_id, COUNT(*)::int AS recent_bookings
  FROM booking_items i
  JOIN bookings b ON b.id = i.booking_id
  WHERE b.status <> 'cancelled'
    AND b.start_time >= now() - interval '90 days'
  GROUP BY i.service_id`;

// Deliberately a copy of `shared/booking.js` rather than an import of it: the
// backend image is built with `server/` as its whole Docker context (see
// /opt/app/docker-compose.yml), so nothing outside this directory exists at
// runtime. `src/lib/time.js` duplicates the shared time helpers for the same
// reason. Keep the two in step — the rules below are what the guest app shows
// and what this server charges, so they have to agree.
//
// An hourly treatment (electrolysis, say) is priced by the hour rather than by
// the zone: the guest chooses how long to book, and pays the zone's rate pro
// rata. Half an hour is the smallest unit and the step — it matches the slot
// grid, so every bookable length still starts on a real slot boundary.
export const STEP_MINUTES = 30;
export const MIN_BOOKING_MINUTES = 30;
export const MAX_BOOKING_MINUTES = 6 * 60;

export const DURATION_CHOICES = Array.from(
  { length: MAX_BOOKING_MINUTES / STEP_MINUTES },
  (_, i) => (i + 1) * STEP_MINUTES
);

export function isValidDuration(minutes) {
  return (
    Number.isInteger(minutes) &&
    minutes % STEP_MINUTES === 0 &&
    minutes >= MIN_BOOKING_MINUTES &&
    minutes <= MAX_BOOKING_MINUTES
  );
}

// The two numbers a booking is actually made of. For an hourly treatment they
// come from the chosen length, priced pro rata from the hourly rate; otherwise
// the zone's own fixed duration and price stand and `durationMinutes` is
// ignored.
export function bookingShape(service, durationMinutes) {
  if (!service.is_hourly) {
    return { durationMinutes: service.duration_minutes, price: service.price };
  }
  return {
    durationMinutes,
    price: Math.round((service.price * durationMinutes) / 60),
  };
}

// "90" -> "1 h 30 min", with the units passed in so this stays language-free.
export function formatDuration(minutes, hourUnit, minUnit) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h} ${hourUnit} ${m} ${minUnit}`;
  if (h) return `${h} ${hourUnit}`;
  return `${m} ${minUnit}`;
}

// Always same-origin: the API works out whose page this is from the host the
// page is served on, so it must be called on that same host. nginx forwards
// /api in production and Vite's proxy does in development.
const API_BASE = import.meta.env.VITE_API_URL || '/api';

class ApiError extends Error {
  constructor(status, body) {
    super(body?.error || `request_failed_${status}`);
    this.status = status;
    this.code = body?.error;
    this.body = body;
  }
}

async function request(path, options = {}) {
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
  } catch {
    throw new ApiError(0, { error: 'network_error' });
  }

  const isJson = res.headers.get('content-type')?.includes('application/json');
  const body = isJson ? await res.json().catch(() => null) : null;

  if (!res.ok) {
    throw new ApiError(res.status, body);
  }
  return body;
}

export const api = {
  getSite: () => request('/site'),

  getProfile: () => request('/profile'),

  // The master's photo is served as raw bytes, not JSON — callers need the URL,
  // not the body. `version` comes from the profile and busts the cache when
  // she uploads a new photo.
  photoUrl: (version) => `${API_BASE}/profile/photo?v=${version}`,

  getCategories: () => request('/categories'),

  getHours: () => request('/hours'),

  getServices: () => request('/services'),

  // Slots are asked for by length, not by zone: a visit can cover several zones
  // and what decides which starts work is how long the whole thing runs.
  getSlots: ({ excludeBookingId, durationMinutes } = {}) => {
    const params = new URLSearchParams({ durationMinutes });
    if (excludeBookingId) params.set('excludeBookingId', excludeBookingId);
    return request(`/slots?${params.toString()}`);
  },

  createBooking: (payload) =>
    request('/bookings', { method: 'POST', body: JSON.stringify(payload) }),

  lookupBookings: (phone) =>
    request('/bookings/lookup', { method: 'POST', body: JSON.stringify({ phone }) }),

  // The visit as a calendar file, named by the secret token only the guest who
  // booked gets. A plain link rather than a fetch: phones open a calendar file
  // straight into their calendar app when it's navigated to.
  calendarUrl: (guestToken) => `${API_BASE}/calendar/${guestToken}.ics`,

  // The booking a guest's Telegram or calendar link names by its token, with
  // the rest of that phone's upcoming bookings.
  manageBooking: (token) =>
    request('/bookings/manage', { method: 'POST', body: JSON.stringify({ token }) }),

  // `proof` is { phone, token? } — what shows the booking is this guest's.
  cancelBooking: (id, proof) =>
    request(`/bookings/${id}/cancel`, { method: 'POST', body: JSON.stringify(proof) }),

  rescheduleBooking: (id, payload) =>
    request(`/bookings/${id}/reschedule`, { method: 'POST', body: JSON.stringify(payload) }),
};

export { ApiError };

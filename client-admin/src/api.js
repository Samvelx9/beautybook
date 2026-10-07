// Same-origin: nginx forwards /api in production, Vite's proxy does in dev.
const API_BASE = import.meta.env.VITE_API_URL || '/api';

class ApiError extends Error {
  constructor(status, body) {
    super(body?.error || `request_failed_${status}`);
    this.status = status;
    this.code = body?.error;
    this.body = body;
  }
}

let authToken = null;
export function setAuthToken(token) {
  authToken = token;
}

async function request(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;

  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...options, headers });
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

const json = (method, body) => ({ method, body: JSON.stringify(body) });

function query(params) {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) qs.set(key, value);
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
}

export const api = {
  // Sign-up and login (public).
  login: (email, password) => request('/auth/login', json('POST', { email, password })),
  signup: (payload) => request('/auth/signup', json('POST', payload)),
  checkSlug: (slug) => request(`/auth/slug${query({ slug })}`),
  getTemplates: () => request('/auth/templates'),

  // The master's account, settings and integrations.
  getAccount: () => request('/admin/account'),
  updateSettings: (payload) => request('/admin/account/settings', json('PATCH', payload)),
  changePassword: (currentPassword, newPassword) =>
    request('/admin/account/password', json('POST', { currentPassword, newPassword })),
  deleteAccount: (password) => request('/admin/account', json('DELETE', { password })),
  connectTelegram: () => request('/admin/telegram/connect', { method: 'POST' }),
  disconnectTelegram: () => request('/admin/telegram', { method: 'DELETE' }),
  startCheckout: () => request('/admin/billing/checkout', { method: 'POST' }),
  applyTemplate: (key) => request(`/admin/templates/${encodeURIComponent(key)}`, { method: 'POST' }),

  getProfile: () => request('/admin/profile'),
  updateProfile: (payload) => request('/admin/profile', json('PUT', payload)),

  // The photo goes up as a raw body typed by the file itself — not JSON and
  // not multipart (the endpoint takes one file and nothing else).
  uploadPhoto: (file) =>
    request('/admin/profile/photo', {
      method: 'PUT',
      headers: { 'Content-Type': file.type },
      body: file,
    }),
  deletePhoto: () => request('/admin/profile/photo', { method: 'DELETE' }),
  // The photo is served by the master's own page (the guest API works out the
  // master from the host), so the URL is on that page's address.
  photoUrl: (siteUrl, version) => `${siteUrl}/api/profile/photo?v=${version}`,

  getCategories: () => request('/admin/categories'),
  createCategory: (payload) => request('/admin/categories', json('POST', payload)),
  updateCategory: (id, payload) => request(`/admin/categories/${id}`, json('PATCH', payload)),
  deleteCategory: (id) => request(`/admin/categories/${id}`, { method: 'DELETE' }),

  getServices: () => request('/admin/services'),
  createService: (payload) => request('/admin/services', json('POST', payload)),
  updateService: (id, payload) => request(`/admin/services/${id}`, json('PATCH', payload)),
  deleteService: (id) => request(`/admin/services/${id}`, { method: 'DELETE' }),

  getWeeklyHours: () => request('/admin/availability/weekly'),
  // The whole week saved at once, transactionally — see the Availability screen.
  updateWeeklyHoursAll: (days) => request('/admin/availability/weekly', json('PUT', { days })),
  updateWeeklyHours: (dayOfWeek, payload) =>
    request(`/admin/availability/weekly/${dayOfWeek}`, json('PUT', payload)),
  getBlocks: (from, to) => request(`/admin/availability/blocks${query({ from, to })}`),
  createBlock: (payload) => request('/admin/availability/blocks', json('POST', payload)),
  deleteBlock: (id) => request(`/admin/availability/blocks/${id}`, { method: 'DELETE' }),

  getBookings: ({ from, to, status } = {}) => request(`/admin/bookings${query({ from, to, status })}`),
  // A booking the master enters themselves — no cutoff or opening-hours check.
  createBooking: (payload) => request('/admin/bookings', json('POST', payload)),
  // Any field of an existing booking — zones, time, client, status.
  updateBooking: (id, payload) => request(`/admin/bookings/${id}`, json('PATCH', payload)),
  updateBookingStatus: (id, status) => request(`/admin/bookings/${id}/status`, json('PATCH', { status })),
  // Cancelled bookings only — the endpoint refuses anything else.
  deleteBookings: (ids) => request('/admin/bookings', json('DELETE', { ids })),

  getExpenses: ({ from, to, category } = {}) => request(`/admin/expenses${query({ from, to, category })}`),
  getExpenseCategories: () => request('/admin/expenses/categories'),
  createExpense: (payload) => request('/admin/expenses', json('POST', payload)),
  updateExpense: (id, payload) => request(`/admin/expenses/${id}`, json('PATCH', payload)),
  deleteExpense: (id) => request(`/admin/expenses/${id}`, { method: 'DELETE' }),

  getFinancials: ({ from, to } = {}) => request(`/admin/financials${query({ from, to })}`),

  // The platform operator's screen.
  getPlatformMasters: () => request('/platform/masters'),
  updatePlatformMaster: (id, payload) => request(`/platform/masters/${id}`, json('PATCH', payload)),
  resetMasterPassword: (id) => request(`/platform/masters/${id}/reset-password`, { method: 'POST' }),
};

export { ApiError };

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

// Whose calendar the calendar calls below (landing page, hours, days off,
// bookings) act on. null: the login's own, at /api/admin. A salon's owner picks
// one of the salon's masters by id — /api/salon/masters/:id, the same routes —
// 'all' for the bookings list across every master, or 'salon' for the salon
// page's own landing page. Set synchronously by
// App before the screens render, like the auth token.
let calendar = null;
export function setCalendar(masterId) {
  calendar = masterId;
}
// 'salon' is the salon page itself, for its landing page (/salon/profile).
const cal = (path, masterId = calendar) => {
  if (typeof masterId === 'number') return `/salon/masters/${masterId}${path}`;
  if (masterId === 'salon') return `/salon${path}`;
  return `/admin${path}`;
};

function query(params) {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) qs.set(key, value);
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
}

// A file the API makes for the logged-in user (a CSV export), saved by the
// browser. Fetched rather than linked: the request needs the auth token.
async function download(path, filename) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
  });
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
  const url = URL.createObjectURL(await res.blob());
  const link = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const api = {
  // Sign-up and login (public).
  login: (email, password) => request('/auth/login', json('POST', { email, password })),
  signup: (payload) => request('/auth/signup', json('POST', payload)),
  checkSlug: (slug) => request(`/auth/slug${query({ slug })}`),
  getTemplates: () => request('/auth/templates'),
  getPlatformInfo: () => request('/auth/platform'),

  // The master's account, settings and integrations.
  getAccount: () => request('/admin/account'),
  updateSettings: (payload) => request('/admin/account/settings', json('PATCH', payload)),
  changeSlug: (slug) => request('/admin/account/slug', json('PATCH', { slug })),
  changeEmail: (email, password) => request('/admin/account/email', json('POST', { email, password })),
  changePassword: (currentPassword, newPassword) =>
    request('/admin/account/password', json('POST', { currentPassword, newPassword })),
  deleteAccount: (password) => request('/admin/account', json('DELETE', { password })),
  connectTelegram: () => request('/admin/telegram/connect', { method: 'POST' }),
  disconnectTelegram: () => request('/admin/telegram', { method: 'DELETE' }),
  startCheckout: () => request('/admin/billing/checkout', { method: 'POST' }),
  applyTemplate: (key) => request(`/admin/templates/${encodeURIComponent(key)}`, { method: 'POST' }),

  getProfile: () => request(cal('/profile')),
  updateProfile: (payload) => request(cal('/profile'), json('PUT', payload)),

  // The photo goes up as a raw body typed by the file itself — not JSON and
  // not multipart (the endpoint takes one file and nothing else).
  uploadPhoto: (file) =>
    request(cal('/profile/photo'), {
      method: 'PUT',
      headers: { 'Content-Type': file.type },
      body: file,
    }),
  deletePhoto: () => request(cal('/profile/photo'), { method: 'DELETE' }),
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

  getWeeklyHours: () => request(cal('/availability/weekly')),
  // The whole week saved at once, transactionally — see the Availability screen.
  updateWeeklyHoursAll: (days) => request(cal('/availability/weekly'), json('PUT', { days })),
  updateWeeklyHours: (dayOfWeek, payload) =>
    request(cal(`/availability/weekly/${dayOfWeek}`), json('PUT', payload)),
  getBlocks: (from, to) => request(cal(`/availability/blocks${query({ from, to })}`)),
  createBlock: (payload) => request(cal('/availability/blocks'), json('POST', payload)),
  deleteBlock: (id) => request(cal(`/availability/blocks/${id}`), { method: 'DELETE' }),
  // Minimum notice and booking window: the calendar's own.
  getBookingRules: () => request(cal('/availability/settings')),
  updateBookingRules: (payload) => request(cal('/availability/settings'), json('PATCH', payload)),

  // With the calendar set to 'all', every master's bookings, each with its
  // `master_id`. The calls that change one booking take that master's id then.
  getBookings: ({ from, to, status } = {}) =>
    calendar === 'all'
      ? request(`/salon/bookings${query({ from, to, status })}`)
      : request(cal(`/bookings${query({ from, to, status })}`)),
  // A booking entered in the admin panel — no cutoff or opening-hours check.
  createBooking: (payload, masterId) => request(cal('/bookings', masterId), json('POST', payload)),
  // Any field of an existing booking — zones, time, client, status, and for a
  // salon's owner the master (`masterId`).
  updateBooking: (id, payload, masterId) => request(cal(`/bookings/${id}`, masterId), json('PATCH', payload)),
  updateBookingStatus: (id, status, masterId) =>
    request(cal(`/bookings/${id}/status`, masterId), json('PATCH', { status })),
  // Cancelled bookings only — the endpoint refuses anything else.
  deleteBookings: (ids, masterId) => request(cal('/bookings', masterId), json('DELETE', { ids })),

  // The owner's list of taxes on income.
  getTaxes: () => request('/admin/taxes'),
  createTax: (payload) => request('/admin/taxes', json('POST', payload)),
  updateTax: (id, payload) => request(`/admin/taxes/${id}`, json('PATCH', payload)),
  deleteTax: (id) => request(`/admin/taxes/${id}`, { method: 'DELETE' }),

  getExpenses: ({ from, to, category } = {}) => request(`/admin/expenses${query({ from, to, category })}`),
  getExpenseCategories: () => request('/admin/expenses/categories'),
  createExpense: (payload) => request('/admin/expenses', json('POST', payload)),
  updateExpense: (id, payload) => request(`/admin/expenses/${id}`, json('PATCH', payload)),
  deleteExpense: (id) => request(`/admin/expenses/${id}`, { method: 'DELETE' }),

  // CSV exports: a master's own, or for a salon's owner the salon's (one
  // master with masterId).
  exportBookings: ({ from, to, masterId } = {}) =>
    download(`/admin/export/bookings.csv${query({ from, to, masterId })}`, `bookings-${from}-${to}.csv`),
  exportClients: ({ masterId } = {}) => download(`/admin/export/clients.csv${query({ masterId })}`, 'clients.csv'),

  getFinancials: ({ from, to, masterId } = {}) => request(`/admin/financials${query({ from, to, masterId })}`),

  // A salon's owner: the salon and its masters.
  getSalon: () => request('/salon'),
  updateSalon: (payload) => request('/salon', json('PATCH', payload)),
  // { slug, displayName, email } → { master, email, password }, or
  // { self: true, slug, displayName } for the owner's own calendar.
  addMaster: (payload) => request('/salon/masters', json('POST', payload)),
  // { active }, { serviceIds }, { sharePercent } and/or { taxPayer }.
  updateMaster: (id, payload) => request(`/salon/masters/${id}`, json('PATCH', payload)),
  resetMasterLogin: (id) => request(`/salon/masters/${id}/reset-password`, { method: 'POST' }),
  connectSalonTelegram: () => request('/salon/telegram/connect', { method: 'POST' }),
  disconnectSalonTelegram: () => request('/salon/telegram', { method: 'DELETE' }),

  // The platform operator's screen.
  getPlatformMasters: () => request('/platform/masters'),
  getPlatformOrganizations: () => request('/platform/organizations'),
  getPlatformOverview: () => request('/platform/overview'),
  getPlatformOrganization: (id) => request(`/platform/organizations/${id}`),
  // { suspended } or { extendTrialDays } for a whole organization.
  updatePlatformOrganization: (id, payload) => request(`/platform/organizations/${id}`, json('PATCH', payload)),
  // Everything the organization owns; `confirm` is its owner's email.
  deletePlatformOrganization: (id, confirm) => request(`/platform/organizations/${id}`, json('DELETE', { confirm })),
  getPlatformMaster: (id) => request(`/platform/masters/${id}`),
  getPlatformSettings: () => request('/platform/settings'),
  updatePlatformSettings: (payload) => request('/platform/settings', json('PATCH', payload)),
  changeOperatorPassword: (currentPassword, newPassword) =>
    request('/platform/password', json('POST', { currentPassword, newPassword })),
  updatePlatformMaster: (id, payload) => request(`/platform/masters/${id}`, json('PATCH', payload)),
  resetMasterPassword: (id) => request(`/platform/masters/${id}/reset-password`, { method: 'POST' }),
};

export { ApiError };

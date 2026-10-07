// Where the master is in the admin lives in the URL hash — `#bookings?month=2026-10&day=2026-10-05`
// — so a reload lands her back on the same screen instead of the dashboard.
// A hash rather than a path, because nginx serves /admin/ as static files and
// any other path under it would 404.
//
// Switching tabs adds a history entry (Back returns to the previous tab); moving
// around within a screen only replaces the current one, so Back doesn't step
// through every month she looked at.

export function readRoute() {
  const [tab, query = ''] = window.location.hash.replace(/^#/, '').split('?');
  return { tab, params: new URLSearchParams(query) };
}

function write(tab, params, { push }) {
  const query = params.toString();
  const url = `${window.location.pathname}${window.location.search}#${tab}${query ? `?${query}` : ''}`;
  if (url === `${window.location.pathname}${window.location.search}${window.location.hash}`) return;
  window.history[push ? 'pushState' : 'replaceState'](null, '', url);
}

export function goToTab(tab) {
  write(tab, new URLSearchParams(), { push: true });
}

// Writes the current screen's own state; empty values are left out so the URL
// only carries what differs from a fresh visit.
export function setRouteParams(values) {
  const { tab, params } = readRoute();
  for (const [key, value] of Object.entries(values)) {
    if (value === null || value === undefined || value === '') params.delete(key);
    else params.set(key, String(value));
  }
  write(tab, params, { push: false });
}

// A param from the URL, or `fallback` when it's missing or doesn't pass `isValid`
// — a hand-edited or stale URL just falls back to the default view.
export function routeParam(name, isValid, fallback) {
  const value = readRoute().params.get(name);
  return value !== null && isValid(value) ? value : fallback;
}

export const isDateStr = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
export const isMonthStr = (v) => /^\d{4}-(0[1-9]|1[0-2])$/.test(v);

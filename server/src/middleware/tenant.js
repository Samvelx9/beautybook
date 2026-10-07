import { getMasterByHost, hasAccess } from '../services/masters.js';

// Every guest request belongs to the master whose page it was made on, read
// from the host: "<slug>.<PLATFORM_DOMAIN>" or the master's own domain. nginx
// passes the original host through as X-Forwarded-Host; the Vite dev server's
// proxy keeps Host itself.
//
// `req.master` is then the only master the request may read or write — every
// query in routes/guest.js is scoped by `req.master.id`.
export async function resolveTenant(req, res, next) {
  try {
    const host = req.get('x-forwarded-host') || req.get('host');
    const master = await getMasterByHost(host);
    if (!master) {
      return res.status(404).json({ error: 'master_not_found' });
    }
    req.master = master;
    next();
  } catch (err) {
    next(err);
  }
}

// For the routes that create or change a booking: a page whose trial has run
// out (or whose master was suspended) still shows, but takes no bookings.
export function requireOpenPage(req, res, next) {
  if (!hasAccess(req.master)) {
    return res.status(403).json({ error: 'page_closed' });
  }
  next();
}

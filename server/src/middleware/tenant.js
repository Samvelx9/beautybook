import { getMasterById, getMasterByHost, getSalonByHost, hasAccess } from '../services/masters.js';

// Every guest request belongs to the page it was made on, read from the host:
// "<slug>.<PLATFORM_DOMAIN>" — a master's page or a salon's — or a master's
// own domain. nginx passes the original host through as X-Forwarded-Host; the
// Vite dev server's proxy keeps Host itself.
//
// - On a master's page, `req.master` is the only master the request may read
//   or write — every query in routes/guest.js is scoped by `req.master.id`.
// - On a salon's page, `req.salon` is the salon. A guest who has picked one
//   of its masters sends ?master=<id>, and `req.master` is then that master,
//   checked to be one of the salon's and still working: from there the
//   request is exactly as on that master's own page. Without one,
//   `req.master` is null and the salon-wide answers apply.
export async function resolveTenant(req, res, next) {
  try {
    const host = req.get('x-forwarded-host') || req.get('host');
    const master = await getMasterByHost(host);
    if (master) {
      req.master = master;
      return next();
    }
    const salon = await getSalonByHost(host);
    if (!salon) return res.status(404).json({ error: 'master_not_found' });
    req.salon = salon;
    req.master = null;
    if (req.query.master !== undefined) {
      const id = Number(req.query.master);
      const picked = Number.isInteger(id) ? await getMasterById(id) : null;
      if (!picked || picked.organization_id !== salon.id || picked.deactivated_at) {
        return res.status(404).json({ error: 'master_not_found' });
      }
      req.master = picked;
    }
    next();
  } catch (err) {
    next(err);
  }
}

// For the routes that create or change a booking: a page whose trial has run
// out (or whose master was suspended or deactivated) still shows, but takes
// no bookings.
export function requireOpenPage(req, res, next) {
  if (!hasAccess(req.master ?? req.salon)) {
    return res.status(403).json({ error: 'page_closed' });
  }
  next();
}

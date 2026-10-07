// A fixed-window request limit per client IP, kept in memory. One backend
// process serves the platform, so there's nothing to share between instances;
// a restart simply forgets the counts, which errs on the side of letting
// people in.
//
// The client IP comes from X-Real-IP, which nginx sets from the connection
// (see deploy/nginx); `trust proxy` is not needed for that.
export function rateLimit({ windowMs, max, name }) {
  const hits = new Map();

  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(key);
    }
  }, windowMs).unref();

  return (req, res, next) => {
    const ip = req.get('x-real-ip') || req.socket.remoteAddress || 'unknown';
    const key = `${name}:${ip}`;
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > max) {
      res.set('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      return res.status(429).json({ error: 'too_many_requests' });
    }
    next();
  };
}

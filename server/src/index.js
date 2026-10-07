import 'dotenv/config';
import express from 'express';
import { pool } from './db.js';
import { guestRouter } from './routes/guest.js';
import { adminRouter } from './routes/admin.js';
import { authRouter } from './routes/auth.js';
import { billingRouter } from './routes/billing.js';
import { platformRouter } from './routes/platform.js';
import { telegramRouter } from './routes/telegram.js';
import { registerWebhook, telegramToken } from './services/telegram.js';
import { startCompletionPrompts } from './services/completionPrompts.js';
import { startGuestReminders } from './services/guestNotifications.js';

for (const name of ['DATABASE_URL', 'JWT_SECRET', 'PLATFORM_DOMAIN']) {
  if (!process.env[name]) {
    console.error(`${name} is not set`);
    process.exit(1);
  }
}

const app = express();
app.disable('x-powered-by');

// Everything is same-origin behind nginx (and behind Vite's proxy in dev), so
// no CORS headers are sent at all: no other site's scripts may call the API.

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected' });
  } catch {
    res.status(503).json({ status: 'error', db: 'unreachable' });
  }
});

// Before express.json(): the signature is over the raw body.
app.use('/api/billing', billingRouter);

app.use(express.json({ limit: '100kb' }));

app.use('/api/telegram', telegramRouter);
app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api/platform', platformRouter);
// Last: guest routes resolve the master from the host and 404 on anything else.
app.use('/api', guestRouter);

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'too_large' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid_json' });
  console.error(err);
  res.status(500).json({ error: 'internal_error' });
});

const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);

  // The background jobs and the bot webhook need Telegram to be able to reach
  // this server, so they only run where PUBLIC_URL (the https origin of the
  // platform's app host) says it can — not on a dev machine that happens to
  // have the bot token.
  const publicUrl = process.env.PUBLIC_URL;
  if (publicUrl && telegramToken()) {
    registerWebhook(publicUrl);
    startCompletionPrompts();
    startGuestReminders();
  }
});

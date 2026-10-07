# BeautyBook

Online booking pages for beauty masters. Each master signs up, gets their own page at
`<slug>.<PLATFORM_DOMAIN>` (or their own domain), builds a price list, sets their hours,
and clients book themselves. Every booking reaches the master in Telegram, guests get
reminders, and the master sees income and expenses in their admin panel.

"BeautyBook" is a working name — it comes from `PRODUCT_NAME` / `VITE_PRODUCT_NAME`.

## Structure

- `server/` — Node.js/Express API + PostgreSQL. One process serves every master.
- `client-guest/` — the booking page a master's clients see (React + Vite).
- `client-admin/` — the platform's own app: welcome page, sign-up, each master's
  admin panel, and the operator's Platform screen (React + Vite).
- `shared/` — helpers both frontends use (formatting, time, booking rules).
- `deploy/` — nginx, compose and deploy script for the VM. See `deploy/README.md`.

## How tenancy works

Every row belongs to a master (`master_id`), and every query is scoped to one:

- **Guest requests** — the master is resolved from the host the page is served on
  (`server/src/middleware/tenant.js`): `<slug>.<PLATFORM_DOMAIN>`, or a custom domain
  set on the Platform screen.
- **Admin requests** — the master is the logged-in user's (`middleware/auth.js`); an id
  in a URL only ever names a row *within* that master's data.
- **The database backs it up**: a zone can only sit in its own master's treatment and a
  booking can only include its own master's zones (composite foreign keys), and the
  no-double-booking rule is per master.

`server/test/api.test.js` checks this end to end (one master can't read, change or book
another's data), plus sign-up, timezones, trial expiry and billing webhooks.

## Masters' settings

Each master picks their **timezone** (hours and slots are in their local time), their
**currency**, and which of **Armenian / Russian / English** their page offers. Names
need filling in only in the languages they offer; a blank one falls back to another.
New masters can start from a **template** (nails, brows & lashes, depilation, hair,
massage, facial): its zones arrive hidden and unpriced, for the master to price and
switch on.

## Billing

A free **7-day trial** starts at sign-up, no card. After that the page needs a
**Lemon Squeezy** subscription: Settings → Subscribe opens a checkout, and Lemon
Squeezy's webhooks (`POST /api/billing/webhook`, signature-checked) keep the master's
status current. When access lapses the booking page still shows the master and their
contacts but takes no bookings; the admin panel and all data stay available.
`past_due` keeps the page open while Lemon Squeezy retries the card, and a cancelled
subscription runs to the end of its paid period.

## Telegram

One platform bot (`TELEGRAM_BOT_TOKEN`) serves everyone. A master presses **Connect
Telegram** in Settings, which opens the bot with a one-time link; from then on their
bookings, reschedules and cancellations arrive there, in the language they choose, with
"did the visit happen?" buttons after each visit. Guests opt in on the confirmation
screen and get reminders the evening before and 2 hours before, in their own language,
at the master's local time.

## Platform operator

The operator's login sees a **Platform** tab: every master, their status and activity,
and buttons to extend a trial, set a custom domain, reset a password, or suspend.
Create that login with:

```bash
cd server
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='…' npm run create-platform-admin
```

## Local development

Requires Node.js 20+ and PostgreSQL.

```bash
npm install
cp server/.env.example server/.env      # fill in DATABASE_URL and JWT_SECRET
npm run migrate:up

npm run dev:server   # API on :4000
npm run dev:guest    # booking pages on http://<slug>.localhost:5173
npm run dev:admin    # the app on http://localhost:5174
```

Sign up at `localhost:5174`, then open your page at `http://<your-slug>.localhost:5173`
(browsers resolve any `*.localhost` to this machine).

Tests (they wipe the database you point them at):

```bash
cd server && TEST_DATABASE_URL=postgres://…/beautybook_test npm test
```

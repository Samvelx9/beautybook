# Done

What BeautyBook can do today, and how it's set up. What's still open is in [TODO.md](TODO.md).

Staging is live at **https://app.beautybookam.duckdns.org**; masters' pages are at
`https://<slug>.beautybookam.duckdns.org`.

## Product

### For masters
- **Sign-up** with name, page address (transliterated from Armenian/Cyrillic names, checked
  for availability as you type), email, password, page languages, timezone and currency.
- **7-day free trial**, no card. A banner counts down the days; when access lapses the page
  stops taking bookings but still shows the master and their contacts, and the admin panel
  and all data stay available.
- **Starter templates**: depilation (waxing, sugaring, electrolysis), nails, brows & lashes,
  hair, massage, facial care. Zones arrive hidden and unpriced for the master to price and
  switch on. Available at sign-up and from the Treatments screen.
- **Onboarding checklist** on the dashboard: photo/intro, priced live zones, working hours,
  Telegram, share the link.
- **Admin panel** (carried over from the single-salon app): bookings calendar with manual
  bookings and edits, treatments and zones, weekly hours with lunch breaks, date blocks,
  landing-page profile with photo, income by treatment, expenses.
- **Settings**: page link (copy/open), subscription status and Subscribe / Manage billing,
  Connect Telegram, page languages + default language, notification language, timezone,
  currency, password change (ends other sessions), account deletion.
- **Per-master timezone, currency and languages** (Armenian, Russian, English). Names need
  filling in only in the languages offered; blanks fall back to another language.

### For guests
- Booking page per master, resolved from the subdomain (or a custom domain): landing page,
  treatments → zones (several in one visit) → time → details → confirmation.
- Slots in the master's local time; past, booked, blocked and closing-time slots shown greyed.
- Add to calendar (.ics) and opt-in Telegram reminders (evening before and 2 hours before,
  with "I'll be there" / "Cancel visit"), in the guest's language.
- Find / reschedule / cancel a booking by phone, or straight from the link in a reminder.
- Opens in the master's default language; only the master's languages are offered.

### For the platform operator
- **Platform** tab: every master with status, trial/period end, activity and live zones.
- Actions: extend trial by 7 days, set a custom domain, reset a master's password (shown
  once), suspend / unsuspend.
- **Master detail page**: account and standing, contacts on their page, performance
  (bookings by status, show-up and cancellation rates, revenue overall and last 30 days,
  clients and returning clients, share booked online, Telegram opt-ins), a six-month
  bookings chart, and the full price list with each zone's bookings, completions and
  revenue. Aggregates only — no client names or phone numbers.
- **Operator Settings**: change the operator's own password.
- Operator logins can be a plain username (e.g. `admin`).

### Billing (built, not yet live — see TODO)
- Lemon Squeezy checkout per master (master id passed as custom data).
- Signed webhook (`/api/billing/webhook`) keeps each master's subscription state current;
  replays and out-of-order events are safe; `past_due` keeps the page open while the card
  is retried; a cancelled subscription runs to the end of its paid period.

### Telegram
- One platform bot, **@beautybookam_bot**, with its description, short description and
  `/start` command set in English, Russian and Armenian on every start.
- Masters connect with a one-time link from Settings; notifications for new, moved and
  cancelled bookings and guest confirmations, in the master's chosen language, plus
  "did the visit happen?" buttons after each visit.
- Guests opt in per booking from the confirmation screen.
- Verified end to end on 2026-10-07: a test master connected, and new/moved/cancelled
  notifications all arrived.

## Security and data separation
- Every row belongs to a master; guest requests are scoped by host, admin requests by the
  logged-in user. Composite foreign keys stop a zone or booking from pointing at another
  master's data; the no-double-booking rule is per master.
- Guests must show the booking's phone number or secret token to cancel or reschedule (the
  single-salon app accepted a bare booking id).
- Sessions carry a version number: a password change or reset ends other sessions.
- Rate limits on sign-up, login, slug checks, booking and phone lookup.
- No CORS headers: only the platform's own pages can call the API.
- Secrets live only in the server's root-only `.env` and `/etc/letsencrypt/duckdns.token`,
  never in the repository.

## Engineering
- Fresh multi-tenant schema in one migration (`server/migrations/1790000000000_platform-schema.js`).
- Timezone handling with `Intl` (daylight saving included) instead of a fixed UTC+4 offset,
  on both server and clients.
- 18 end-to-end API tests (`server/test/api.test.js`) against a real Postgres: tenant
  isolation, sign-up, timezones, trial expiry, billing webhooks (real and forged), platform
  screens, password changes, account deletion with bookings.
- Fixed along the way: account deletion failed for any master with bookings (cascade
  order); blocked-delete errors now recognised on Postgres 16 and 17+; guest page opened in
  the wrong language; reschedule retry reloaded slots with the wrong arguments; dates in
  the admin used UTC instead of the master's timezone.

## Infrastructure
- Runs on the Oracle VM next to another site, as a separate stack: its own backend
  container (`beautybook-backend`), its own database on the shared Postgres, its own nginx
  config on the shared nginx container.
- **Let's Encrypt** certificates for `beautybookam.duckdns.org` and `*.beautybookam.duckdns.org`
  (DNS-01 via DuckDNS hooks), renewing automatically with the server's certbot timer;
  renewal dry run passed.
- `deploy/deploy.sh` rebuilds the backend and both frontends; deploy docs in
  `deploy/README.md`.
- Lesson recorded: never name a compose service `backend` on the shared network — another
  site's nginx proxies to `http://backend:4000`, and a second `backend` split its traffic
  (happened once on 2026-10-07, fixed the same day).

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

### Bookings screen (2026-10-23)
- **Opens on the Day view.** With every master on screen it's the day, a column per master;
  with one calendar (a master's own login, or the owner picking one master) it's that
  calendar's **Week**, Monday to Sunday, a column per day. Month and Year are still there.
  The Today button is gone (the screen opens on today; arrows step a day, a week, a month).
- **Timeline**: bookings as blocks; time outside hours, lunch, days off and blocked
  stretches hatched; a now-line today. Clicking a booking opens it in its day's list;
  clicking free time starts a booking for that master, day and time (snapped to 15
  minutes). A short visit shows as one line, start and client.
- **Master colours**: each master has one of eight colours, picked automatically by their
  place in the salon or chosen by the owner on the Masters screen (migration 013,
  `masters.color`); the master sees theirs in their own panel. Across masters: a dot per
  master under each month day (counts in the tooltip), a colour stripe and dot on each
  booking in the list, and a legend of chips that hides or shows each master's bookings.
- **Masters of the same trade side by side**: columns, legend and dots are ordered by each
  master's main treatment (the one they perform most services in), so two barbers sit
  together.
- **Drag and drop**: a confirmed booking drags to another time, master or day. While it's
  dragged only masters who perform everything in it stay live; the rest fade and refuse
  the drop, and a spot that would overlap says so. Across masters, a strip of days appears
  while dragging — holding the booking over one turns the timeline to that day and the drag
  carries on; in the week view it's just another column. Near the edge a wide timeline
  scrolls. Mouse and touch.
- **Status colours** in one calendar's week: confirmed yellow, completed green, cancelled or
  no-show red, with a legend; cancelled bookings show struck through and share the column
  with a booking that took their time. Across masters the colour stays the master's. The
  list's status words use the same colours.
- **Most-booked zones first** in guests' zone lists (master and salon pages) and the admin
  booking form: most booked over the last 90 days, cancellations not counted, ties in
  price-list order. Brought over from the single-salon app.
- **Income by service** on the dashboard shows how many visits each zone had, with each
  treatment's total in its header. Also from the single-salon app.

### Salons: who changes what (2026-10-23)
- A salon's **master** has Treatments and Services tabs for the part of the shared price
  list that is theirs alone: a service is theirs when no other working master performs it;
  a treatment is theirs when everything in it is, or, while empty, when they created it
  (migration 012, `service_categories.created_by_master_id`). What they add is performed by
  them only. Shared services and treatments show who else does them and stay the owner's;
  the server refuses a master's change (403). Starter templates stay the owner's.
- A master sees only the services they perform. **Bookings entered by hand** — by the master
  or the owner — take only services that booking's master performs (`not_performed`); what
  a booking already has stays allowed when it's edited; a visit handed to another master
  must be one they perform.
- The **owner** sees who performs each service, and their booking form narrows the zones to
  the chosen master's.

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
- 47 end-to-end API tests (`server/test/api.test.js`) against a real Postgres: tenant
  isolation, sign-up, timezones, trial expiry, billing webhooks (real and forged), platform
  screens, password changes, account deletion with bookings, salons, and (added
  2026-10-23) zone popularity order, a salon master's own part of the price list and
  bookings limited to what a master performs, and master colours.
- Migrations since the first: 001–011 (notice, booking window, platform settings,
  organizations, salons, income split, taxes, salon page, plans, Armenian first, custom
  domain status), 012 treatment creator and 013 master colour (both 2026-10-23, run on the
  server from a `node:20-alpine` container on the shared network with the root-only
  `.env`).
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
- **Nightly database backups** of every database on the shared Postgres plus roles
  (`deploy/backup/`): 7 daily, 5 weekly, 12 monthly, checked before they're kept,
  root-only. Restores verified on 2026-10-07: every table's row count matched the live
  databases. Retention pruning tested on dummy folders.
- `deploy/deploy.sh` rebuilds the backend and both frontends; deploy docs in
  `deploy/README.md`.
- **Demo salon on staging** (2026-10-23, test data): "Demo Beauty Salon (test)" at
  `demo-salon.beautybookam.duckdns.org`, 8 masters (two barbers, sugaring, nails, massage,
  makeup, brows & lashes, hair) with test prices and about 135 test bookings over a week.
  Logins are in `demo-salon-logins.txt` outside the repository, never committed.
- Lesson recorded: never name a compose service `backend` on the shared network — another
  site's nginx proxies to `http://backend:4000`, and a second `backend` split its traffic
  (happened once on 2026-10-07, fixed the same day).

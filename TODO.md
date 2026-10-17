# To do

Most urgent first. What's already built is in [DONE.md](DONE.md).

## 1. Now — security and data safety

- [ ] **Copy the backups off the server.** Nightly backups exist (see DONE.md) but live on
      the same VM, so they don't survive losing it. Sync `/var/backups/postgres` to object
      storage (e.g. Oracle Object Storage or Backblaze B2) with the same retention.
- [ ] **Alert when a backup fails** (today it shows only in `journalctl -u pg-backup`).
- [ ] **Rotate the credentials that were shared in chat**:
  - [ ] Telegram bot token (@BotFather → `/revoke`), then update `TELEGRAM_BOT_TOKEN` in
        the server's `.env` and restart the backend.
  - [ ] DuckDNS token (duckdns.org → recreate token), then update
        `/etc/letsencrypt/duckdns.token` — renewals fail with an old token.
  - [ ] Operator `admin` password (Platform → Settings).
- [ ] **GitHub access token used for pushing expires on 2026-10-15** — create a new one.

## 2. Before selling to real masters

- [ ] **Choose the name and register the real domain**; move DNS to a provider with an API
      (Cloudflare's free plan), issue one Let's Encrypt wildcard certificate, switch
      `PLATFORM_DOMAIN` / `PUBLIC_URL`, redeploy. `beautybookam.duckdns.org` is staging only.
- [ ] **Turn on billing**: create the Lemon Squeezy store and subscription product (decide
      the price), set the four `LEMONSQUEEZY_*` values, add the webhook, and run one real
      checkout end to end (subscribe → page stays open → cancel → runs to period end).
      Built and tested against signed fake webhooks only.
- [ ] **Terms of service and privacy policy** pages (also needed for Lemon Squeezy approval),
      linked from sign-up and the booking pages. Masters store their clients' names and
      phone numbers, so the privacy policy must say who controls that data.
- [ ] **Email**: verify the address at sign-up, and "forgot password" — today only the
      operator can reset a master's password, from the Platform screen.
- [ ] **Exercise the parts not yet run live**: guest Telegram reminders (evening-before and
      2-hour), the "did the visit happen?" buttons, and the guest "Cancel visit" button in
      Telegram. All work locally and in tests, but haven't been seen on the live bot.
- [ ] **Monitoring**: an uptime check on `/api/health` and alerts when the backend or
      certificate renewal fails.
- [ ] **Try it on a phone** end to end (sign-up, setup, booking, Telegram).
- [ ] **Armenian first.** The platform speaks three languages — Armenian, Russian,
      English — and Armenian must be the default everywhere. The Armenian strings
      exist for every screen; what's left is the defaults, which are Russian today:
  - [ ] `DEFAULT_LANG` in `shared/i18n.js` (the admin panel falls back to it when
        the browser isn't set to a supported language; the guest page until the
        master's own default arrives).
  - [ ] Server defaults: `notify_lang` on `masters` and `organizations`, the
        sign-up default, and `masterText()`'s fallback for Telegram messages.
        A master's page already opens in Armenian by default (`default_lang`).
  - [ ] The sign-up form preselects Armenian for the page and for notifications.
  - [ ] A native speaker reads the Armenian copy through — it hasn't been
        proofread — including the Telegram messages and the privacy policy.
  - [ ] Every new screen ships in all three languages (the salon screens included).

## 3. Product

- [ ] **Custom domains for masters**: today the operator sets the domain, but DNS, the
      certificate and an nginx server block are manual. Automate the certificate (HTTP-01
      per domain) and the nginx config.
- [ ] **Salons: several masters, one administrator** — the plan below, phase by phase.
- [ ] Master can change their page address and login email.
- [ ] Platform: delete a master (today only the master can delete their own account).
- [ ] Export of a master's bookings and clients (CSV).
- [ ] Move Mariam's salon onto the platform as a tenant (her own domain, data migrated).
- [ ] Platform overview: sign-ups per week, trial → paid conversion, revenue.
- [ ] Photos: stored in Postgres (fine for hundreds of masters); move to object storage
      before that becomes thousands.

## Salons

A salon is an organization with several masters and an owner (the salon's
administrator, who may also be one of its masters). An individual master is an
organization of one. Decided: one shared price list per salon; the owner manages
everything (every master's bookings, hours, days off, the price list); the owner
gets a Telegram message for every booking in the salon; guests may pick a master
or book "any available master".

Pricing per month, by active masters: 1–5 **$30**, 6–10 **$50**, 11+ **$80**;
individual masters keep the current price.

- [x] **Phase 1 — data model.** `organizations` holds billing, suspension and the
      price list; masters, logins (`role`: owner | master), bookings and booking
      zones point at it, with composite foreign keys keeping a booking inside its
      organization's price list. Every existing master became a solo organization
      with the same id. No change in behaviour.
- [x] **Phase 2 — salon backend.** `/api/salon` (owner only): the salon and its
      plan tier, add a master (one-time password shown once) or give the owner a
      calendar, deactivate / reactivate, who performs which services
      (`master_services`; a master's page offers only theirs), reset a master's
      password, all masters' bookings in one list, the owner's Telegram chat (every
      booking, with the master's name), and every master's calendar through the
      same routes a master uses (`routes/calendar.js`). The owner can hand a
      booking to another master. Locale (timezone, currency, languages) is the
      salon's; expenses are the organization's; financials are salon-wide for the
      owner (per master with `?masterId`) and own visits for a master. Sign-up
      takes `accountType: "salon"` (no screen yet).
  - [ ] Tell a master on Telegram when the owner adds, moves or cancels their
        visits, and both masters when a visit is handed over.
  - [ ] Deactivating a master leaves their future visits in place: offer to hand
        them to someone else or cancel them.
  - [ ] Turning a solo account into a salon (today a salon is chosen at sign-up).
- [x] **Phase 3 — sign-up and admin UI.** Sign-up asks "individual master or
      beauty salon" (a salon's owner may tick "I also work as a master"). A salon's
      owner gets a Masters screen (add — one-time password shown once — give
      themselves a calendar, choose each master's services, deactivate, reset a
      password), a master picker over Bookings / Availability / Landing page with
      "All masters" on Bookings, a master field in the booking form (hand a visit
      to another master), income by master on the dashboard, and the salon's
      name, locale, plan line and Telegram chat in Settings. A salon's master gets
      their own calendar, income and notification settings only. Minimum notice
      and booking window are per calendar (`/availability/settings`). Text in
      English, Russian and Armenian.
  - [x] **Income split.** The owner sets the masters' share of each visit (salon
        default 40%, editable in Settings; a master's own share on the Masters
        screen; the owner's own visits are all theirs). It's fixed on the booking
        when the visit is completed. A master sees only their share; the owner
        sees the whole income with their share beside it, and net is their share
        less expenses.
  - [x] **Taxes.** The owner lists the taxes on income (name, % of what the client
        paid) on a Taxes page — individual masters too. Per master: who pays
        them — the master out of their share, the salon out of its, or both,
        each on their own part; the owner's own visits are the salon's. Fixed on
        the visit when it's completed (`booking_taxes`). A master sees their
        share − their taxes = what's left; the owner sees income, their share,
        the salon's taxes, expenses and net, and per tax what's due and who
        covers it.
  - [ ] What each master is owed for a period, as a payout list the owner can
        mark paid.
  - [ ] Taxes not charged per visit: on the master's pay (income tax and social
        payments withheld from an employee), and on the salon's yearly profit.
  - [ ] A salon-wide day view: every master side by side as columns, for the
        front desk (today "All masters" is one list).
- [x] **Phase 4 — guest side.** A salon page at `<salon slug>.<domain>` (chosen at
      sign-up, editable in Settings; salon and master addresses are one namespace):
      its own landing page (edited as "Salon page" on the Landing page tab), its
      masters, the treatments its working masters perform, and their combined
      hours. After the basket the guest chooses "any available master" or one of
      the masters who do everything in it. "Any" shows the union of their free
      times and books the least busy free one, trying the next if the slot is
      lost. `?master=<id>` makes a salon page behave as that master's own page.
      Phone lookup, cancel, reschedule and calendar files work across the salon;
      masters' own pages keep working.
  - [ ] A salon's own domain (today only masters can have one).
  - [ ] Guest Telegram messages and manage links point at the master's page even
        for a visit booked on the salon's page.
- [ ] **Phase 5 — pricing.** Tier prices in `platform_settings`; a Lemon Squeezy
      variant per tier; adding the 6th / 11th master (or dropping below) switches
      the subscription's variant through the API.
- [ ] **Phase 6 — operator.** Organizations list (type, tier, masters, billing
      state) and an organization's page with its masters.

## 4. Engineering

- [ ] Run the test suite and lint on every push (GitHub Actions with a Postgres service).
- [ ] Run migrations as part of `deploy/deploy.sh` (today they're a separate manual step).
- [ ] Deploy without downtime (build the new backend image before stopping the old one).
- [ ] The rate limiter is in memory; fine for one backend process, needs a shared store if
      the backend is ever scaled out.
- [ ] Clean up the remaining lint warnings (three in the admin app).

## Known limitations (by design for now)

- DuckDNS staging needs two certificates (DuckDNS holds one challenge record at a time).
- One Telegram bot for the whole platform; Telegram's sending limits are generous but shared.
- Guest reminders are never sent between 21:00 and 09:00 in the master's timezone.

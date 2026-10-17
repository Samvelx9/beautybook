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
- [ ] **Phase 2 — salon backend.**
  - [ ] Which services each master performs (`master_services`); "any master"
        depends on it.
  - [ ] Owner routes `/api/salon/masters/:masterId/...` reusing the admin
        handlers (bookings, hours, blocks, profile) after checking the master is
        in the owner's organization; a combined bookings view across masters.
  - [ ] Add / deactivate a master, reset their password (temporary password shown
        once, like the operator's reset); the owner can give themselves a calendar.
  - [ ] Salon masters: the price list is read-only, no billing, no account deletion.
  - [ ] Expenses and financials at salon level (per master as a filter).
  - [ ] Owner's own Telegram chat, notified of every booking in the salon.
- [ ] **Phase 3 — sign-up and admin UI.** Sign-up asks "individual master or
      salon"; salon screens: Masters, all-masters Bookings (filter / a column per
      master), salon profile, price list with who-does-what.
- [ ] **Phase 4 — guest side.** A salon page at `<salon slug>.<domain>`: services →
      "any master" or a chosen one → slots. "Any" shows the union of the
      qualified masters' free slots and assigns a free one when booking (retry on
      a lost race). Masters' own pages keep working. Salon and master slugs share
      one namespace.
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

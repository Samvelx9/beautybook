# To do

Most urgent first. What's already built is in [DONE.md](DONE.md).

## 1. Now — security and data safety

- [ ] **Database backups.** There are none on the server — not for BeautyBook and not for
      anything else on the shared Postgres. Add a nightly `pg_dump` of each database, kept
      off the VM (e.g. object storage), and test a restore once.
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
- [ ] **Several specialists per salon** — one account currently means one calendar.
- [ ] Master can change their page address and login email.
- [ ] Platform: delete a master (today only the master can delete their own account).
- [ ] Export of a master's bookings and clients (CSV).
- [ ] Move Mariam's salon onto the platform as a tenant (her own domain, data migrated).
- [ ] Platform overview: sign-ups per week, trial → paid conversion, revenue.
- [ ] Photos: stored in Postgres (fine for hundreds of masters); move to object storage
      before that becomes thousands.

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

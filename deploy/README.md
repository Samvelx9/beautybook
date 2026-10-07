# Deploying

The platform runs on a VM with a shared nginx container and Postgres, as a separate stack: its own
database on the shared Postgres, its own backend container (`beautybook-backend`), and its
own nginx config file on the shared nginx container. Other sites on the VM are left alone.

## What's needed first

1. **A domain.** Point both `example.com` and `*.example.com` (A records) at the VM.
2. **A wildcard certificate** for `example.com` + `*.example.com`. Let's Encrypt only
   issues wildcards through a DNS challenge, so certbot needs API access to the DNS
   provider. With Cloudflare, for example:
   ```bash
   sudo apt install python3-certbot-dns-cloudflare
   # /root/.secrets/cloudflare.ini: dns_cloudflare_api_token = <token>
   sudo certbot certonly --dns-cloudflare --dns-cloudflare-credentials /root/.secrets/cloudflare.ini \
     -d example.com -d '*.example.com'
   ```
   Renewal then runs on its own; nginx picks the new certificate up on reload.
3. **A Telegram bot** from @BotFather (one for the whole platform).
4. **A Lemon Squeezy store** with a subscription product. Note its store id, the
   variant id, an API key, and create a webhook to `https://app.example.com/api/billing/webhook`
   for all `subscription_*` events (its signing secret goes in `.env`).

## First install

```bash
sudo mkdir -p /opt/beautybook && cd /opt/beautybook
sudo git clone https://github.com/<owner>/beautybook.git repo
sudo cp repo/deploy/docker-compose.yml .
sudo cp repo/server/.env.example .env && sudo nano .env   # fill in, PLATFORM_DOMAIN=example.com,
                                                          # PUBLIC_URL=https://app.example.com,
                                                          # DATABASE_URL=postgres://…@postgres:5432/beautybook

# the database, on the shared Postgres
sudo docker exec -it postgres psql -U postgres -c "CREATE ROLE beautybook LOGIN PASSWORD '…'" \
  -c "CREATE DATABASE beautybook OWNER beautybook"

# nginx
sed 's/__DOMAIN__/example.com/g' repo/deploy/nginx-platform.conf.template \
  | sudo tee /opt/nginx-setup/conf.d/beautybook.conf
sudo docker exec nginx nginx -t && sudo docker exec nginx nginx -s reload

bash repo/deploy/deploy.sh
```

## Migrations

Not part of `deploy.sh`. From a dev machine, through an SSH tunnel:

```bash
ssh -o ExitOnForwardFailure=yes -f -N -L 5433:127.0.0.1:5432 oracle-server
cd server && DATABASE_URL=postgres://beautybook:…@localhost:5433/beautybook npx node-pg-migrate up
```

## Redeploy

```bash
ssh oracle-server 'bash /opt/beautybook/repo/deploy/deploy.sh'
```

## Custom domains

A master's own domain is set on the Platform screen. It also needs, by hand for now: the
domain's DNS pointed at the VM, a certificate for it (`certbot certonly --webroot -w
/opt/nginx-setup/www -d annabeauty.com -d www.annabeauty.com`), and a server block like the
wildcard one with that `server_name`, the guest docroot, and the same `/api/` location.

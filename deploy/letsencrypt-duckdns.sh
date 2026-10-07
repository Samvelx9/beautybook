#!/usr/bin/env bash
# Let's Encrypt certificates for the platform on a DuckDNS subdomain:
#
#   sudo bash deploy/letsencrypt-duckdns.sh <subdomain>     # e.g. beautybook
#
# Needs the DuckDNS token in /etc/letsencrypt/duckdns.token (root-only).
# Issues two certificates — DuckDNS can hold only one challenge record at a
# time, so the bare name and the wildcard are separate orders:
#   <sub>.duckdns.org            → /etc/letsencrypt/live/<sub>.duckdns.org/
#   *.<sub>.duckdns.org          → /etc/letsencrypt/live/wildcard.<sub>.duckdns.org/
# Both renew with the server's certbot timer; the existing deploy hook reloads
# nginx afterwards.
set -euo pipefail
SUB=${1:?usage: letsencrypt-duckdns.sh <duckdns subdomain>}
DOMAIN="$SUB.duckdns.org"
HOOKS=/etc/letsencrypt/duckdns
[ -s /etc/letsencrypt/duckdns.token ] || { echo "missing /etc/letsencrypt/duckdns.token" >&2; exit 1; }

# The hooks live outside the repo: certbot remembers their paths for renewals.
mkdir -p $HOOKS
install -m 700 "$(dirname "$0")/certbot/duckdns-auth.sh" $HOOKS/auth.sh
install -m 700 "$(dirname "$0")/certbot/duckdns-cleanup.sh" $HOOKS/cleanup.sh

issue() { # <cert-name> <domain>
  certbot certonly --non-interactive --agree-tos --keep-until-expiring \
    --manual --preferred-challenges dns \
    --manual-auth-hook $HOOKS/auth.sh --manual-cleanup-hook $HOOKS/cleanup.sh \
    --key-type ecdsa --cert-name "$1" -d "$2"
}
issue "wildcard.$DOMAIN" "*.$DOMAIN"
issue "$DOMAIN" "$DOMAIN"

for name in "$DOMAIN" "wildcard.$DOMAIN"; do
  openssl x509 -in /etc/letsencrypt/live/$name/fullchain.pem -noout -subject -issuer -enddate
done

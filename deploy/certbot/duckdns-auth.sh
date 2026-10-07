#!/usr/bin/env bash
# certbot --manual-auth-hook for DuckDNS: publishes the DNS-01 challenge as
# the subdomain's TXT record, then waits until public DNS serves it.
#
# certbot sets CERTBOT_DOMAIN (e.g. "beautybook.duckdns.org", also for a
# wildcard) and CERTBOT_VALIDATION. The DuckDNS token is read from a root-only
# file and never put on a command line. DuckDNS keeps a single TXT value per
# subdomain, so each certificate order may validate only one name.
set -euo pipefail
TOKEN=$(cat /etc/letsencrypt/duckdns.token)
SUB=${CERTBOT_DOMAIN%.duckdns.org}

curl -fsS --config - <<CURL | grep -qx OK
url = "https://www.duckdns.org/update?domains=${SUB}&token=${TOKEN}&txt=${CERTBOT_VALIDATION}"
CURL

# Up to 3 minutes for the record to be visible from outside.
for _ in $(seq 36); do
  if curl -fsS "https://dns.google/resolve?name=_acme-challenge.${CERTBOT_DOMAIN}&type=TXT" \
     | grep -q "${CERTBOT_VALIDATION}"; then
    sleep 10   # let DuckDNS's other nameservers catch up too
    exit 0
  fi
  sleep 5
done
echo "TXT record not visible after 3 minutes" >&2
exit 1

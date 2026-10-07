#!/usr/bin/env bash
# certbot --manual-cleanup-hook for DuckDNS: clears the TXT record again.
set -euo pipefail
TOKEN=$(cat /etc/letsencrypt/duckdns.token)
SUB=${CERTBOT_DOMAIN%.duckdns.org}
curl -fsS --config - >/dev/null <<CURL
url = "https://www.duckdns.org/update?domains=${SUB}&token=${TOKEN}&txt=removed&clear=true"
CURL

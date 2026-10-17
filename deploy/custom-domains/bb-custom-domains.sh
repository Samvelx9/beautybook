#!/usr/bin/env bash
# Puts masters' own domains live, and takes removed ones down. Installed as
# /usr/local/sbin/bb-custom-domains and run every two minutes by
# bb-custom-domains.timer (see README.md here).
#
# For each master with a custom_domain:
#   1. it must be a plain domain name (checked again here: it goes into file
#      names and nginx config) and not served by another site on this server
#      — otherwise `conflict`;
#   2. it must resolve to this server — otherwise `waiting_dns`;
#   3. a port-80 server block goes in so Let's Encrypt can reach the
#      challenge, and certbot issues a certificate (www.<domain> too when it
#      points here) — on failure `failed`, retried with back-off, since Let's
#      Encrypt limits failed validations;
#   4. the full HTTPS block goes in — `active`.
# A bb-domain-*.conf whose domain no master has any more is removed. nginx is
# reloaded only after `nginx -t` passes; if it doesn't, this run's changes are
# undone.
#
# Only files named bb-domain-<domain>.conf in the nginx config folder are ever
# written or removed; other sites' configs are only read.
#
# Configuration: /etc/default/bb-custom-domains
#   SERVER_IP=…      the address the domains must point at (required)
# Every outside command can be replaced for testing: BB_PSQL, BB_NGINX,
# BB_CERTBOT, BB_RESOLVE, and the folders CONF_DIR, WEBROOT, LIVE_DIR, TEMPLATE.
set -euo pipefail
umask 022

[ -r /etc/default/bb-custom-domains ] && . /etc/default/bb-custom-domains
: "${SERVER_IP:?SERVER_IP is not set (/etc/default/bb-custom-domains)}"
CONF_DIR=${CONF_DIR:-/opt/nginx-setup/conf.d}
WEBROOT=${WEBROOT:-/opt/nginx-setup/www}
LIVE_DIR=${LIVE_DIR:-/etc/letsencrypt/live}
TEMPLATE=${TEMPLATE:-/usr/local/share/bb-custom-domains/custom-domain.conf.template}
# Inside the nginx container, the host's /etc/letsencrypt is mounted at the same path.
CERT_PREFIX=${CERT_PREFIX:-/etc/letsencrypt/live}

if [ -z "${BB_PSQL:-}" ]; then
  PGUSER=$(docker exec postgres printenv POSTGRES_USER)
  BB_PSQL="docker exec -i postgres psql -U $PGUSER -d beautybook"
fi
BB_NGINX=${BB_NGINX:-docker exec nginx nginx}
BB_CERTBOT=${BB_CERTBOT:-certbot}
BB_RESOLVE=${BB_RESOLVE:-getent ahostsv4}

exec 9>"${LOCK_FILE:-/run/bb-custom-domains.lock}"
flock -n 9 || exit 0

DOMAIN_RE='^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'
valid_domain() { [ "${#1}" -le 253 ] && [[ $1 =~ $DOMAIN_RE ]]; }

sql() { $BB_PSQL -qAtX -v ON_ERROR_STOP=1 -c "$1"; }

# Every value written is either a validated domain, a number, or one of the
# fixed statuses below — nothing else reaches the SQL.
set_status() { # <id> <domain> <status> [attempts]
  local attempts=${4:-}
  local extra=''
  [ -n "$attempts" ] && extra=", custom_domain_attempts = $attempts"
  sql "UPDATE masters SET custom_domain_status = '$3', custom_domain_checked_at = now()$extra
       WHERE id = $1 AND custom_domain = '$2'" >/dev/null
}

resolves_here() { $BB_RESOLVE "$1" 2>/dev/null | awk '{print $1}' | grep -qx "$SERVER_IP"; }

# Another site on this server already answers for the name.
served_elsewhere() {
  local f
  for f in "$CONF_DIR"/*.conf; do
    [ -e "$f" ] || continue
    case "$(basename "$f")" in bb-domain-*) continue ;; esac
    grep -Eq "server_name[^;]*[[:space:]](www\.)?${1//./\\.}([[:space:]]|;)" "$f" && return 0
  done
  return 1
}

render() { # <names> <cert dir> <with https: 0|1>
  local body
  body=$(sed -e "s|__NAMES__|$1|g" -e "s|__CERT__|$2|g" "$TEMPLATE")
  if [ "$3" = 1 ]; then printf '%s\n' "$body"; else printf '%s\n' "${body%%#HTTPS*}"; fi
}

CHANGED=()   # files written this run, with their previous content kept beside them
write_conf() { # <file> <content>
  if [ -f "$1" ] && [ "$(cat "$1")" = "$2" ]; then return 1; fi
  [ -f "$1" ] && cp "$1" "$1.bb-prev" || : > "$1.bb-new"
  printf '%s\n' "$2" > "$1.tmp" && mv "$1.tmp" "$1"
  CHANGED+=("$1")
  return 0
}
undo_changes() {
  local f
  for f in "${CHANGED[@]}"; do
    if [ -f "$f.bb-prev" ]; then mv "$f.bb-prev" "$f"; else rm -f "$f" "$f.bb-new"; fi
  done
}
forget_backups() { local f; for f in "${CHANGED[@]}"; do rm -f "$f.bb-prev" "$f.bb-new"; done; }

reload_nginx() {
  if $BB_NGINX -t >/dev/null 2>&1; then
    $BB_NGINX -s reload >/dev/null
    forget_backups
    return 0
  fi
  echo "nginx -t failed — undoing this run's changes" >&2
  undo_changes
  return 1
}

NOW=$(date +%s)
declare -A WANTED=()

# Read first, on its own: if the database can't be asked, the run stops here —
# an empty answer must never look like "no domains" and take them all down.
ROWS=$(sql "SELECT id, custom_domain, COALESCE(custom_domain_status, ''),
                   COALESCE(EXTRACT(EPOCH FROM custom_domain_checked_at)::bigint, 0),
                   custom_domain_attempts
            FROM masters WHERE custom_domain IS NOT NULL ORDER BY id")

while IFS='|' read -r id domain status checked attempts; do
  [ -n "$id" ] || continue
  if ! valid_domain "$domain"; then
    echo "skipping master $id: not a plain domain name" >&2
    continue
  fi
  WANTED[$domain]=1
  file="$CONF_DIR/bb-domain-$domain.conf"
  cert="$LIVE_DIR/bb-$domain"

  if served_elsewhere "$domain"; then
    [ "$status" = conflict ] || set_status "$id" "$domain" conflict
    continue
  fi
  if ! resolves_here "$domain"; then
    [ "$status" = waiting_dns ] || set_status "$id" "$domain" waiting_dns
    continue
  fi
  names="$domain"
  resolves_here "www.$domain" && names="$domain www.$domain"

  if [ ! -s "$cert/fullchain.pem" ]; then
    # Back-off after failures: 5 min, 10, 20 … up to 6 hours.
    if [ "$status" = failed ]; then
      wait=$(( 300 * (1 << (attempts > 6 ? 6 : attempts)) ))
      [ "$wait" -gt 21600 ] && wait=21600
      [ $(( NOW - checked )) -lt "$wait" ] && continue
    fi
    # Stage one: the challenge has to be reachable before there's a certificate.
    if write_conf "$file" "$(render "$names" "$CERT_PREFIX/bb-$domain" 0)"; then
      reload_nginx || { set_status "$id" "$domain" failed $((attempts + 1)); continue; }
      CHANGED=()
    fi
    domain_args=()
    for n in $names; do domain_args+=(-d "$n"); done
    if ! $BB_CERTBOT certonly --webroot -w "$WEBROOT" --cert-name "bb-$domain" "${domain_args[@]}" \
         --non-interactive --agree-tos --register-unsafely-without-email --keep-until-expiring >/dev/null 2>&1; then
      echo "certificate for $domain failed (attempt $((attempts + 1)))" >&2
      set_status "$id" "$domain" failed $((attempts + 1))
      continue
    fi
  fi

  if write_conf "$file" "$(render "$names" "$CERT_PREFIX/bb-$domain" 1)"; then
    if ! reload_nginx; then
      set_status "$id" "$domain" failed $((attempts + 1))
      CHANGED=()
      continue
    fi
    CHANGED=()
  fi
  [ "$status" = active ] || set_status "$id" "$domain" active 0
done <<< "$(printf '%s' "$ROWS" | tr -d '\r')"

# Domains no master has any more come down; their certificates are left to expire.
removed=0
for f in "$CONF_DIR"/bb-domain-*.conf; do
  [ -e "$f" ] || continue
  domain=$(basename "$f" .conf); domain=${domain#bb-domain-}
  if [ -z "${WANTED[$domain]:-}" ]; then
    cp "$f" "$f.bb-prev" && rm "$f"
    CHANGED+=("$f")
    removed=1
  fi
done
if [ "$removed" = 1 ]; then reload_nginx || true; fi

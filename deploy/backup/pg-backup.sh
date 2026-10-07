#!/usr/bin/env bash
# Nightly backups of every database on the shared Postgres container, with
# daily / weekly / monthly retention. Installed as /usr/local/sbin/pg-backup
# and run by pg-backup.timer (see deploy/backup/README.md).
#
#   daily/    one per night, newest KEEP_DAILY kept
#   weekly/   the Sunday backup, newest KEEP_WEEKLY kept
#   monthly/  the backup of the 1st, newest KEEP_MONTHLY kept
#
# Weekly and monthly entries are hard links to the night's daily files, so they
# cost no extra space until the daily copy is pruned. Each dump is written to a
# temporary file and checked with pg_restore --list before it's kept; any
# failure stops the run before pruning, so a bad night never deletes good
# backups. Dumps contain personal data: everything is root-only.
set -euo pipefail
umask 077

CONTAINER=${PG_CONTAINER:-postgres}
ROOT=${BACKUP_ROOT:-/var/backups/postgres}
KEEP_DAILY=${KEEP_DAILY:-7}
KEEP_WEEKLY=${KEEP_WEEKLY:-5}
KEEP_MONTHLY=${KEEP_MONTHLY:-12}

exec 9>/run/pg-backup.lock
flock -n 9 || { echo "another backup is running"; exit 1; }

# The container's superuser, from its own environment.
PGUSER=$(docker exec "$CONTAINER" printenv POSTGRES_USER)
psql_c() { docker exec "$CONTAINER" psql -U "$PGUSER" -d postgres -Atc "$1"; }

STAMP=$(date -u +%Y-%m-%d)
NIGHT="$ROOT/daily/$STAMP"
mkdir -p "$ROOT/daily" "$ROOT/weekly" "$ROOT/monthly"
chmod 700 "$ROOT"
rm -rf "$NIGHT.partial"
mkdir -p "$NIGHT.partial"

for db in $(psql_c "SELECT datname FROM pg_database WHERE NOT datistemplate AND datname <> 'postgres' ORDER BY 1"); do
  out="$NIGHT.partial/$db.dump"
  docker exec "$CONTAINER" pg_dump -U "$PGUSER" -Fc -Z 6 "$db" > "$out"
  # A dump pg_restore can't read is no backup.
  docker exec -i "$CONTAINER" pg_restore --list < "$out" > /dev/null
  echo "$db: $(du -h "$out" | cut -f1)"
done
# Roles and their passwords — needed to restore onto a fresh server.
docker exec "$CONTAINER" pg_dumpall -U "$PGUSER" --globals-only > "$NIGHT.partial/globals.sql"

rm -rf "$NIGHT" && mv "$NIGHT.partial" "$NIGHT"

link_into() { # <dir>
  rm -rf "$1/$STAMP" && mkdir -p "$1/$STAMP"
  ln "$NIGHT"/* "$1/$STAMP/"
}
[ "$(date -u +%u)" = 7 ] && link_into "$ROOT/weekly"
[ "$(date -u +%d)" = 01 ] && link_into "$ROOT/monthly"

prune() { # <dir> <keep>
  ls -1 "$1" | grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' | sort -r | tail -n +"$(( $2 + 1 ))" \
    | while read -r old; do rm -rf "${1:?}/$old"; done
}
prune "$ROOT/daily" "$KEEP_DAILY"
prune "$ROOT/weekly" "$KEEP_WEEKLY"
prune "$ROOT/monthly" "$KEEP_MONTHLY"

echo "backup $STAMP done — daily: $(ls "$ROOT/daily" | wc -l), weekly: $(ls "$ROOT/weekly" | wc -l), monthly: $(ls "$ROOT/monthly" | wc -l), total $(du -sh "$ROOT" | cut -f1)"

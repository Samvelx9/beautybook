# Database backups

`pg-backup.sh` backs up **every database** on the shared Postgres container (found
automatically, so new ones are included) plus the roles, every night at 23:30 UTC
(03:30 in Yerevan), through `pg-backup.timer`. A night missed while the server was off
runs as soon as it's back.

```
/var/backups/postgres/            root-only (the dumps contain personal data)
  daily/YYYY-MM-DD/               newest 7 kept
  weekly/YYYY-MM-DD/              the Sunday (UTC) backup, newest 5 kept
  monthly/YYYY-MM-DD/             the backup of the 1st, newest 12 kept
    <database>.dump               pg_dump custom format
    globals.sql                   roles (pg_dumpall --globals-only)
```

Weekly and monthly entries are hard links to the night's files, so they take no extra
space. Every dump is checked with `pg_restore --list` before it's kept, and a failed run
stops before pruning, so a bad night never removes good backups.

**These backups live on the same server.** They protect against mistakes and bad
deploys, not against losing the VM — copy them off the server too (see TODO.md).

## Install / update

```bash
sudo install -m 700 deploy/backup/pg-backup.sh /usr/local/sbin/pg-backup
sudo install -m 644 deploy/backup/pg-backup.service deploy/backup/pg-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now pg-backup.timer
```

## Check

```bash
systemctl list-timers pg-backup.timer
journalctl -u pg-backup.service -n 20
sudo ls /var/backups/postgres/*/
```

## Restore

Into a scratch database first, to look before touching the live one:

```bash
D=/var/backups/postgres/daily/2026-10-08          # pick a backup
sudo docker exec postgres sh -c 'createdb -U "$POSTGRES_USER" restore_check'
sudo cat $D/beautybook.dump | sudo docker exec -i postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d restore_check --no-owner'
# ... inspect, then drop it:
sudo docker exec postgres sh -c 'dropdb -U "$POSTGRES_USER" restore_check'
```

Replacing a live database: stop the app that uses it, then restore with `--clean
--if-exists` into that database, and start the app again.

#!/usr/bin/env bash
# Restore-drill: latest dump → clean Postgres volume → checksum MATCH.
# Creates and removes the drill service/volume itself (safe to re-run).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BACKUP_DIR="$ROOT/backups"
CHECKSUM_SQL="SELECT count(*) || '|' || coalesce(sum(total_amount_cents), 0) FROM orders"

if [ -n "${EPOCHREALTIME:-}" ]; then
  now_ms() { local t="${EPOCHREALTIME/[.,]/}"; echo "${t:0:${#t}-3}"; }
else
  now_ms() { perl -MTime::HiRes -e 'printf("%.0f\n", Time::HiRes::time()*1000)'; }
fi
secs() { awk -v ms="$1" 'BEGIN { printf "%.1f", ms / 1000 }'; }

if [ -n "${DATABASE_URL:-}" ]; then
  DB_USER="$(node -e 'const u=new URL(process.env.DATABASE_URL); process.stdout.write(decodeURIComponent(u.username||""))')"
  DB_PASSWORD="$(node -e 'const u=new URL(process.env.DATABASE_URL); process.stdout.write(decodeURIComponent(u.password||""))')"
  DB_NAME="$(node -e 'const u=new URL(process.env.DATABASE_URL); process.stdout.write(u.pathname.replace(/^\//,""))')"
elif [ -n "${DB_HOST:-}" ]; then
  : "${DB_USER:?DB_USER is required when DB_HOST is set}"
  : "${DB_PASSWORD:?DB_PASSWORD is required when DB_HOST is set}"
  : "${DB_NAME:?DB_NAME is required when DB_HOST is set}"
else
  echo "DATABASE_URL or DB_HOST/DB_USER/DB_PASSWORD/DB_NAME required" >&2
  exit 1
fi

DUMP="$(ls -t "$BACKUP_DIR"/shop-*.dump 2>/dev/null | head -1 || true)"
if [ -z "$DUMP" ] || [ ! -f "$DUMP" ]; then
  echo "No dump in $BACKUP_DIR — run: bash scripts/with-secrets.sh dev bash scripts/backup.sh" >&2
  exit 1
fi

echo "dump: $DUMP ($(du -h "$DUMP" | cut -f1))"

BEFORE="$(
  docker compose exec -T \
    -e PGPASSWORD="$DB_PASSWORD" \
    db \
    psql -U "$DB_USER" -d "$DB_NAME" -Atc "$CHECKSUM_SQL"
)"
echo "orders before: $BEFORE  (count|sum(total_amount_cents))"

# Wipe previous drill so restore never hits a non-empty volume.
docker compose --profile drill rm -sf restore >/dev/null 2>&1 || true
docker volume rm -f marketplace_pgdata-restore >/dev/null 2>&1 || true

docker compose --profile drill up -d --wait restore

TABLES="$(
  docker compose exec -T restore \
    psql -U admin -d shop -Atc \
    "SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tablename = 'orders'"
)"
if [ "$TABLES" != "0" ]; then
  echo "restore DB is not empty (orders present) — abort" >&2
  exit 1
fi

REMOTE="/tmp/restore.dump"
docker compose cp "$DUMP" "restore:${REMOTE}" >/dev/null 2>&1

T0="$(now_ms)"
docker compose exec -T restore \
  pg_restore -U admin -d shop --no-owner --no-acl "$REMOTE"
RESTORE_MS="$(( $(now_ms) - T0 ))"

AFTER="$(
  docker compose exec -T restore \
    psql -U admin -d shop -Atc "$CHECKSUM_SQL"
)"
echo "orders after:  $AFTER"
echo "restore wall:  $(secs "$RESTORE_MS") s"

# Always tear down drill environment (success or fail after restore attempt).
cleanup() {
  docker compose --profile drill rm -sf restore >/dev/null 2>&1 || true
  docker volume rm -f marketplace_pgdata-restore >/dev/null 2>&1 || true
}
trap cleanup EXIT

if [ "$BEFORE" = "$AFTER" ]; then
  echo "MATCH"
  exit 0
fi

echo "MISMATCH: before='$BEFORE' after='$AFTER'" >&2
exit 1

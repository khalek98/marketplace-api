#!/usr/bin/env bash
# Logical backup of marketplace DB (pg_dump -Fc via compose Postgres image).
# Credentials from env (with-secrets.sh / SKIP_VAULT=1). Destination: ./backups/
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BACKUP_DIR="$ROOT/backups"
mkdir -p "$BACKUP_DIR"

DATE="$(date +%Y-%m-%d)"
OUT="$BACKUP_DIR/shop-${DATE}.dump"
REMOTE="/tmp/shop-${DATE}.dump"

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

if [ -z "$DB_USER" ] || [ -z "$DB_PASSWORD" ] || [ -z "$DB_NAME" ]; then
  echo "Could not resolve DB user/password/name from env" >&2
  exit 1
fi

# Compose Postgres image matches server major (host brew client may not).
# Write inside the container, then copy out — binary-safe (no stdout pipe).
docker compose exec -T \
  -e PGPASSWORD="$DB_PASSWORD" \
  db \
  pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc -f "$REMOTE"

docker compose cp "db:${REMOTE}" "$OUT" >/dev/null 2>&1
docker compose exec -T db rm -f "$REMOTE" >/dev/null 2>&1

echo "$OUT"

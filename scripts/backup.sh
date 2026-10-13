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

if [ -n "${DATABASE_URL:-}" ]; then
  DB_USER="$(node -e 'const u=new URL(process.env.DATABASE_URL); process.stdout.write(decodeURIComponent(u.username||""))')"
  DB_PASSWORD="$(node -e 'const u=new URL(process.env.DATABASE_URL); process.stdout.write(decodeURIComponent(u.password||""))')"
  DB_NAME="$(node -e 'const u=new URL(process.env.DATABASE_URL); process.stdout.write(u.pathname.replace(/^\//,""))')"
  DB_HOST="$(node -e 'const u=new URL(process.env.DATABASE_URL); process.stdout.write(u.hostname)')"
  DB_PORT="$(node -e 'const u=new URL(process.env.DATABASE_URL); process.stdout.write(u.port||"5432")')"
elif [ -n "${DB_HOST:-}" ]; then
  : "${DB_PORT:?DB_PORT is required when DB_HOST is set}"
  : "${DB_USER:?DB_USER is required when DB_HOST is set}"
  : "${DB_PASSWORD:?DB_PASSWORD is required when DB_HOST is set}"
  : "${DB_NAME:?DB_NAME is required when DB_HOST is set}"
else
  echo "DATABASE_URL or DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME required" >&2
  exit 1
fi

if [ -z "$DB_HOST" ] || [ -z "$DB_PORT" ] || [ -z "$DB_USER" ] || [ -z "$DB_PASSWORD" ] || [ -z "$DB_NAME" ]; then
  echo "Could not resolve DB host/port/user/password/name from env" >&2
  exit 1
fi

# Client is the compose Postgres image: a host pg_dump is often an older major
# than postgres:16. It dials DB_HOST:DB_PORT for real.
# Loopback inside the container is not the operator machine, so 127.0.0.1 is
# rewritten to host.docker.internal; the port stays the one from env.
# Transaction-mode PgBouncer (21111) is the wrong target — pg_dump needs a session.
DUMP_HOST="$DB_HOST"
case "$DB_HOST" in
  127.0.0.1 | localhost | ::1) DUMP_HOST="host.docker.internal" ;;
esac

docker compose run --rm -T --no-deps \
  --add-host=host.docker.internal:host-gateway \
  -e PGPASSWORD="$DB_PASSWORD" \
  -v "$BACKUP_DIR:/backups" \
  --entrypoint pg_dump \
  db \
  -h "$DUMP_HOST" \
  -p "$DB_PORT" \
  -U "$DB_USER" \
  -d "$DB_NAME" \
  -Fc \
  -f "/backups/$(basename "$OUT")"

echo "$OUT"

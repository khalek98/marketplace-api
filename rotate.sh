#!/usr/bin/env bash
# Alternating-user password rotation WITHOUT restarting the API process.
#
# Two roles (app_user_a / app_user_b). We rotate the INACTIVE one first, then
# switch secrets/db_auth to it, then terminate backends of the OLD user.
# That closes the window where ALTER already changed the password but the
# file still has the old value (single-user rotation problem).
#
# Order:
#   1. ALTER ROLE on the next (inactive) user
#   2. Atomically rewrite secrets/db_auth (user + password)
#   3. Terminate backends of the previous user
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

AUTH_FILE=secrets/db_auth
if [[ ! -f "$AUTH_FILE" ]]; then
  echo "Missing ${AUTH_FILE}. Create it from secrets/db_auth.example" >&2
  exit 1
fi

CURRENT_USER=$(head -n1 "$AUTH_FILE")
if [ "$CURRENT_USER" = "app_user_a" ]; then
  NEXT_USER=app_user_b
else
  NEXT_USER=app_user_a
fi

NEW_PASSWORD="app-$(openssl rand -hex 8)"

echo "1. ALTER ROLE ${NEXT_USER} in Postgres (inactive user)…"
docker compose exec -T db psql -U admin -d shop \
  -c "ALTER ROLE ${NEXT_USER} WITH PASSWORD '${NEW_PASSWORD}';" >/dev/null

echo "2. Switching secrets/db_auth → ${NEXT_USER}…"
mkdir -p secrets
printf '%s\n%s' "$NEXT_USER" "$NEW_PASSWORD" > "${AUTH_FILE}.tmp"
mv "${AUTH_FILE}.tmp" "$AUTH_FILE"

echo "3. Closing old ${CURRENT_USER} connections…"
docker compose exec -T db psql -U admin -d shop -tA \
  -c "SELECT count(pg_terminate_backend(pid)) FROM pg_stat_activity WHERE usename = '${CURRENT_USER}';"

echo "Done: active role is ${NEXT_USER}, password ${NEW_PASSWORD:0:6}… is in DB and in the file."

PORT=$(grep -E '^PORT=' .env 2>/dev/null | cut -d= -f2- | tr -d '\r' || true)
echo "App was NOT restarted — check: curl -s localhost:${PORT:-3000}/db"

#!/usr/bin/env bash
# Rotate app_user password WITHOUT restarting the API process.
#
# Order matters:
#   1. ALTER ROLE in Postgres (new password becomes truth)
#   2. Update secrets/db_password (new connections read the new value)
#   3. Terminate old app_user backends so the next query opens a fresh connection
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

NEW_PASSWORD="app-$(openssl rand -hex 8)"

echo "1. ALTER ROLE in Postgres…"
docker compose exec -T db psql -U admin -d shop \
  -c "ALTER ROLE app_user WITH PASSWORD '${NEW_PASSWORD}';" >/dev/null

echo "2. Updating secrets/db_password…"
mkdir -p secrets
printf '%s' "${NEW_PASSWORD}" > secrets/db_password

echo "3. Closing old app_user connections…"
docker compose exec -T db psql -U admin -d shop -tA \
  -c "SELECT count(pg_terminate_backend(pid)) FROM pg_stat_activity WHERE usename = 'app_user';"

echo "Done: new password ${NEW_PASSWORD:0:6}… is in DB and in the file."
echo "App was NOT restarted — check: curl -s localhost:${PORT:-3000}/db"

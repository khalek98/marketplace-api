#!/usr/bin/env bash
# Inject secrets via Infisical, then exec the given command.
# Usage: bash scripts/with-secrets.sh [env] <command…>
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INFISICAL_DIR="$ROOT/infisical"

ENV_SLUG="${1:-dev}"
shift || true
[ "$#" -gt 0 ] || set -- npm run start

if [ "${SKIP_VAULT:-0}" = "1" ]; then exec "$@"; fi

CREDS="$INFISICAL_DIR/.secrets/machine-identity.env"
if [ ! -f "$CREDS" ]; then
  echo "✗ There is no $CREDS — copy machine-identity.env.example (see README)" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$CREDS"
set +a

TOKEN_CACHE="$INFISICAL_DIR/.secrets/machine-token"
if [ -f "$TOKEN_CACHE" ] && [ -n "$(find "$TOKEN_CACHE" -mmin -60 2>/dev/null)" ]; then
  INFISICAL_TOKEN="$(cat "$TOKEN_CACHE")"
else
  INFISICAL_TOKEN="$(infisical login --method=universal-auth \
    --client-id="$INFISICAL_CLIENT_ID" \
    --client-secret="$INFISICAL_CLIENT_SECRET" \
    --domain="$INFISICAL_URL" --silent --plain)"
  (umask 077; printf '%s' "$INFISICAL_TOKEN" > "$TOKEN_CACHE")
fi
export INFISICAL_TOKEN

unset INFISICAL_CLIENT_ID INFISICAL_CLIENT_SECRET

WATCH_FLAGS=()
[ "${WATCH:-0}" = "1" ] && WATCH_FLAGS=(--watch --watch-interval="${WATCH_INTERVAL:-5}")

cd "$ROOT"
exec infisical run \
  --domain="$INFISICAL_URL" \
  --projectId="$INFISICAL_PROJECT_ID" \
  --project-config-dir="$INFISICAL_DIR" \
  --env="$ENV_SLUG" \
  ${WATCH_FLAGS[@]+"${WATCH_FLAGS[@]}"} \
  --silent \
  -- "$@"

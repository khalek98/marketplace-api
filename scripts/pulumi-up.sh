#!/usr/bin/env bash
# Apply the infra stack (file backend). Secrets come from with-secrets / SKIP_VAULT exports.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

node scripts/require-vault-env.mjs

export PULUMI_BACKEND_URL="${PULUMI_BACKEND_URL:-file://$ROOT/.pulumi}"
export PULUMI_SKIP_UPDATE_CHECK="${PULUMI_SKIP_UPDATE_CHECK:-true}"

if ! command -v pulumi >/dev/null 2>&1; then
  echo "pulumi CLI not found — install: https://www.pulumi.com/docs/install/" >&2
  exit 1
fi

cd "$ROOT/infra"
npm ci --silent
if ! pulumi stack select dev --non-interactive 2>/dev/null; then
  pulumi stack init dev --non-interactive
fi
pulumi up --yes --non-interactive

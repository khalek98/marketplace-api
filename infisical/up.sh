#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

command -v infisical >/dev/null || {
  echo "✗ Infisical CLI is not installed. Run: npm i -g @infisical/cli" >&2
  exit 1
}

echo "Starting containers (compose project marketplace-infisical)"
docker compose up -d --wait

echo "Waiting for API to be ready on :21150"
for i in $(seq 1 90); do
  if curl -fsS -m 2 http://localhost:21150/api/status >/dev/null 2>&1; then break; fi
  sleep 1
  [ "$i" = "90" ] && { echo "✗ API did not start within 90 seconds. Log: docker logs marketplace-infisical-app" >&2; exit 1; }
done

# echo -e "${C_D}── 3/3 заповнюю сховище через REST API ──${C_N}"
# node bootstrap.mjs

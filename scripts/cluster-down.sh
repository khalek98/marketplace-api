#!/usr/bin/env bash
# Tear down only this project's kind cluster.
set -uo pipefail
cd "$(dirname "$0")/.."

CLUSTER_NAME="${CLUSTER_NAME:-marketplace}"

if ! command -v kind >/dev/null 2>&1; then
  echo "kind not found — nothing to delete" >&2
  exit 0
fi

kind delete cluster --name "$CLUSTER_NAME"

# kind leaves the shared `kind` docker network behind; remove only if empty.
if [ "$(docker network inspect kind --format '{{len .Containers}}' 2>/dev/null || echo 1)" = "0" ]; then
  docker network rm kind >/dev/null 2>&1 && echo "removed empty docker network 'kind'"
fi

echo "cluster ${CLUSTER_NAME} deleted"

#!/usr/bin/env bash
# Create kind cluster (if missing) and load the local production image.
# Without `kind load`, pods stay in ErrImagePull — the image exists only on the host.
set -euo pipefail
cd "$(dirname "$0")/.."

CLUSTER_NAME="${CLUSTER_NAME:-marketplace}"
IMAGE="${IMAGE:-marketplace-api:local}"
CONTEXT="kind-${CLUSTER_NAME}"
CONFIG="k8s/kind-config.yaml"

if ! command -v kind >/dev/null 2>&1; then
  echo "kind not found. Install: https://kind.sigs.k8s.io/docs/user/quick-start/#installation" >&2
  exit 1
fi
if ! command -v kubectl >/dev/null 2>&1; then
  echo "kubectl not found" >&2
  exit 1
fi
if ! command -v docker >/dev/null 2>&1; then
  echo "docker not found" >&2
  exit 1
fi

NETS=$(docker network ls -q | wc -l | tr -d ' ')
if [ "$NETS" -ge 28 ]; then
  echo "⚠ Docker networks: $NETS (kind create often fails near ~31 with address pools exhausted)."
  echo "  Remove empty networks by name — do NOT run docker network prune:"
  docker network ls --format '{{.Name}}' | while read -r n; do
    [ "$(docker network inspect "$n" --format '{{len .Containers}}' 2>/dev/null || echo 1)" = "0" ] && echo "   docker network rm $n"
  done
fi

if kind get clusters 2>/dev/null | grep -qx "$CLUSTER_NAME"; then
  echo "cluster ${CLUSTER_NAME} already up"
else
  echo "creating kind cluster ${CLUSTER_NAME}…"
  kind create cluster --name "$CLUSTER_NAME" --config "$CONFIG"
fi

kubectl --context "$CONTEXT" wait --for=condition=Ready node --all --timeout=120s

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "image ${IMAGE} missing — run: npm run image:build" >&2
  exit 1
fi

echo "→ kind load docker-image ${IMAGE} --name ${CLUSTER_NAME}"
kind load docker-image "$IMAGE" --name "$CLUSTER_NAME"

echo "nodes:"
kubectl --context "$CONTEXT" get nodes
echo "kubecontext: ${CONTEXT}"
echo "image in node (crictl):"
CP=$(docker ps --filter "name=${CLUSTER_NAME}-control-plane" --format '{{.Names}}' | head -1)
if [ -n "$CP" ]; then
  docker exec "$CP" crictl images 2>/dev/null | grep -E 'marketplace-api|IMAGE' || \
    docker exec "$CP" crictl images 2>/dev/null | head -20
fi

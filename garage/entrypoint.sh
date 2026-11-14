#!/bin/sh
# The upstream image has no shell, so this wrapper owns startup:
# the server stays in the background until the bucket exists, then we
# wait on it. Docker's healthcheck flips green only after bootstrap.
set -eu

garage -c /etc/garage.toml server &
server_pid=$!

cleanup() {
  kill "$server_pid" 2>/dev/null || true
  wait "$server_pid" 2>/dev/null || true
}
trap cleanup TERM INT

if ! node /opt/bootstrap.mjs; then
  cleanup
  exit 1
fi

wait "$server_pid"

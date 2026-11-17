#!/usr/bin/env bash
# Load generator for demo:rollout. One line per request = HTTP code only.
# curl 000 = no response (connection refused / reset) when hitting NodePort directly.
set -uo pipefail
URL="$1"
DURATION="$2"
WORKERS="$3"
OUT="$4"

rm -f "$OUT" "$OUT".w* "$OUT".done
END=$(( $(date +%s) + DURATION ))

for w in $(seq 1 "$WORKERS"); do
  (
    while [ "$(date +%s)" -lt "$END" ]; do
      curl -s -o /dev/null --max-time 2 -w '%{http_code}\n' "$URL" >> "$OUT.w$w" 2>/dev/null || echo "000" >> "$OUT.w$w"
    done
  ) &
done
wait
cat "$OUT".w* > "$OUT" 2>/dev/null
rm -f "$OUT".w*
touch "$OUT".done

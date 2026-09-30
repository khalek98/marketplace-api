# Restore drill protocol

Date (local): **2026-09-30**  
UTC: from-zero checklist after `docker compose down -v` + migrate + seed

## Artifact

| Field | Value |
| --- | --- |
| Dump file | `backups/shop-2026-09-30.dump` |
| Format | `pg_dump -Fc` (custom) |
| Size | ~24–28 KiB (`du` / `ls`) |
| Checksum query | `SELECT count(*) \|\| '\|' \|\| coalesce(sum(total_amount_cents), 0) FROM orders` |
| Before / after | `10\|23986000` → `10\|23986000` |
| Result | **MATCH** (also on immediate re-run) |

## RTO / RPO

| Metric | Value | How derived |
| --- | --- | --- |
| **RTO** | **0.5 seconds** (pg_restore wall clock on this drill) | Printed by `scripts/restore-drill.sh` as `restore wall` — time of `pg_restore` into a clean container (includes `docker compose exec` overhead). Full operator path «підняти порожній Postgres + restore» on this machine is on the order of **~5–8 seconds** including `compose up --wait`. |
| **RPO** | **up to 24 hours** | `backup.cron` runs once nightly (`0 3 * * *`). Worst case: failure just before the next run → lose almost a full day since the last dump. Tighter RPO needs WAL archive + PITR (out of scope for this milestone). |

## How to re-run

```bash
docker compose up -d --wait
export SKIP_VAULT=1
export DB_HOST=127.0.0.1 DB_PORT=21111 DB_USER=app_user_a DB_PASSWORD=app-v1-password DB_NAME=shop
bash scripts/with-secrets.sh dev bash scripts/backup.sh
bash scripts/with-secrets.sh dev bash scripts/restore-drill.sh
```

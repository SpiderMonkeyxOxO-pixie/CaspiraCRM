# 09 — Database roles and running migrations

**Who:** Deployment Operator. **Where:** host shell, in `/opt/caspira/deploy/production`.

## Roles (least privilege)
| Role | Used by | Can |
|------|---------|-----|
| `caspira_owner` | migrator only | Owns the `public` and `analytics` schemas; can create schemas and trusted extensions |
| `caspira_app` | API and worker | Select, insert, update and delete on application tables; no DDL. Refreshes analytics only through `analytics.refresh_view()`. Timeouts: statement 60 s, lock 10 s, idle-in-transaction 60 s. |
| `caspira_readonly` | reporting | Read-only (`default_transaction_read_only`) |
| `caspira_monitor` | metrics | `pg_monitor` |
| `postgres` | init and pgBackRest | Local socket only; never used by the application |

New clusters get these roles from `postgres/init/10-roles.sh`.

**Existing databases** (the one-time move off the single application user):
1. Take a verified backup ([runbook 11](11-on-demand-backup.md) and [runbook 13](13-verify-a-backup.md)).
2. Run:
   ```bash
   docker compose --env-file env/production.env exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -h /var/run/postgresql -U postgres -d caspira_crm \
     -v app_pw="$(cat /run/secrets/db_password)" -v owner_pw="$(cat /run/secrets/db_migrator_password)" \
     -v ro_pw="$(cat /run/secrets/db_readonly_password)" -v mon_pw="$(cat /run/secrets/db_monitor_password)" \
     -v old_owner=caspira -f /etc/caspira/roles-upgrade.sql'
   ```
   The script is idempotent. It reassigns ownership to `caspira_owner` and disables login for the old user.

The restore drill runs both scripts against a restored copy of real (non-production) data, and proves that the runtime role can't create or drop tables.

## Running migrations
1. **Preflight** (read-only):
   ```bash
   docker compose --env-file env/production.env --profile migrate run --rm migrate node scripts/migrate.js --check
   ```
   It checks for unfinished or failed migrations, `EXPECTED_SCHEMA_VERSION`, unknown applied migrations (a schema newer than the release) and required extensions.
2. **Apply:**
   ```bash
   docker compose --env-file env/production.env --profile migrate run --rm migrate
   ```
   It runs as `caspira_owner` with `lock_timeout` set (`MIGRATION_LOCK_TIMEOUT`, 10 s by default), so a migration waiting on a busy table fails fast instead of queueing behind traffic.
3. `deploy.sh` runs both steps automatically, under the deployment lock.

**Policy: expand, then contract.**
- A release may add tables, columns and indexes (use `CREATE INDEX CONCURRENTLY` where tables are large) and backfill data.
- Removing or renaming anything waits until no running release uses it, and is marked `destructiveMigration` in the manifest. That makes image rollback **incompatible**, and the deployment requires maintenance and communication.
- Migrations are **never** rolled back automatically.

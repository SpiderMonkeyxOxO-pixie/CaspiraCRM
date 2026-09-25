# 10 — Respond to a failed migration

**Who:** Deployment Operator plus Engineering Lead. **Where:** host shell.

1. **Contain.** `deploy.sh` stops at the failed migration and reports **Failed**. The old api and worker containers keep running on the old code, but the old code may not work with a half-migrated schema.
   - If errors spike, put up the maintenance page (see runbook 04):
     ```bash
     touch /opt/caspira/deploy/production/proxy/maintenance/ENABLED
     ```
   - Otherwise, stop writers:
     ```bash
     docker compose --env-file env/production.env stop worker
     ```
2. **Diagnose** (read-only):
   ```bash
   docker compose --env-file env/production.env --profile migrate run --rm migrate node scripts/migrate.js --check
   docker compose --env-file env/production.env logs --since 30m migrate db
   ```
   The preflight lists the unfinished migration. PostgreSQL runs each Prisma migration in a transaction where possible, so a failed migration usually left **no** partial changes. Verify that with the migration's SQL.
3. **Decide:**
   - **Transient** (lock timeout or a connection drop): mark it rolled back, then retry during a quieter window:
     ```bash
     docker compose --env-file env/production.env --profile migrate run --rm migrate npx prisma migrate resolve --rolled-back <migration_name>
     ```
     Then run `./scripts/deploy.sh <deployment-id> production` again, from a new deployment plan.
   - **Bug in the migration:** don't edit an applied migration. Ship a **forward fix** release with a corrected migration.
   - **Partial non-transactional change** (for example `CREATE INDEX CONCURRENTLY` left an invalid index): drop only the named invalid object, with an explicit statement reviewed by a second person, as `caspira_owner`. Then retry.
   - **Data damaged:** declare a DR incident ([runbook 20](20-declare-and-close-a-disaster.md)) and use PITR to the pre-deployment backup ([runbook 05](05-restore-and-pitr.md)). `deploy.sh` took that backup before migrating.
4. Record everything on the deployment: events, the decision and who approved it.

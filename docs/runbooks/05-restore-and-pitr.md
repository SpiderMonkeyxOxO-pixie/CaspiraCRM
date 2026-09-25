# 05 — Point-in-time recovery and production restore

**Who:**
- a Restore Operator requests;
- a **different** person with `platform.restore.approve` approves;
- the DR Coordinator owns communication.

**Where:** Platform UI and host shell.

> **Rule:** every restore goes to a NEW, isolated target first. The live database is never overwritten by the API. Restoring *production itself* is a manual, approved procedure (Part C), used only when the live database is unusable. Some examples:
> - **Accidental deletion:** usually fixed by restoring to an isolated target and re-importing only the affected rows.
> - **Corruption:** may need Part C.

## Part A — Choose the recovery point
1. Open *Platform → Backups → Artifacts*. Choose the newest **Succeeded** backup that finished **before** the incident time.
2. The **recoverable window** runs from that backup's stop time to the newest archived WAL. Its evidence is `pg_stat_archiver.last_archived_time`, as reported by the backup agent.
3. Pick the target:
   - **Latest:** all archived changes.
   - **Time:** a UTC timestamp just **before** the damaging change. Look for it in the audit log.
   - **Full:** the backup's own end point.

   The API refuses a time in the future, a time before the backup finished, or a time after the newest archived WAL.

## Part B — Restore into an isolated target (default)
1. In *Platform → Restores → Plan restore*, choose the target **isolated**, the backup and the recovery point. Record the incident or change reference.
2. A second person reviews the WAL coverage and approves (password confirmation is required).
3. **Execute.** The worker sends a `restore` request to the backup agent. The agent:
   - runs `pgbackrest restore` into `/restore/<id>`, a new directory;
   - starts a temporary PostgreSQL on a private socket with archiving off;
   - validates connectivity, the migration version, tenant, user, role and audit counts, and the auth tables, then reports back.

   Only aggregate counts leave the agent.
4. Review the validation in the UI. For **selective recovery**, a Restore Operator connects to the isolated instance from inside the backup-agent container and exports only the affected rows. Import them through the application's import tools, or with a reviewed SQL script run as `caspira_owner`, following [runbook 09](09-database-roles-and-migrations.md).
5. Clean up. The agent removes isolated targets after `RESTORE_TARGET_TTL_HOURS` (24 by default). To remove one sooner, use **Clean up** on the restore in the UI.

## Part C — Restore production itself (manual, approved)
Use this only when the live database is lost or corrupted and a DR incident is declared ([runbook 20](20-declare-and-close-a-disaster.md)).

1. Plan the restore with the target **production**. The API requires every one of these:
   - the incident or change reference;
   - the impact assessment;
   - a current-state backup reference;
   - the maintenance plan;
   - the communication plan;
   - the roll-forward plan;
   - the rollback plan.
2. A second person approves. The API will **not** execute it: it returns `MANUAL_RUNBOOK_REQUIRED`. The steps below are the execution.
3. Host shell, in `/opt/caspira/deploy/production`:
   ```bash
   # 1. Stop writers. Keep the database running for the current-state backup.
   ./dc production stop api worker
   # 2. Current-state backup, even of a damaged cluster, for evidence and roll-forward:
   ./dc production --profile backup exec -T backup-agent /opt/caspira/pgbackrest-wrapper.sh --stanza=caspira --type=full backup
   # 3. Stop the database:
   ./dc production stop db
   ```
4. Keep the damaged data directory; don't delete it. Create a new volume for the restored cluster and restore into it with the approved target:
   ```bash
   docker volume create caspira-production_pgdata_restored_$(date -u +%Y%m%d%H%M)
   # Restore into the NEW volume, mounted at its own path. The live pgdata stays
   # mounted read-only and untouched. Put the approved time here:
   ./dc production --profile backup run --rm --no-deps \
     -v caspira-production_pgdata_restored_<stamp>:/restore-production \
     backup-agent /opt/caspira/pgbackrest-wrapper.sh --stanza=caspira --pg1-path=/restore-production/pgdata \
     --type=time "--target=2026-09-25 09:30:00+00" --target-action=promote restore
   ```
5. Point the `db` service's `pgdata` volume at the restored volume. Edit the `volumes:` entry of `compose.yaml` on the host only, with a comment carrying the incident reference. Then start `db` alone and validate:
   ```bash
   ./dc production up -d --wait db
   ./dc production --profile migrate run --rm migrate node scripts/migrate.js --check
   ```
6. Start the API and worker, run the smoke tests in [runbook 21](21-return-to-service.md), then take a **new full backup** immediately. PITR starts a new timeline.
7. Record the outcome on the restore plan and the incident. Keep the old volume until the post-incident review closes.

**Measured RTO and RPO:** record them on the restore execution and the DR incident. They are measurements, not promises.

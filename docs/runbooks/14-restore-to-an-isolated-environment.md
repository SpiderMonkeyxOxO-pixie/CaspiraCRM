# 14 — Restore to an isolated environment (restore drill)

**Who:** Restore Operator. **Where:** Platform UI (agent drill), or a staging host or workstation (operator-run drill).

Drills **never** target production. A missed drill (none passed within `restoreTestIntervalDays`, 30 by default) or a failed drill creates a security finding. The *restore verification* deployment gate also blocks production deployments until a drill passes.

## A — Agent drill (production or staging stack)
1. *Platform → Restore drills → Start drill.* The newest successful full, differential or incremental backup is restored to `latest` in an isolated directory with a temporary PostgreSQL.
2. The agent validates the restored copy (connectivity, migration version, tenants, users and System Owner, roles, audit events) and reports aggregates only. The drill records the requested and actual recovery point, the measured RTO and RPO, and the validation result.
3. The isolated target is removed after `RESTORE_TARGET_TTL_HOURS`.

## B — Operator-run drill with native PostgreSQL tools (any non-production source)
`server/scripts/drills/restoreDrill.js` proves the backup and restore mechanics end to end on a workstation or staging host. It needs PostgreSQL 17 binaries and GnuPG.

```bash
cd server
node scripts/drills/restoreDrill.js --pg-bin <postgresql-17>/bin --work <new-empty-directory> \
  --non-production-source --api-smoke [--record --operator <owner-username>]
```

The script refuses:
- to run with `APP_ENV=staging` or `production`;
- a work directory that isn't empty;
- to start without `--non-production-source`.

**Drill 1: logical backup, then isolated restore**
1. `pg_dump` of the source, encrypted with GPG AES-256; the key is kept in a separate directory. A SHA-256 manifest is written.
2. The manifest is verified, then the dump is decrypted.
3. A **new** cluster is created with data checksums, running the **production** role scripts (`10-roles.sh`, then `roles-upgrade.sql`).
4. The dump is restored as the migration role.
5. Checks:
   - the migration version and table counts match the source;
   - the runtime role can't create or drop tables;
   - analytics refresh works only through the allowlisted function;
   - the schema is owned by the migration role.
6. The API starts against the restored copy **as the runtime role**, and sign-in plus a tenant-scoped query are smoke-tested.

**Drill 2: continuous archiving and PITR**
1. A new cluster with WAL archiving; `pg_basebackup` with a SHA-256 manifest; `pg_verifybackup`; a GPG-encrypted base archive.
2. Write marker A, note time T, write marker B, and archive the segment.
3. Restore into a **new** cluster with `recovery_target_time = T`.
4. Checks:
   - the restored cluster holds A but not B;
   - its data matches;
   - the source is untouched.
5. Measured RPO and RTO are recorded.

The work directory keeps only `evidence.json`: step results, timings, checksums and aggregate counts. All data, backups and keys are deleted at the end.

With `--record`, both drills are stored as restore-drill records with the evidence hash. Or record the result in *Platform → Restore drills → Record drill*.

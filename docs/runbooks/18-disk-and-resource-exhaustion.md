# 18 — Respond to disk and resource exhaustion

**Who:** System Owner. **Where:** host shell.

**Alerts:**
- `disk_nearly_full`: disk used over 85%.
- `pool_exhaustion`: database connection use over 90%.
- `queue_delay`: oldest pending outbox item over 15 minutes.
- `error_rate`

Container OOM restarts also land here.

## Disk
1. Find what grew. These commands are read-only:
   ```bash
   df -h / /srv/caspira-backup /var/lib/docker
   sudo du -xh --max-depth=1 /var/lib/docker | sort -h | tail
   docker system df -v | head -40
   ```
2. Common causes and **safe** actions:
   - **WAL piling up in `pg_wal`:** archiving is failing. Fix the archive target ([runbook 19](19-backup-failure.md)). **Never delete WAL files by hand.** PostgreSQL removes them once they are archived.
   - **Local backup repository full:** check the retention settings (`repo1-retention-full`), then run the `expire` operation (*Platform → Backups*) or add disk space. Never delete backup sets by hand.
   - **Container logs:** already rotated (20 MB × 5 per container). A runaway logger points to a bug; restart that service.
   - **Old images:** `docker image prune --filter "until=720h"`. This removes only *unused, dangling* images older than 30 days. Keep the current and previous release images for rollback.
   - **Isolated restore targets:** these are cleaned up after `RESTORE_TARGET_TTL_HOURS`. To clean one sooner, use **Clean up** on that restore in the UI.
3. If PostgreSQL stopped because the disk was full: free space as above, then run `./dc production up -d --wait db`. PostgreSQL recovers from its WAL.

## Memory, CPU and PIDs
- Every service has limits. Check `docker stats --no-stream`. An OOM-killed container restarts automatically. Find the cause in `docker compose logs --since 1h <service>`.
- For long-running queries: statement timeouts end runtime queries after 60 s. Inspect sessions as the monitor role:
  ```sql
  select pid, usename, state, now() - query_start as age, left(query, 80) from pg_stat_activity order by age desc limit 10;
  ```
  End a specific session with `select pg_cancel_backend(<pid>)`, which is gentler, or `pg_terminate_backend(<pid>)`.

## Database connections
The runtime role is capped at 60 connections, and the API pool at `DB_CONNECTION_LIMIT` per process. If the pool is exhausted, look for leaked transactions (`idle in transaction`); the 60 s idle-in-transaction timeout ends them.

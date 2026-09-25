# 19 — Respond to backup failure

**Who:** Backup Operator. **Where:** Platform UI and host shell.

**Alerts:**
- `backup_missed`: no successful backup in 26 hours.
- `backup_failed`
- `wal_archive_lag`: over 15 minutes.
- `restore_verification_overdue`
- `disk_nearly_full`: when the repository shares the disk.

Artifacts that fail verification stay **Unverified** in *Platform → Backups*.

> **Do not delete the failed backup, its logs or the partial repository contents before investigation.** Failed artifacts are kept deliberately.

1. **Read the failure:** *Platform → Backups → Jobs*, then open the failed job. The result carries the pgBackRest exit code and error text; secrets are never included. On the host:
   ```bash
   docker compose --env-file env/production.env --profile backup logs --since 2h backup-agent db
   ```
2. **Classify:**

   | Symptom | Likely cause | Action |
   |---|---|---|
   | `archive-push` errors, WAL lag growing | repo unreachable, disk full, wrong passphrase | Fix the target; PostgreSQL retries archiving on its own. Check `pg_stat_archiver.failed_count` stops rising |
   | Repo2 (off-site) only | credentials, network, bucket policy | Check `env/backup-offsite.env` and the credentials file; test with `info --repo=2` |
   | `stanza mismatch` | database system ID changed (after a restore or rebuild) | Run `stanza-upgrade` only after confirming the restore was intended |
   | Checksum or verify failure | storage corruption | Keep the failing set; take a new full backup immediately; open a Critical finding |
   | Agent heartbeat stale | backup-agent container stopped | `docker compose --env-file env/production.env --profile backup up -d --wait backup-agent` |

3. **Restore protection:** after the fix, run a **full** backup ([runbook 11](11-on-demand-backup.md)), **verify** it ([runbook 13](13-verify-a-backup.md)), and run a restore drill if the failure lasted longer than the RPO.
4. **Record:** the gap between the last good backup and the first new one is the exposure window. Put it on the finding.
5. **Deployments:** the *backup readiness* gate blocks production deployments until a backup is fresh and the WAL lag is within policy. This is intended.

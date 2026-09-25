# 13 — Verify a backup

**Who:** Backup Operator. **Where:** Platform UI.

A backup is **Verified** only when all of these checks have passed and are recorded separately from the job result:

| Check | How |
|-------|-----|
| existence | the artifact appears in `pgbackrest info` |
| checksum | `pgbackrest verify`: page and file checksums |
| wal_continuity | `pgbackrest verify` plus `check`: an unbroken WAL chain from the backup |
| encryption | the repository cipher is `aes-256-cbc` |
| native_check | `pgbackrest check`: archiving round trip |
| isolated_restore | a restore into a new isolated target succeeded ([runbook 14](14-restore-to-an-isolated-environment.md)) |
| app_smoke | the application validation of the restored copy passed: migration version, auth tables, roles, counts |

## Steps
1. In *Platform → Backups → Artifacts*, open the artifact and choose **Verify now**. The agent runs `check` and `verify` and records each check.
2. For **isolated_restore** and **app_smoke**, run a restore drill against this artifact (*Platform → Restore drills → Start drill*). Its validation marks both checks.
3. The artifact becomes **Verified** once every mandatory check has passed. Otherwise it stays **Unverified** and shows the missing checks.

Health indicators (a green agent, recent jobs) are **not** proof of recoverability. Only a restore is.

# 11 — Run an on-demand backup

**Who:** Backup Operator. **Where:** Platform UI (preferred) or host shell.

## From the Platform UI
1. Open *Platform → Backups*. Check **Status**: the agent heartbeat is fresh and the WAL archive lag is under 15 minutes.
2. Choose **Run backup** and a type:
   - **Full:** before a risky change or a deployment (`deploy.sh` does this automatically).
   - **Differential** or **incremental:** the scheduled types.
   - **Logical:** `pg_dump`, GPG-encrypted. A portable copy; **not** a PITR replacement.
   - **Configuration:** infrastructure files, no secrets (runbook 07).

   Only one active job per type is allowed, so a second click is refused.
3. The worker writes the request, and the agent runs `pgbackrest backup` against the encrypted repo1 (and repo2 when off-site is enabled). The job moves through **Queued**, **Running**, then **Succeeded** or **Failed**. The artifact list refreshes from `pgbackrest info`.
4. A **Succeeded** job is not yet a **Verified** backup. Verification is separate ([runbook 13](13-verify-a-backup.md)).

## From the host (if the API is down)
```bash
cd /opt/caspira/deploy/production
./dc production --profile backup exec -T backup-agent /opt/caspira/pgbackrest-wrapper.sh --stanza=caspira --type=full backup
./dc production --profile backup exec -T backup-agent /opt/caspira/pgbackrest-wrapper.sh --stanza=caspira info
```
The wrapper reads the repository passphrase from `/run/secrets/backup_repo_cipher_pass`; it is never typed or echoed. When the API is back, the next status refresh records the backup as an artifact.

## Failed backup
Don't delete anything. Follow [runbook 19](19-backup-failure.md).

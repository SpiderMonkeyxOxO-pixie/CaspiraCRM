# 07 — Restore object storage and files

**Who:** Restore Operator, with a second approver. **Where:** Platform UI and host shell.

## What exists today
- **File-like data:** branding assets, email templates and export files. Branding and templates are stored **in PostgreSQL** and are covered by database backups and PITR.
- **Export files:** encrypted and short-lived by design (`ANALYTICS_EXPORT_EXPIRY_DAYS`). They are regenerated, not restored.
- **Document storage:** the Documents service (uploads, object storage) is **not built yet**. The `object_backup` and `object_restore` agent operations and the *Object storage* backup policy exist so that coverage is ready when it is. Until then this runbook covers the configuration backup.

## Configuration backup (infrastructure files, no secrets)
The backup agent's `configuration` operation archives these items and encrypts the archive with GPG using `backup_logical_passphrase`:
- `compose.yaml`
- `env/<environment>.env` (which holds no secrets)
- the proxy configuration
- PostgreSQL configuration
- release manifests

Secrets are **not** included; they are escrowed separately (runbook 02).

To restore a configuration file (host shell):
1. In *Platform → Backups → Artifacts*, find the configuration artifact and its label.
2. Copy the artifact out of the repository volume, then decrypt it on the host into a **new** directory:
   ```bash
   install -d -m 0700 /root/caspira-config-restore-<incident>
   gpg --batch --pinentry-mode loopback --passphrase-file /opt/caspira/deploy/production/secrets/production/backup_logical_passphrase \
     -o /root/caspira-config-restore-<incident>/config.tar -d <artifact>.tar.gpg
   tar -xf /root/caspira-config-restore-<incident>/config.tar -C /root/caspira-config-restore-<incident>
   ```
3. Compare the restored files with the current ones (`diff -ru`), and copy back **only** the specific files you need.

## When object storage exists (future)
- Use bucket versioning, plus a scheduled replicated copy to a second bucket with separate credentials.
- Restore object versions to a timestamp into a **new prefix**. Validate file references against the database, then switch.

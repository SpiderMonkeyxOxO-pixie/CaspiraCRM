# Operational runbooks (Backend Phase 13)

These runbooks are for Caspira CRM's single-host production and staging stack in `deploy/production/`. They are written to be executed, not just read.

## Conventions used in every runbook
- **Where to run:**
  - **Host shell** means an SSH session, or the aaPanel terminal, on the production (or staging) host, as an administrator in the `docker` group.
  - **Operator workstation** means your own machine.
  - **Platform UI** means *Administration → Platform Operations* while signed in as the System Owner or a delegated platform role.
- **Paths are explicit:** the stack lives in `/opt/caspira`, the compose directory is `/opt/caspira/deploy/production`, and secrets are in `/opt/caspira/deploy/production/secrets/<environment>/`. If your host uses different paths, change them once in your copy of the runbook, never in the middle of an incident.
- **Environment:** every command names `production` or `staging` explicitly. The compose project is `caspira-<environment>`, so volumes are `caspira-production_pgdata` and similar.
- **Never:**
  - use `docker compose down -v`, `docker volume prune` or `docker system prune --volumes`;
  - use `rm -rf` with a variable or a wildcard;
  - print a secret;
  - restore over the live database;
  - delete a failed backup before it has been investigated.
- **Sensitive actions** ask you to confirm your password in the UI (recent authentication). Restores, deployments and rollbacks need a **second person** to approve.

| # | Runbook |
|---|---------|
| 01 | [Prepare a production host](01-prepare-a-production-host.md) |
| 02 | [Host firewall and production secrets](02-firewall-and-secrets.md) |
| 03 | [Start the platform](03-start-the-platform.md) |
| 04 | [Issue and renew TLS certificates](04-tls-certificates.md) |
| 05 | [Point-in-time recovery and production restore](05-restore-and-pitr.md) |
| 06 | [Controlled deployment](06-controlled-deployment.md) |
| 07 | [Restore object storage and files](07-object-storage-restore.md) |
| 08 | [Roll back an application release](08-rollback-a-release.md) |
| 09 | [Database roles and running migrations](09-database-roles-and-migrations.md) |
| 10 | [Respond to a failed migration](10-failed-migration.md) |
| 11 | [Run an on-demand backup](11-on-demand-backup.md) |
| 12 | [Respond to a lost server](12-lost-server.md) |
| 13 | [Verify a backup](13-verify-a-backup.md) |
| 14 | [Restore to an isolated environment (restore drill)](14-restore-to-an-isolated-environment.md) |
| 15 | [Rotate signing keys](15-rotate-signing-keys.md) |
| 16 | [Rotate encryption keys](16-rotate-encryption-keys.md) |
| 17 | [Respond to compromised credentials](17-compromised-credentials.md) |
| 18 | [Respond to disk and resource exhaustion](18-disk-and-resource-exhaustion.md) |
| 19 | [Respond to backup failure](19-backup-failure.md) |
| 20 | [Declare and close a disaster](20-declare-and-close-a-disaster.md) |
| 21 | [Return the platform to service](21-return-to-service.md) |
| 22 | [Collect incident evidence](22-incident-evidence.md) |
| 23 | [Install and upgrade Docker](23-install-and-upgrade-docker.md) |

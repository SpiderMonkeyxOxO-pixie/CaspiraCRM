# 12 — Respond to a lost server

**Who:** DR Coordinator (incident owner), System Owner and Restore Operator. **Where:** a new host, and an operator workstation.

This is the single-host failure mode. The platform is down until a replacement host is running. **There is no automatic failover.**

1. **Declare a DR incident** (plan `server_loss`, [runbook 20](20-declare-and-close-a-disaster.md)) from any working session, or record it offline and enter it later.
2. **Establish the recovery point.** The newest recoverable data is whatever reached the **off-site repository (repo2)**: the last backup plus the archived WAL pushed there. Anything after that is lost. Record it as the measured RPO.
3. **Provision a new host** with runbooks [01](01-prepare-a-production-host.md), [23](23-install-and-upgrade-docker.md) and [02](02-firewall-and-secrets.md) (Part A).
4. **Secrets:**
   - Recreate them with `create-secrets.sh production` for the **application**. New JWT and session secrets simply sign everyone out, which is acceptable.
   - **Retrieve the escrowed backup keys** (`backup_repo_cipher_pass`, `backup_logical_passphrase`, `backup_offsite_credentials`) and `integrations_keys` from the password manager. Without the original `integrations_keys`, stored integration credentials can't be decrypted; users must reconnect their integrations.
5. **Restore the database from repo2** into the new `db` volume, before starting the API:
   ```bash
   cd /opt/caspira/deploy/production
   ./dc production up -d --wait db   # creates the cluster and roles, then:
   ./dc production stop db
   ```
   Then run the pgBackRest restore from repo2 into the `db` volume (`--repo=2 --type=default --delta`), as in [runbook 05](05-restore-and-pitr.md) Part C step 4. It is the same command with `--repo=2` and the live `pgdata` volume as the target: this host has no other data.
6. **Re-apply the role passwords.** The restored cluster carries the *old* role passwords, which don't match the new secret files. Start `db` alone, then run `roles-upgrade.sql` as in [runbook 09](09-database-roles-and-migrations.md). The script is idempotent and sets all four role passwords from the current secret files.
7. Start the platform ([runbook 03](03-start-the-platform.md), existing volumes). Run the migration **preflight**; the schema should match the last release.
8. **DNS:** point the A and AAAA records at the new host's address. This needs approval; lower the TTL ahead of time if possible. Issue certificates ([runbook 04](04-tls-certificates.md)).
9. Run the return-to-service checks in [runbook 21](21-return-to-service.md), take a new full backup, and re-enable schedules.
10. Record the measured RTO, the time from loss to service restored, on the incident.

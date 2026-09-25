# 22 — Collect incident evidence

**Who:** Security Admin or incident owner. **Where:** host shell, Platform UI.

Collect evidence **before** recovery changes it. Store it off the host, in the incident's restricted evidence folder, with SHA-256 hashes. Never copy secrets or customer data into tickets or chat.

Set up a dedicated evidence directory:
```bash
INC=INC-2026-0001   # the incident reference, written literally
install -d -m 0700 /root/evidence/$INC
cd /opt/caspira/deploy/production
```

1. **Timeline anchors:**
   ```bash
   date -u > /root/evidence/$INC/collected-at.txt
   uptime >> /root/evidence/$INC/collected-at.txt
   ```
2. **Container state and logs.** Logs carry correlation IDs; secrets are redacted.
   ```bash
   docker compose --env-file env/production.env --profile backup ps --format json > /root/evidence/$INC/compose-ps.json
   for s in proxy api worker db redis backup-agent; do docker compose --env-file env/production.env --profile backup logs --no-color --since 24h "$s" > "/root/evidence/$INC/log-$s.txt" 2>&1; done
   ```
   The loop runs over an explicit list of service names.
3. **Audit trail:** in the Platform UI, export audit events for the incident window, filtered by actor, IP or correlation ID. Record the export ID.
4. **Host:**
   ```bash
   sudo journalctl --since "-24h" -u ssh -u docker > /root/evidence/$INC/journal.txt
   sudo ausearch -k docker-socket -k caspira-secrets --start today > /root/evidence/$INC/audit.txt
   last -Fw > /root/evidence/$INC/logins.txt
   ```
5. **Database state:** don't copy data. Record the current migration version, `pg_stat_archiver` and the newest backup label (from `migrate --check` and `pgbackrest info`).
6. **Preserve damaged volumes:** for corruption or ransomware, stop the service and keep the volume, renaming by creating a new one for recovery (runbook 05). Take a provider snapshot of the disk if one is available.
7. **Hash and seal:**
   ```bash
   cd /root/evidence/$INC && sha256sum * > SHA256SUMS
   ```
   Copy the directory off the host over `scp`. Record who holds it.
8. Add the evidence location and hash to the DR incident's actions.

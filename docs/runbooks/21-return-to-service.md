# 21 — Return the platform to service

**Who:** incident owner, with a second person confirming. **Where:** host shell and browser.

Every check must pass before the incident moves to **Service Restored**.

1. **Containers healthy:**
   ```bash
   cd /opt/caspira/deploy/production
   ./dc production --profile backup ps
   ```
   Every service must show `healthy`.
2. **Public endpoints:**
   - `curl -fsS https://api.<domain>/health` returns ok.
   - `curl -fsS https://api.<domain>/ready` returns ready.
   - The SPA loads over HTTPS with a valid certificate.
3. **Schema:** `./dc production --profile migrate run --rm migrate node scripts/migrate.js --check` returns ok, with the expected version.
4. **Application smoke tests**, in a browser:
   - sign in as a test user (MFA if enabled);
   - open a CRM list;
   - create a note, then delete it;
   - open a dashboard;
   - generate a small export;
   - check that email delivery works (a test notification).
5. **Tenant sanity:** the organization count and a sample tenant's record counts match expectations, from the incident's pre-loss evidence or the drill baseline.
6. **Background work:**
   - *Platform → System health* shows fresh worker and scheduler heartbeats and a normal queue depth;
   - a scheduled job has completed since the restart.
7. **Backups:**
   - WAL archiving succeeds (`wal_archive_lag_minutes` under 15);
   - take a **new full backup** (after a PITR, a new timeline started) and verify it.
8. **Alerts:** no Critical alerts are firing, apart from acknowledged ones that have a reason.
9. **Maintenance page off:** `rm /opt/caspira/deploy/production/proxy/maintenance/ENABLED`, if it was on.
10. **Communicate** restoration, and record the measured RTO and RPO on the incident.

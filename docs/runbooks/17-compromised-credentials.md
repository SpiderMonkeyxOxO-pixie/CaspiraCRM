# 17 — Respond to compromised credentials

**Who:** Security Admin (incident owner), System Owner. **Where:** Platform UI and host shell.

1. **Declare the incident:** *Platform → Disaster recovery → Declare incident*, plan `admin_credentials_compromised`, `signing_key_compromised` or `integration_credential_compromised`. Start evidence collection with [runbook 22](22-incident-evidence.md) **before** changing anything you might need to investigate.
2. **Contain by credential type:**

   | Compromised | Immediate action |
   |---|---|
   | User password or session | Suspend the account (this revokes all its sessions), force a password reset, reset MFA |
   | System Owner or platform role holder | As above, and revoke platform roles; review the audit log for `platform.*` actions |
   | Automation token (`cpat_`) | *Security → Automation tokens → Revoke* (effective immediately) |
   | JWT secret | Emergency rotation ([runbook 15](15-rotate-signing-keys.md)) **without** keeping the previous key, which signs everyone out |
   | Database password | Replace the secret file, then run `ALTER ROLE caspira_app PASSWORD :'new'` as `postgres` over the socket, then restart the api and worker |
   | Integration or provider API key | Revoke it in the provider console, then update it in the app |
   | Backup keys or off-site credentials | Rotate ([runbook 16](16-rotate-encryption-keys.md)); treat the backups as possibly exposed |
   | SSH key or host | Remove the key from `authorized_keys`; if host root is suspected, rebuild the host ([runbook 12](12-lost-server.md)) |

3. **Record the emergency revocation:** *Security → Secrets → Emergency revoke*. This records a Critical finding and audits the action. The finding blocks deployments until it is resolved.
4. **Hunt:**
   - audit events by actor and IP;
   - exports and downloads;
   - permission changes;
   - automation token use;
   - login failures.
5. **Recover:** restore any data changed maliciously, using PITR to an isolated target and a selective re-import ([runbook 05](05-restore-and-pitr.md)).
6. **Close:** follow [runbook 20](20-declare-and-close-a-disaster.md), with a post-incident review and the finding disposition.

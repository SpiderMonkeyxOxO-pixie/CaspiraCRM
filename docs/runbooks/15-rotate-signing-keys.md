# 15 — Rotate signing keys (JWT, webhook signing, automation-token pepper)

**Who:** Security Admin, with password confirmation. **Where:** host shell and Platform UI (*Security → Secrets*).

Each rotation follows the inventory's ordered steps: **create → accept both → switch → verify → revoke old → audit**. Record every step on the secret in *Platform → Security → Secrets* (**Advance rotation**).

## JWT signing secret (`jwt_secret`), without signing everyone out
1. **Create** the new value, and move the old one into `jwt_secret_previous`. That file already exists, empty, and is mounted for the api and worker. Never print either value:
   ```bash
   cd /opt/caspira/deploy/production/secrets/production
   sudo cp --preserve=mode,ownership jwt_secret jwt_secret_previous
   sudo sh -c 'umask 0337; head -c 48 /dev/urandom | base64 | tr -d "\n" > jwt_secret.new'
   sudo chgrp 1500 jwt_secret.new && sudo mv jwt_secret.new jwt_secret
   ```
2. **Accept both.** Restart the api and worker. New tokens are signed with the new key, and verification falls back to `JWT_SECRET_PREVIOUS` for tokens signed with the old one.
   ```bash
   cd /opt/caspira/deploy/production
   ./dc production up -d --wait api worker
   ```
3. **Verify:** sign in, and check that an existing session still refreshes.
4. **Revoke old** after the longest access-token lifetime (15 minutes) has passed. Empty the one file by name, keeping it because compose mounts it, then restart the api and worker:
   ```bash
   sudo truncate -s 0 /opt/caspira/deploy/production/secrets/production/jwt_secret_previous
   ```
   Refresh sessions are opaque and database-backed, so they keep working.
5. Advance the rotation to **Completed** in the UI.

## Automation-token pepper (`platform_automation_token_pepper`)
Rotating the pepper invalidates every automation token. Create new tokens (*Security → Automation tokens*) and update `/etc/caspira/<env>/deploy-token` on the host.

## Provider webhook signing secrets
Rotate them in the provider console first, while the provider sends both signatures if it supports that. Then update the stored integration secret in the application, and verify that one delivery succeeds.

# 03 — Start the platform

**Who:** Deployment Operator. **Where:** host shell, in `/opt/caspira/deploy/production`.

## First start (clean volumes)
1. **Prerequisites:** runbooks 01 and 02 are done; TLS certificates are in `TLS_CERT_DIR` (runbook 04); `env/production.env` has digest-pinned images.
2. Validate the configuration without starting anything:
   ```bash
   docker compose --env-file env/production.env --profile backup --profile migrate config --quiet
   ```
   It must print nothing.
3. Start the database and Redis. On first start, `init/10-roles.sh` creates the least-privilege roles.
   ```bash
   docker compose --env-file env/production.env up -d --wait db redis
   ```
4. Run the migrations with the migration identity:
   ```bash
   docker compose --env-file env/production.env --profile migrate run --rm migrate node scripts/migrate.js --check
   docker compose --env-file env/production.env --profile migrate run --rm migrate
   ```
   The first command is the preflight. The second prints a JSON result. Continue only when it shows `"ok": true`.
5. Start everything else, including the backup agent:
   ```bash
   docker compose --env-file env/production.env --profile backup up -d --wait
   ```
6. Create the pgBackRest stanza and take the first full backup:
   - In *Platform → Backups*, run **Check**, then **Run full backup**.
   - Or, from the host, confirm through the API status in step 7.
7. Verify:
   ```bash
   curl -fsS https://api.<domain>/health
   curl -fsS https://api.<domain>/ready
   ```
   - `/health` returns `{"status":"ok"}`.
   - `/ready` returns `ready`, with the database and Redis `ok`.
   - In *Platform → System health*, the database, Redis, worker heartbeat, scheduler heartbeat, backup agent and WAL archive should all be green.
8. **Bootstrap the System Owner** once, with the flag set only on this one command:
   ```bash
   read -rs BOOTSTRAP_OWNER_PASSWORD && export BOOTSTRAP_OWNER_PASSWORD
   docker compose --env-file env/production.env run --rm --no-deps -e ALLOW_SYSTEM_OWNER_BOOTSTRAP=true -e BOOTSTRAP_OWNER_EMAIL=owner@<domain> -e BOOTSTRAP_OWNER_PASSWORD api node scripts/bootstrapSystemOwner.js
   unset BOOTSTRAP_OWNER_PASSWORD
   ```
   - `read -rs` keeps the password out of shell history and off the screen.
   - The script is a no-op once a System Owner exists.
   - Strict profiles refuse to start the API if `ALLOW_SYSTEM_OWNER_BOOTSTRAP` is ever left in `env/production.env`.
   - Sign in and enable two-factor authentication for the owner immediately.

## Existing volumes (restart or host reboot)
- `docker compose --env-file env/production.env --profile backup up -d --wait` is idempotent. Containers restart with `unless-stopped`, and PostgreSQL recovers from its WAL after an unclean stop.
- Check `docker compose --env-file env/production.env ps`. Every service should show `healthy`.

## Graceful stop (maintenance)
```bash
docker compose --env-file env/production.env --profile backup stop
```
- The API drains within its grace period.
- The worker finishes or cancels its jobs (40 s).
- PostgreSQL stops cleanly (120 s).
- Use `stop`, not `down`. **Never** add `-v`.

## Migrating from the legacy `deploy/vps-prod` stack
The Phase 13 code refuses to start with the legacy stack's configuration by design. The one-time cut-over is part of the final deployment plan:
1. Take a verified logical backup.
2. Create the new secrets.
3. Apply `postgres/roles-upgrade.sql` to the existing database (runbook 09).
4. Point the new stack at the existing volume, or restore into it.
5. Run the migrations, then switch the proxy.

This needs a separate approval.

# Production backend on the VPS

This guide puts the api, worker, production database and Redis on the
**database VPS** (202.61.87.220). The live site keeps running where it is.

```
Browser ─► Cloudflare ─┬─ caspiracrm.caspirasolutions.com ─► website VPS (built frontend, unchanged)
                       └─ api.caspirasolutions.com ──────► database VPS: aaPanel site (nginx)
                                                              └─► 127.0.0.1:4010  caspira-prod-api ─┬─ caspira-prod-db    (no host port)
                                                                                  caspira-prod-worker ┼─ caspira-prod-redis (no host port)
                                                                                                      └─ caspira-prod-mailpit (UI 127.0.0.1:8026)
```

Details of this setup:

- The site and the api are sibling subdomains of `caspirasolutions.com`, so the browser treats them as the same site and sends the login cookies.
- The CSRF cookie is shared through `COOKIE_DOMAIN`.
- The api only accepts browser requests from `CLIENT_ORIGIN`.

The production database is separate from the development one (`deploy/vps-dev`,
`caspira_crm_dev`). It has its own password, containers and volume, and the
dev accounts (`Caspira123!`) never reach it.

> **Order matters.** The live site's build settings (`.env.production`)
> switch it to the real backend. Finish steps 1–6 before pushing that
> change, or the live login breaks until the backend is up.

## 1. DNS: add `api.caspirasolutions.com` (Cloudflare)

In Cloudflare, go to `caspirasolutions.com` → **DNS** → **Add record**:

- Type **A**
- Name **api**
- IPv4 **202.61.87.220**
- Proxy status **Proxied** (orange cloud)

Leave every existing record as it is.

Under **SSL/TLS**, set the encryption mode to **Full**. With Full,
Cloudflare → VPS traffic is encrypted using the certificate from step 3.

## 2. Get the code onto the VPS (once)

```bash
git clone https://github.com/SpiderMonkeyxOxO-pixie/CaspiraCRM.git /opt/caspira-crm
```

## 3. aaPanel site for the api (once)

1. In aaPanel, go to **Website** → **Add site**.
   - Domain: `api.caspirasolutions.com`
   - PHP: **Static**
   - No database or FTP.
2. Open the site → **SSL** → **Let's Encrypt** → issue a certificate → turn on **Force HTTPS**.
3. Open the site → **Reverse proxy** → **Add reverse proxy**.
   - Name: `api`
   - Target URL: `http://127.0.0.1:4010`
   - Send domain: `$host`
   - Save.

## 4. Backend settings (once)

```bash
cd /opt/caspira-crm/deploy/vps-prod
cp .env.example .env
openssl rand -hex 32   # run twice: one value for POSTGRES_PASSWORD, one for JWT_SECRET
nano .env
```

Fill in `POSTGRES_PASSWORD` and `JWT_SECRET`. `CLIENT_ORIGIN`,
`COOKIE_DOMAIN` and `TRUST_PROXY` are already set for this setup. `.env`
is git-ignored, and deploys never touch it.

## 5. Start the backend (once; later deploys do this)

```bash
cd /opt/caspira-crm/deploy/vps-prod
docker compose up -d --build --wait
docker compose ps
curl -s https://api.caspirasolutions.com/api/v1/health    # → {"status":"ok"}
```

The five containers should show as healthy or running. On every start,
the api applies any pending database migrations.

## 6. Roles, System Owner, first organization (once)

```bash
cd /opt/caspira-crm/deploy/vps-prod

# The five built-in roles (no sample users or data)
docker compose exec -T api node scripts/seedRoles.js

# The System Owner. Choose a password of at least 12 characters. `read -s`
# keeps it out of the terminal and the shell history.
read -s -p "System Owner password: " OWNER_PW; echo
docker compose exec -T \
  -e ALLOW_SYSTEM_OWNER_BOOTSTRAP=true \
  -e BOOTSTRAP_OWNER_EMAIL=you@caspirasolutions.com \
  -e BOOTSTRAP_OWNER_USERNAME=owner \
  -e BOOTSTRAP_OWNER_NAME="Your Name" \
  -e BOOTSTRAP_OWNER_PASSWORD="$OWNER_PW" \
  api node scripts/bootstrapSystemOwner.js
unset OWNER_PW

# The organization everyone works in (no page for this yet)
docker compose exec -T api node scripts/createOrganization.js "Caspira Solutions" owner
```

## 7. Switch the live site to the backend

`.env.production` in the repository holds the live site's build settings:
the api address and the backend switches. It's picked up by the normal
deploy on the next push to `main`. After the deploy finishes, open
https://caspiracrm.caspirasolutions.com and log in as the System Owner.
Invite everyone else from Admin → Members.

## 8. Automatic backend deploys (optional, recommended)

Without this step, the backend stays on whatever version you started in
step 5. To update it by hand:

```bash
cd /opt/caspira-crm && git pull
cd deploy/vps-prod && docker compose up -d --build --wait && docker compose exec -T api node scripts/seedRoles.js
```

To let each push to `main` update the backend automatically, first create
a key on the VPS that GitHub Actions can log in with:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/github_deploy -N "" -C "github-actions"
cat ~/.ssh/github_deploy.pub >> ~/.ssh/authorized_keys
cat ~/.ssh/github_deploy          # copy this whole private key
```

Then, in the CaspiraCRM repository on GitHub, go to **Settings** →
**Secrets and variables** → **Actions** and add these repository secrets:

| Secret | Value |
|---|---|
| `BACKEND_SERVER_IP` | `202.61.87.220` |
| `BACKEND_SERVER_PORT` | `16441` |
| `BACKEND_SERVER_USER` | `root` |
| `BACKEND_SSH_PRIVATE_KEY` | the private key printed above |

The workflow's `deploy-backend` job does the following:

- It pulls `/opt/caspira-crm`.
- It rebuilds and restarts the api and worker, which applies any new migrations.
- It refreshes the built-in role grants.

It's skipped while `BACKEND_SERVER_IP` isn't set.

## Email

Outgoing mail, such as invitations and password resets, is caught by the
`caspira-prod-mailpit` container and **not delivered**. To read it, open a
tunnel from your PC:

```powershell
ssh -N -p 16441 -L 8026:127.0.0.1:8026 root@202.61.87.220
```

Then go to http://localhost:8026. For real delivery, set `SMTP_HOST`,
`SMTP_PORT` and `SMTP_FROM` in `deploy/vps-prod/.env` for your email
provider, then run `docker compose up -d`.

## Backups

The database lives in the Docker volume `caspira-prod_caspira_prod_db_data`.
To take a dump:

```bash
docker exec caspira-prod-db pg_dump -U caspira -Fc caspira_crm > /root/caspira-$(date +%F).dump
```

To schedule this daily, add it as an aaPanel **Cron** job (Shell script).
Copy the dumps off the VPS regularly.

## Troubleshooting

- `docker compose logs -f api` shows the api's output, including migration errors on start.
- **The health check returns Cloudflare error 521/522:** Cloudflare can't reach the VPS. Check the aaPanel site exists, its SSL is issued, and the Cloudflare SSL mode is Full.
- **Login fails with a CORS error in the browser console:** `CLIENT_ORIGIN` doesn't exactly match `https://caspiracrm.caspirasolutions.com`.
- **Saving anything fails with "Missing or invalid CSRF token":** `COOKIE_DOMAIN` isn't `caspirasolutions.com`.
- **"No active organization":** step 6's `createOrganization.js` hasn't been run, or the user isn't a member of an organization.

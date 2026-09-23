# Production backend on the VPS

This guide puts the api, worker, database and Redis on the VPS, so the live
site uses real saved data instead of sample data. It's separate from the
development setup (`docs/VPS_DEV_SETUP.md`): it uses a different database,
password, containers and volume. The dev database and the dev accounts
(`Caspira123!`) never reach production.

```
Browser ──HTTPS──► nginx (aaPanel site)
                    ├─ /        → built frontend (dist/)
                    └─ /api/    → 127.0.0.1:4010  caspira-prod-api ─┬─ caspira-prod-db    (no host port)
                                                  caspira-prod-worker ┼─ caspira-prod-redis (no host port)
                                                                      └─ caspira-prod-mailpit (UI 127.0.0.1:8026)
```

The frontend and the api share one address, so login cookies need no
cross-site settings. Postgres and Redis have no ports on the VPS at all.

All commands below run **on the VPS** unless a step says otherwise.

## 0. Check which repository the VPS checkout pulls from (once)

The deploy workflow runs `git fetch origin` in `/www/wwwroot/Internal-Project`.

```bash
cd /www/wwwroot/Internal-Project
git remote -v
```

It must be `SpiderMonkeyxOxO-pixie/CaspiraCRM`. If it isn't:

```bash
git remote set-url origin https://github.com/SpiderMonkeyxOxO-pixie/CaspiraCRM.git
git fetch origin
```

If the repository is private, the fetch asks for credentials. In that case
add a read-only deploy key: on the VPS, run `ssh-keygen -t ed25519 -f
~/.ssh/caspiracrm_deploy -N ""`, then add the `.pub` file on GitHub under
repo → Settings → Deploy keys. Then use the `git@github.com:…` URL instead.

## 1. HTTPS for the site (once)

In production, login cookies are `Secure`, so the site must be served over
HTTPS. In aaPanel, go to **Website** → your site → **SSL** → **Let's
Encrypt**, issue a certificate, and turn on **Force HTTPS**.

## 2. Backend settings (once)

```bash
cd /www/wwwroot/Internal-Project/deploy/vps-prod
cp .env.example .env
openssl rand -hex 32   # run twice: one value for POSTGRES_PASSWORD, one for JWT_SECRET
nano .env
```

Fill in `POSTGRES_PASSWORD` and `JWT_SECRET`. Set `CLIENT_ORIGIN` to the
site's address, e.g. `https://crm.yourdomain.com`, with no trailing slash.
`.env` is git-ignored, and the deploy's `git clean` doesn't remove it.

## 3. Start the backend (once; later deploys do this automatically)

```bash
cd /www/wwwroot/Internal-Project/deploy/vps-prod
docker compose up -d --build --wait
docker compose ps        # all five containers "healthy" / "running"
```

On every start, the api applies any pending database migrations.

## 4. Roles, System Owner, first organization (once)

```bash
cd /www/wwwroot/Internal-Project/deploy/vps-prod

# The five built-in roles (no sample users or data)
docker compose exec -T api node scripts/seedRoles.js

# The System Owner. Choose a password of at least 12 characters. `read -s`
# keeps it out of the terminal and the shell history.
read -s -p "System Owner password: " OWNER_PW; echo
docker compose exec -T \
  -e ALLOW_SYSTEM_OWNER_BOOTSTRAP=true \
  -e BOOTSTRAP_OWNER_EMAIL=you@yourcompany.com \
  -e BOOTSTRAP_OWNER_USERNAME=owner \
  -e BOOTSTRAP_OWNER_NAME="Your Name" \
  -e BOOTSTRAP_OWNER_PASSWORD="$OWNER_PW" \
  api node scripts/bootstrapSystemOwner.js
unset OWNER_PW

# The organization everyone works in (no page for this yet)
docker compose exec -T api node scripts/createOrganization.js "Your Company" owner
```

## 5. Forward /api/ to the backend (once)

In aaPanel, go to **Website** → your site → **Config**. Inside the `server
{ … }` block for port 443, add the following **above** any other
`location` block:

```nginx
    location /api/ {
        proxy_pass http://127.0.0.1:4010;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 5m;
    }
```

Save, then check: `curl -s https://<your-site>/api/v1/health` should
return JSON, not the HTML of the site. If it returns the site's HTML, the
`location /api/` block isn't being used; make sure it comes before the
site's catch-all `location /` block.

## 6. Build the frontend for the real backend (once)

Create `/www/wwwroot/Internal-Project/.env`. It's git-ignored, and deploys
keep it.

```
VITE_BACKEND_API_BASE_URL=/api/v1
VITE_BACKEND_AUTH_MODE=true
VITE_BACKEND_CRM_MODE=true
VITE_BACKEND_CRM_SALES_MODE=true
VITE_BACKEND_SUPPORT_MODE=true
VITE_BACKEND_PROJECTS_MODE=true
```

Then rebuild (or push to `main`, which does the same):

```bash
cd /www/wwwroot/Internal-Project && npm run build
```

Open the site and log in as the System Owner. Invite everyone else from
Admin → Members.

## Deploys after this

Each push to `main` runs the steps below. The backend steps only run once
`deploy/vps-prod/.env` exists.

1. Pulls the code and rebuilds the frontend.
2. Rebuilds and restarts the api and worker (`docker compose up -d --build --wait`), which applies new migrations.
3. Refreshes the built-in role grants (`seedRoles.js`).

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
- **Login works, but you're logged out immediately:** the site isn't on HTTPS, or `CLIENT_ORIGIN` doesn't exactly match the address in the browser.
- **"No active organization":** step 4's `createOrganization.js` hasn't been run, or the user isn't a member of an organization.

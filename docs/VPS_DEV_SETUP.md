# Development on the VPS database (no Docker Desktop)

Replaces Docker Desktop for day-to-day development. Postgres, Redis and
Mailpit run in Docker **on the VPS**, bound to `127.0.0.1` only; the api and
worker run on your PC with plain Node and reach those services through an
SSH tunnel. Nothing is exposed to the internet.

```
Your PC                                    VPS (Ubuntu + aaPanel)
npm run dev  ──► localhost:5434 ─┐         127.0.0.1:5434  Postgres
npm run worker ► localhost:6379 ─┼─ ssh ─► 127.0.0.1:6380  Redis
browser ───────► localhost:8025 ─┘         127.0.0.1:8025  Mailpit UI
                 localhost:1026 ─────────► 127.0.0.1:1026  Mailpit SMTP
```

This is a **development** database (`caspira_crm_dev`). Production will be a
separate database later — never run `prisma/seed.js` (public passwords)
against production.

## 1. VPS — install Docker (once)

aaPanel → **Docker** in the left menu → install. Or over SSH:

```bash
curl -fsSL https://get.docker.com | sh
docker compose version   # confirm
```

## 2. VPS — start the services (once)

Copy `deploy/vps-dev/` to the VPS (e.g. `/opt/caspira-dev`), then:

```bash
cd /opt/caspira-dev
cp .env.example .env
nano .env                # set POSTGRES_PASSWORD (openssl rand -base64 24 | tr -d '/+=')
docker compose up -d
docker compose ps        # db and redis should be "healthy"
```

Do **not** open 5434/6380/1026/8025 in the aaPanel firewall — they only need
to be reachable from the VPS itself.

## 3. Your PC — install Node.js 20 LTS (once)

Download from https://nodejs.org (20.x LTS, Windows installer), then open a
new terminal and check `node -v`.

```powershell
cd D:\Caspira-CRM\server
npm install
```

## 4. Your PC — point `server/.env` at the tunnel (once)

```
DATABASE_URL="postgresql://caspira:<POSTGRES_PASSWORD>@127.0.0.1:5434/caspira_crm_dev?schema=public"
REDIS_URL=redis://127.0.0.1:6379
SMTP_HOST=127.0.0.1
SMTP_PORT=1026
```

If the password contains `@ : / ? #`, URL-encode it (or regenerate without
them).

## 5. Your PC — open the tunnel (every session)

Keep this window open while you work:

```powershell
ssh -N -p 16441 -L 5434:127.0.0.1:5434 -L 6379:127.0.0.1:6380 -L 1026:127.0.0.1:1026 -L 8025:127.0.0.1:8025 root@202.61.87.220
```

aaPanel moved SSH off port 22 — this VPS listens on **16441**
(`ss -ltnp | grep sshd` on the VPS shows the current port). A window that
stays open with no output means the tunnel is up; check with
http://localhost:8025 (Mailpit).

## 6. Your PC — create the schema and seed (once)

```powershell
cd D:\Caspira-CRM\server
npx prisma migrate deploy
npx prisma generate
node prisma/seed.js
```

## 7. Your PC — run the backend (every session)

Two terminals (tunnel must be open):

```powershell
cd D:\Caspira-CRM\server; npm run dev          # api  → http://localhost:4000/api/v1
cd D:\Caspira-CRM\server; node src/worker.js   # worker (emails, sales deadline jobs)
```

Mailpit UI: http://localhost:8025. Tests (`npm test`) need neither the
tunnel nor the database.

## 8. Frontend against the real backend

The root `.env` sets `VITE_BACKEND_AUTH_MODE=true` (and
`VITE_BACKEND_API_BASE_URL=http://localhost:4000/api/v1`), so the Login page
signs in through the real api. The dev auto-login is disabled in this mode.

```powershell
cd D:\Caspira-CRM; npm run dev     # frontend → http://localhost:5173
```

Log in with any seeded account — username **or** email, password
`Caspira123!` (`owner`, `admin`, `teamlead`, `checker`, `user`). The seed
creates the **Caspira Dev** organization with all five as members; the
frontend picks it as the active organization at login.

Sample CRM data for that organization (idempotent, dev only):

```powershell
cd D:\Caspira-CRM\server
$env:CRM_FIXTURE_ORG_ID="<org id printed by seed.js>"; node prisma/seedCrmFixtures.js
```

Set `VITE_BACKEND_AUTH_MODE=false` to go back to the mock login. CRM/Sales
pages still read mock data until their own backend mode is wired.

## Backup / restore (on the VPS)

```bash
docker exec caspira-dev-db pg_dump -U caspira -d caspira_crm_dev -F c > caspira_dev_$(date +%F).dump
docker exec -i caspira-dev-db pg_restore -U caspira -d caspira_crm_dev --clean --if-exists < caspira_dev_YYYY-MM-DD.dump
```

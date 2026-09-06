# Backend Phase 1 — Docker Foundation, Authentication, Organizations and RBAC

This document covers local setup, day-to-day operation, and the current
state of the backend built in this phase. It extends the pre-existing
Express + Prisma + PostgreSQL backend at `server/` — it does not replace it.
See `server/README.md` for the CRM/Sales/Support/AI-gateway surface this
phase does not touch.

## Prerequisites

- **Docker Desktop** — running, with at least ~4GB memory allocated.
- **Node.js 20** — only needed if you want to run `npm test`/`prisma`
  commands directly on the host rather than through a container.

## First-time setup

```bash
git clone <this-repo>
cd Caspira-CRM
cp server/.env.example server/.env   # fill in real values — see "Environment configuration" below
docker compose up --build -d
```

Wait ~15–20 seconds for health checks, then confirm everything is up:

```bash
docker compose ps
```

You should see 5 services — `db`, `redis`, `mailpit`, `api`, `worker` — all
reporting `healthy`.

If this is a genuinely fresh database (no prior `db push`/migration
history), run the migrations:

```bash
docker exec caspira-crm-api npx prisma migrate deploy
docker exec caspira-crm-api node prisma/seed.js
```

**Windows/PowerShell users**: the commands above work identically in
PowerShell, Command Prompt, and any Unix-compatible terminal — `docker
exec`/`docker compose` are the same everywhere. The one difference:
multi-line here-strings for env values use PowerShell's `@'...'@` syntax
instead of bash's `cat <<'EOF'`, but you shouldn't need that for anything
in this document.

## Starting and stopping services

```bash
docker compose up -d              # start (or resume) everything
docker compose stop               # stop containers, KEEP all data/volumes
docker compose restart api        # restart one service (e.g. after an env change)
docker compose down                # remove containers, KEEP the named volume
```

**Never run `docker compose down -v`** as a routine command — the `-v` flag
deletes the named Postgres volume (`caspira_crm_db_data`) and every row in
it, permanently. There is no confirmation prompt. If you genuinely want to
wipe local data, see "Resetting development data" below, which does the
same thing but says so explicitly.

## Environment configuration

Real values go in `server/.env` (git-ignored, never committed) —
`server/.env.example` documents every variable with a safe placeholder,
never a real credential. Key variables this phase introduces:

| Variable | Purpose | Local default |
|---|---|---|
| `DATABASE_URL` | Postgres connection string | overridden to `db:5432` inside Docker; `127.0.0.1:5434` from the host (see note below) |
| `REDIS_URL` | Redis connection string | `redis://redis:6379` inside Docker |
| `SMTP_HOST` / `SMTP_PORT` | Mailpit SMTP | `mailpit:1025` inside Docker |
| `MAILPIT_SMTP_PORT` / `MAILPIT_UI_PORT` | Host-side Mailpit ports | `1026` / `8025` |
| `CLIENT_ORIGIN` | Allowed CORS origin + base URL used in emailed links | `http://localhost:5173` |
| `JWT_SECRET` | Signs both the legacy Bearer JWT and the new access-token cookie | — (set a real random value) |
| `ACCESS_TOKEN_TTL_MINUTES` | Access-cookie lifetime | `15` |
| `REFRESH_TOKEN_TTL_DAYS` | Refresh-session lifetime | `30` |
| `INVITATION_TTL_DAYS` | Default invitation expiry | `7` |
| `PASSWORD_RESET_TTL_MINUTES` | Password-reset link lifetime | `60` |
| `ALLOW_SYSTEM_OWNER_BOOTSTRAP`, `BOOTSTRAP_OWNER_EMAIL`, `BOOTSTRAP_OWNER_USERNAME`, `BOOTSTRAP_OWNER_PASSWORD` | System Owner bootstrap (see below) | unset (bootstrap refuses to run without these) |
| `NODE_ENV` | `production` enforces a minimum bootstrap password length | unset locally |

**Why Postgres is on host port 5434, not 5432**: this development machine
already runs two native (non-Docker) PostgreSQL Windows services on
127.0.0.1:5432 and :5433. That's an environmental fact of this particular
machine, not something inherent to the project — on a clean machine, feel
free to set `DB_PORT=5432` in a root `.env` if you prefer. Every
in-container/in-network reference (the `api`/`worker` services'
`DATABASE_URL`) always uses `db:5432` regardless, so this only affects
connecting from the host (e.g. `psql`, Prisma Studio, `npm test`).

The app **fails startup outside local development** when mandatory
security configuration (`JWT_SECRET`, `DATABASE_URL`) is missing — this was
already true of the pre-existing backend and is unchanged.

## Running migrations

```bash
docker exec caspira-crm-api npx prisma migrate deploy   # apply pending migrations
docker exec caspira-crm-api npx prisma migrate status   # check status without applying
```

To add a new migration during development (schema change first, in
`server/prisma/schema.prisma`):

```bash
docker exec -u root caspira-crm-api npx prisma migrate dev --name <description>
```

(`-u root` is needed for the container's non-root user to write the new
migration file into the bind-mounted `prisma/migrations` folder on this
machine — a Docker Desktop file-sharing quirk, not a security concern:
Postgres access itself is unaffected by which OS user wrote the migration
file to disk.)

## Seeding development data

```bash
docker exec caspira-crm-api node prisma/seed.js
```

Idempotent — safe to run repeatedly; it upserts by unique key rather than
inserting duplicates. Seeds 5 users (password `Caspira123!` for all):
`owner` (System Owner), `admin` (Organization Administrator),
`teamlead` (Department Manager), `checker` (Auditor/Checker), `user`
(Standard Employee), plus the 5 built-in Roles with real permission
grants for the organizations/members/invitations/invite_links/sessions/
audit_events module group this phase introduces.

## Initial System Owner bootstrap (production path)

The seed script above is for **local development only** — its password is
fixed and public in this repository. For a real environment, use the
dedicated bootstrap script instead, which refuses to run without explicit
opt-in and has no default password:

```bash
ALLOW_SYSTEM_OWNER_BOOTSTRAP=true \
BOOTSTRAP_OWNER_EMAIL=you@yourcompany.com \
BOOTSTRAP_OWNER_USERNAME=owner \
BOOTSTRAP_OWNER_PASSWORD='a real, unique, strong password' \
node server/scripts/bootstrapSystemOwner.js
```

It's a safe no-op if a System Owner already exists (checked first, before
anything else) — running it again never creates a second one. No ordinary
invitation or invite link can ever create a Super-Admin or Organization
Administrator either (`middleware/rbac.js`'s `canGrantRole()` blocks it
structurally, independent of any role's configured permissions).

## Accessing Mailpit

Every email this phase sends (invitations, invite-link notifications,
password reset/changed, new-membership, suspicious-session-reuse alerts)
goes to Mailpit, never a real inbox. Open the web UI at
**http://localhost:8025** to see them. SMTP itself is on port 1026 (not the
more commonly suggested 1025 — see the port-conflict note above).

## Running tests

```bash
cd server
npm test
```

Runs with `--no-file-parallelism` (Vitest's default parallel-file pool hit
a native out-of-memory crash on this machine once the suite grew past
~10 files — this flag trades a little speed for reliability). All tests
mock Prisma the same way the pre-existing `aiRoutes.test.js` does; none of
them require Docker or a live database to be running.

Frontend tests are unaffected and run exactly as before:

```bash
npx vitest run --no-file-parallelism   # from the repo root
```

## Viewing logs

```bash
docker compose logs -f api worker    # both, streaming
docker logs caspira-crm-api --tail 50
docker logs caspira-crm-worker --tail 50
```

Passwords, tokens, cookies and Authorization headers are never written to
these logs — `morgan`'s request logging only records method/path/status/
duration, and every controller redacts sensitive fields before an audit
event or error is logged (see `services/auditService.js`'s `redact()`).

## Resetting development data (⚠️ destructive — reads real data first)

There is no scripted "reset" command, deliberately — this is destructive
enough that it should never be one keystroke away from a normal workflow.
To genuinely wipe local data and start over:

```bash
docker compose down -v   # ⚠️ deletes the named Postgres volume permanently
docker compose up -d
docker exec caspira-crm-api npx prisma migrate deploy
docker exec caspira-crm-api node prisma/seed.js
```

## Backing up the development database

```bash
docker exec caspira-crm-db pg_dump -U caspira -d caspira_crm -F c -f /tmp/backup.dump
docker cp caspira-crm-db:/tmp/backup.dump ./caspira_crm_backup.dump
```

## Restoring the development database

```bash
docker cp ./caspira_crm_backup.dump caspira-crm-db:/tmp/backup.dump
docker exec caspira-crm-db pg_restore -U caspira -d caspira_crm --clean --if-exists /tmp/backup.dump
```

## Switching the frontend between mock and backend mode

The frontend's existing CRM/Sales/Support mock layer (`VITE_USE_MOCK_API`)
is completely untouched and still defaults on. This phase adds a
**separate**, not-yet-wired adapter for the new auth/organizations surface:
`src/Helpers/backendAuthClient.js`, gated by its own flag,
`VITE_BACKEND_AUTH_MODE`. Setting it to `"true"` makes `getApiMode()`
report `authSource: "backend"`, but nothing in the live Login page or
Redux `authSlice` calls this adapter yet — wiring it in is explicitly a
future, deliberate step (see "Deferred functionality" below), not
something this phase does. This keeps the two modes from ever silently
mixing: today, every real user session in this app goes through the mock
layer, full stop, regardless of this flag's value.

```
# root .env, when that future wiring happens:
VITE_BACKEND_API_BASE_URL=http://localhost:4000/api/v1
VITE_BACKEND_AUTH_MODE=true
```

## Local development credentials

**Local development only — never use these anywhere reachable by anyone
else.**

| Username | Email | Password | Role |
|---|---|---|---|
| `owner` | owner@caspira.example | `Caspira123!` | System Owner |
| `admin` | admin@caspira.example | `Caspira123!` | Organization Administrator |
| `teamlead` | teamlead@caspira.example | `Caspira123!` | Department Manager |
| `checker` | checker@caspira.example | `Caspira123!` | Auditor / Checker |
| `user` | user@caspira.example | `Caspira123!` | Standard Employee |

These log in against the **legacy** `/api/v1/user/login` Bearer-JWT
endpoint the frontend's mock-mode toggle already uses. To exercise the
**new** cookie-based `/api/v1/auth/login` endpoint directly (e.g. via
`curl` or the OpenAPI docs' "Try it out"), use the same email/password —
both endpoints check the same `users` table, just with a different session
mechanism.

## Current security limitations

- CSRF protection, rate limiting and refresh-token rotation apply only to
  the **new** `/api/v1/auth/*` and `/api/v1/organizations/*` surface — the
  pre-existing `/api/v1/user/*` Bearer-JWT endpoints have none of these and
  are unchanged from before this phase.
- No file-upload handling anywhere (pre-existing limitation, unchanged).
- Request-body validation on the new routes is done by hand per
  controller, not a schema-per-endpoint library (`zod`, already a
  dependency, is used only by the AI-gateway routes today) — malformed
  input generally gets a `VALIDATION_ERROR` 400, but coverage isn't
  exhaustive.
- `EmailVerificationToken` rows are never actually created by any code
  path yet — the table, the consuming endpoint (`POST /auth/verify-email`)
  and the email template all exist and work correctly if a token is
  created, but nothing creates one, since this phase has no public
  self-registration flow to trigger it from. New users created via
  invitation/invite-link acceptance instead have `emailVerifiedAt` set
  directly at creation time (holding the invitation token already proves
  email possession).
- The OpenAPI docs cover this phase's ~29 new routes only, not the
  pre-existing legacy CRM/Sales/Support/AI-gateway routes.

## Features intentionally deferred

- CRM record persistence (Leads, Contacts, Companies, Deals, etc.) —
  **Backend Phase 2**, not started. The database tables for these already
  exist from before this phase (see `server/prisma/schema.prisma`) but
  are not organization-scoped and are not what this phase's RBAC governs.
- Wiring `backendAuthClient.js` into the actual Login page / Redux
  `authSlice` — the adapter exists and is tested, but switching the live
  UI over is a frontend change explicitly out of this phase's scope.
- Any real external integration or AI provider connection — none exist;
  the pre-existing AI gateway (Anthropic/OpenAI/OpenRouter) is untouched
  and unrelated to this phase.
- A public self-registration endpoint (deliberately not built — the spec
  explicitly asked for controlled invitation/invite-link-only onboarding
  plus a guarded System Owner bootstrap, not open sign-up).
- System-ownership transfer — a separate future workflow, not built.

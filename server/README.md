# Caspira CRM — Backend

Node.js + Express + Prisma + PostgreSQL. Runs alongside the frontend's
existing mock layer — the frontend still defaults to mocks (`VITE_USE_MOCK_API`
untouched at the project root) until you deliberately switch it over.

**See `../docs/BACKEND_PHASE1.md` for the full setup/operations guide**
(Docker Foundation, environment variables, migrations, seeding, the System
Owner bootstrap, Mailpit, tests, backup/restore). This file stays focused
on quick orientation and architecture notes.

## Running

```
docker compose up --build -d   # from the repo root — starts db, redis, mailpit, api, worker
docker compose ps              # confirm all 5 are healthy
```

API listens on `http://localhost:4000/api/v1` (OpenAPI docs for the new
Phase 1 routes at `http://localhost:4000/api/v1/docs`). Postgres is on
`localhost:5434` from the host (`trust` auth — local dev only; port 5434
not 5432, since this dev machine already runs native Postgres services on
5432/5433 — see the comment in `../docker-compose.yml`). Mailpit's web UI
is at `http://localhost:8025`.

First-time setup (or after a schema change):
```
docker exec caspira-crm-api npx prisma migrate deploy
docker exec caspira-crm-api node prisma/seed.js
```

(The backend used `prisma db push` with no migration history before
Backend Phase 1; the existing schema was baselined as migration
`0001_baseline` so `migrate deploy` now works cleanly against the live
database — see `prisma/migrations/`.)

**Seeded logins** (password for all: `Caspira123!`): `owner` (Super-Admin),
`admin` (Admin), `teamlead` (Team-Leader), `checker` (Checker), `user` (User).

## Picking up code changes

`node --watch` is configured but doesn't reliably see changes through the
Windows Docker Desktop bind mount — after editing anything in `src/` or
`prisma/`, run:
```
docker compose restart api
```

## Switching the frontend from mocks to this backend

In the repo root's `.env`:
```
VITE_API_BASE_URL=http://localhost:4000/api/v1
VITE_USE_MOCK_API=false
```
Route paths were built to match the mock layer's exactly (see `src/app.js`),
so the frontend's existing Redux thunks need no changes. Not yet verified
end-to-end against the real frontend — do this deliberately, one module at a
time, rather than flipping it globally and hoping.

## AI Gateway (Anthropic / OpenAI / OpenRouter)

Real provider calls for the AI Intelligence Center live here, never in the
frontend — a key placed in frontend code ships to every browser. Paste your
own key(s) into `server/.env` (see `.env.example`) yourself; leave any of
them blank to leave that provider "not configured" — `GET /api/v1/ai/providers`
reflects this honestly rather than the frontend implying a connection that
doesn't exist. At least one key is required for the two POST routes below to
work; none are required for the rest of the app.

```
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
OPENROUTER_API_KEY=
```

Routes (`src/routes/aiRoutes.js`, mounted at `/api/v1/ai`, `authenticate`
only — same enforcement level as every other route file today):
- `GET /providers` — which providers are configured (never leaks a key value).
- `POST /narrative` — rewrites an already-computed executive summary as
  better prose. The deterministic numbers stay authoritative: the model's
  response is checked by `guardrails.js`'s `verifyNoNewNumbers` and silently
  discarded (falling back to the original text) if it introduces any figure
  not present in the request's `facts`.
- `POST /explore` — "Explore Mode": the model reasons directly over a batch
  of raw (already RBAC-scoped) records and returns free-form findings. These
  are never verified — every citation and suggested-action target is
  checked against the records actually sent and dropped if it doesn't
  resolve, but the observations themselves are exactly as reliable as the
  model that wrote them. Always shown behind an explicit "Unverified"
  label, both in the API response's `disclaimer` and the frontend's UI.

Both POST routes share a per-user in-memory cooldown (`guardrails.js`,
~8s, 429 on violation) — a dev-app safeguard against runaway paid calls,
not a production rate limiter (see `src/services/ai/`'s test files for what
is and isn't covered).

## Backend Phase 1 — session-based auth, organizations, RBAC

A second, separate auth surface lives alongside the legacy one below:
`/api/v1/auth/*`, `/api/v1/organizations/*`, `/api/v1/invitations/*`,
`/api/v1/join/*` — httpOnly cookies (not Bearer/localStorage), CSRF
protection, Redis-backed rate limiting, rotating refresh sessions with
reuse detection, organizations/memberships/role-assignment, invitations
and invite links with real transactional email through a BullMQ worker +
Mailpit, and append-only audit events. See `../docs/BACKEND_PHASE1.md`
for the full guide and `src/middleware/rbac.js` for how org-scoped
authorization is centralized (`requireOrgPermission` — never a scattered
`role === "Admin"` check).

This is genuinely separate code, not a replacement — every existing
route below keeps using the legacy Bearer-JWT `/api/v1/user/*` flow
unchanged.

## Architecture notes

- **`id` vs `_id`** — Prisma models use plain `id`; every response passes
  through `src/utils/serialize.js`'s `toApi()`, which renames it to `_id`
  (what the frontend already expects everywhere) and strips credential
  fields from any nested `User` relation.
- **Status/type enums are plain strings**, validated at the application
  layer — not native Prisma enums — because many existing frontend enum
  values contain spaces/slashes ("Pending Review", "Auditor / Checker")
  that don't map cleanly onto Prisma enum identifiers.
- **Activity logs, audit logs, notes, amendment history** are `Json`
  columns, not child tables — they're never queried independently of their
  parent record in the frontend today. Line items (Quote/Order/Contract/Deal)
  *are* real child tables since they need structured, queryable fields.
- **`src/utils/crudFactory.js`** generates list/get/create/update/archive/
  restore for straightforward entities. Modules with real status-transition
  logic (Deals, Quotes, Orders, Contracts, Tickets) have bespoke controllers.

## What's genuinely implemented vs. simplified

Real: JWT auth, bcrypt password hashing, TOTP 2FA (setup/confirm/verify —
an actual improvement over the mock's always-pass stub), RBAC role gating,
Lead→Company/Contact/Deal conversion, Deal win/loss, Quote approval
workflow, Order fulfillment with auto-promotion, Contract dual-signature
auto-promotion with renewal/amendment history, invoice payment→status
derivation, Ticket SLA deadline calculation.

Simplified / not yet built: request body validation is minimal on the
original CRUD routes (relies on Prisma throwing on bad data, not a full Zod
schema per endpoint) — the AI gateway routes are the exception, validating
both the incoming request and the model's own JSON output with `zod` (see
`src/services/ai/schemas.js`); no refresh-token rotation (a single
long-lived JWT); no file upload handling (avatar/attachment endpoints accept
a URL, not a multipart upload); no rate limiting; password-reset email
sending is not implemented (the endpoints exist as stubs); the RBAC
permission-catalog endpoint returns a smaller catalog than the frontend's
full `mockRbacData.js` (same shape, fewer modules).

# Backend Phase 2 — CRM Core Data Persistence

This document covers what Backend Phase 2 added on top of Phase 1
(Docker, session auth, organizations, RBAC — see `docs/BACKEND_PHASE1.md`).
It extends the pre-existing `Lead`/`Contact`/`Company`/`Activity` Prisma
models and replaces their non-org-scoped legacy routes; it does **not**
touch Deals/Pipelines/Products/Quotes/Orders/Contracts (Phase 3) or
Support/Projects/Finance/HR/AI-provider/payment surfaces.

## Architecture

```
server/src/routes/crm/{leadRoutes,contactRoutes,companyRoutes,activityRoutes,noteRoutes,tagRoutes}.js
server/src/controllers/crm/{leadsController,contactsController,companiesController,activitiesController,notesController,tagsController}.js
server/src/services/crm/{normalizationService,scopeService,duplicateDetectionService,mergeService,leadConversionService,activityLifecycleService,crmSummaryService,crmContactCompanySummaryService}.js
server/src/middleware/idempotency.js
```

Controllers stay thin (validate shape, call a service, shape the
response); RBAC lives in `middleware/rbac.js`'s `requireCrmOrgPermission`;
business rules live in `services/crm/*`; every mutation records an audit
event via the existing `services/auditService.js`.

## Stable-ID strategy

No new ID scheme — every record keeps its existing `cuid()` `id` (exposed
as `_id` in API responses via the existing `toApi()`). The frontend's own
fixtures already use opaque, non-sequential IDs, so there was no
compatibility gap to solve.

## Routes

All mounted under `/api/v1/crm/*`, session-cookie authenticated
(`authenticateCookie`) and RBAC-gated per module+action
(`requireCrmOrgPermission(moduleId, action)`), with `organizationId`
resolved from the query string (GET) or request body (mutations) — never
trusted without a live membership check.

| Resource | Routes |
|---|---|
| Leads | `GET/POST /crm/leads`, `GET/PATCH /crm/leads/:id`, `POST /:id/{archive,restore,assign,convert}`, `GET /:id/duplicate-candidates`, `GET /summary`, `POST /bulk` |
| Contacts | same shape, plus `GET /:id/merge-preview`, `POST /:id/merge` |
| Companies | same shape, plus `GET/POST /:id/contacts`, `PATCH/DELETE /:id/contacts/:contactId` (company↔contact relationship) |
| Activities | `GET/POST /crm/activities`, `GET/PATCH /:id`, `POST /:id/{complete,cancel,reopen,archive,restore,assign}`, `GET /summary`, `POST /bulk` |
| Notes | `GET/POST /crm/notes` (one of `leadId`/`contactId`/`companyId`/`activityId` required), `PATCH/:id`, `POST /:id/archive` |
| Tags | `GET/POST /crm/tags`, `PATCH/:id`, `POST /:id/archive`, `POST /assign`, `DELETE /:id/assignment`, `GET /for-record` |

Static paths (`/summary`, `/bulk`, `/assign`, `/for-record`) are declared
**before** their corresponding `/:id` route in every router file — Express
matches routes in declaration order, so this ordering is load-bearing, not
cosmetic.

## Database models and migrations

Additive only — no destructive changes to any existing table.

- **Extended in place**: `Lead`, `Contact`, `Company`, `Activity` (organization
  scoping, normalized search fields, owner/audit-membership fields,
  lifecycle/qualification fields, `version` for optimistic concurrency; see
  `server/prisma/schema.prisma` for the full field list — search for "Backend
  Phase 2" comments).
- **New tables**: `CrmNote`, `CrmTag`, `CrmRecordTag`,
  `CompanyContactRelationship`, `RecordMerge`.
- **Migrations** (chronological): `phase2_crm_core` (the main additive
  migration), `crm_primary_contact_partial_index` (hand-written partial
  unique index — Prisma's schema DSL can't express "at most one row where
  X is true"), `enable_pg_trgm` (fuzzy-name duplicate detection),
  `activity_status_and_cancelled_at` (corrects the `Activity.status`
  default to match the frontend's actual vocabulary and adds the
  `cancelledAt` column the cancel lifecycle transition needs).

`organizationId` is **nullable** on Lead/Contact/Company/Activity —
deliberate, since pre-existing seed rows predate the organization concept.
Every Phase 2 query filters `WHERE organizationId = ?`; a null row is
simply invisible through any Phase 2 endpoint, never a state requiring a
risky backfill.

## Shared fixture import

`server/prisma/seedCrmFixtures.js` imports a small, hand-curated set of
Leads/Contacts/Companies (mirroring the frontend's field shapes) into a
real organization, idempotently:

```bash
CRM_FIXTURE_ORG_ID=<your organization id> node server/prisma/seedCrmFixtures.js
```

It is **not** part of `prisma db seed` and never runs automatically —
run it only when you explicitly want sample CRM data in an organization.
Idempotency is by `(organizationId, normalizedEmail)` /
`(organizationId, normalizedDomain)` lookup before create, so rerunning it
against the same organization never duplicates records. It refuses to run
with `NODE_ENV=production`.

## Notes and tags

Both use a **four-nullable-FK** association pattern (`leadId`/`contactId`/
`companyId`/`activityId`), app-validated to have exactly one set, rather
than a `recordType` string + `recordId` polymorphic column — real FKs let
Postgres enforce organization-consistency via a join and rule out building
a query from a client-controlled type string. Every note/tag operation
re-checks the caller's **record scope** (not just organization membership)
against the referenced Lead/Contact/Company/Activity, so a Sales-Rep-scoped
caller can't read or tag a record outside their own scope by supplying its
ID directly. Note bodies are HTML-stripped (`sanitizeNoteBody`) before
storage. Tag names are unique per organization after normalization; tag
colors are restricted to a fixed named-token allowlist (never arbitrary
CSS).

## Record relationships

`CompanyContactRelationship` is a new many-to-many junction (a Contact may
belong to more than one Company) kept **alongside** the legacy
`Contact.companyId`/`isPrimary` columns, synced transactionally whenever
the junction's primary designation changes — so existing consumers of the
old columns keep working. At most one **active** primary Contact per
Company is enforced by a hand-written partial unique index at the database
level, plus a defensive demote-then-promote transaction in the controller.

Activities link to Lead/Contact/Company (and, for Phase 3, Deal) via plain
FKs, but **every write validates that the referenced record shares the
activity's `organizationId`** in application code — Postgres FKs can't
express "same organizationId as me" across tables, so this is never left
implicit.

## Deterministic summaries

`crmSummaryService.js` / `crmContactCompanySummaryService.js` compute every
number from a live, scope-filtered query at request time — counts,
group-bys, "without a primary contact," "without recent activity" — never
a stored counter and never LLM-generated. Every summary endpoint applies
the caller's record scope exactly like list/search.

## Duplicate detection

`duplicateDetectionService.js`, ranked and documented, no confidence
percentages:

1. Exact `normalizedEmail` match
2. Exact `normalizedPhone` match
3. Fuzzy name match (Postgres `pg_trgm` `similarity()`, threshold 0.4)
   scoped to the same company/domain

Every candidate list is filtered to the caller's record scope before
fuzzy matching runs, so an authorized-scope caller never sees a duplicate
candidate they couldn't otherwise view.

## Controlled merging

`mergeService.js`: `mergePreview()` is read-only (field conflicts, and
notes/tags/activities/relationships that would move). `merge()` requires:
same organization, a `merge`-action grant, a non-empty written `reason`,
an `Idempotency-Key` header, and the destination's current `version`
(optimistic concurrency) — all inside one transaction. The source record
is archived (never hard-deleted) with an audit trail; one `RecordMerge`
row is written.

## Lead conversion

`leadConversionService.js`: one transaction, an atomic status-guarded
claim (`updateMany` with a `convertedContactId: null` guard) so two
concurrent conversion requests can't both succeed — verified live with two
simultaneous requests against the same lead: one succeeded, one got a
clean `409 CRM_CONVERSION_CONFLICT`. Any client-supplied existing
Contact/Company ID is verified to belong to the same organization before
being linked. **Never creates a Deal** — that's explicitly Phase 3.

## Archive/restore and bulk actions

Archive requires a written reason (Leads/Activities/Companies) and sets
`archivedAt`/`archived`; archived records reject ordinary edits (`400
CRM_INVALID_TRANSITION`, "restore it first"). Bulk operations
(`POST /bulk` on every resource) cap batch size at 200 records
(`CRM_BATCH_LIMIT_EXCEEDED` above that), re-authorize every record
individually against the caller's scope, and silently exclude
out-of-scope IDs from the affected count rather than partially leaking
which records exist.

## RBAC and record scope

`requireCrmOrgPermission(moduleId, action)` (in `middleware/rbac.js`)
resolves `organizationId` from the query string or request body — there's
no `:organizationId` path segment on CRM routes — and validates it against
a real, active membership exactly like Phase 1's path-based
`requireOrgPermission`; both share one `authorizeOrgAccess()` helper and
give the same 404-not-403 non-enumeration guarantee.

`scopeService.js`'s `resolveCrmScopeWhere()` is the separate, second
dimension: a Role's `defaultScope` (Own/Assigned/Team/Department/
Organization/System-wide) says *which records*, independent of
`permissionGrants` (*which actions*). When a membership holds more than
one role granting the same module, the caller gets the **broadest** scope
among them.

## Sensitive-field protection

`contactsController.js`'s `maskSensitive()` (email/phone/consent/location
fields, gated on `contacts`+`view_sensitive_fields`) and
`companiesController.js`'s `maskFinancial()` (revenue/currency, gated on
`companies`+`view_financial_fields`) run server-side on every list/detail/
duplicate-candidates/merge response, setting an explicit
`sensitiveFieldsRedacted`/`financialFieldsRedacted: true` flag rather than
silently omitting the field. Verified live against the `checker` (Auditor)
role, which has no `view_sensitive_fields` grant.

## Audit behavior

Every create/update/archive/restore/assign/convert/merge/tag/note action
records one audit event via the existing `services/auditService.js` — no
second audit table, no separate audit convention.

## Frontend API adapter

`src/Helpers/backendCrmClient.js` — same shape as Phase 1's
`backendAuthClient.js` (httpOnly cookies, double-submit CSRF, one-shot
refresh-on-401), gated by a new `VITE_BACKEND_CRM_MODE` env flag (separate
from `VITE_BACKEND_AUTH_MODE` and the legacy `VITE_USE_MOCK_API` — never
mixed). **Not wired into any live CRM page or Redux slice this phase** —
the mock CRM layer (`mockCrmData.js`, `redux/crm/*Slice.js`) remains the
active data source. Set `VITE_BACKEND_CRM_MODE=true` and
`VITE_BACKEND_API_BASE_URL=http://localhost:4000/api/v1` in your `.env`
only once you're ready to build that switch-over as its own piece of work.

## Docker Desktop verification

All 5 services (`db`, `redis`, `mailpit`, `api`, `worker`) remained
healthy throughout this phase's migrations and restarts
(`docker compose ps`). Every endpoint group was exercised live against
the running stack with `curl` (not just unit-test mocks) — creation,
listing/filtering, lifecycle transitions (including a rejected invalid
transition), cross-organization rejection, archive/restore, note
sanitization, tag uniqueness and color validation, tag assignment, and
the bulk batch-size limit.

## Tests executed

`cd server && npm test` (`vitest run --no-file-parallelism`) — **120
tests passing** across 17 files, including new suites for
`normalizationService`, `scopeService`, `mergeService`,
`activityLifecycleService`, and 5 new `requireCrmOrgPermission` cases in
`rbac.test.js`.

## Lint and build results

No frontend route, component, or Redux slice was touched by this phase —
the existing frontend test suite and build are unaffected by anything in
this document.

## Deferred functionality

Explicitly **not** part of this phase, per its own scope boundary:
Deals/Pipelines/Products/Quotes/Orders/Contracts (Phase 3), Support,
Projects, Finance, HR, provider integrations/OAuth, AI-provider calls,
production email campaigns, real file storage, payment processing,
automatic (non-human-confirmed) merging or conversion, and wiring
`backendCrmClient.js` into any live frontend page. The CRM backend is not
complete end-to-end — this phase covers persistence for Leads, Contacts,
Companies, and Activities plus their notes/tags/relationships only.

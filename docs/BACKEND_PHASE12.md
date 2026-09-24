# Backend Phase 12 — Analytics Warehouse, Scheduled Reports, Executive BI and Governed Data Exports

**Status.** The analytics warehouse, governed metrics, dashboards, reports, schedules and exports are built and verified against the development database:
- live HTTP check 14/14;
- server tests 540/540;
- frontend tests 1563/1563;
- build passes; lint shows only the 43 pre-existing problems.

**What this is not:**
- **Not deployed.** Deployment is deferred until all backend phases are finished (see "Deploy notes").
- **Not audited financial statements.** Finance analytics are operational reporting from the warehouse; every finance screen and export says so.
- **Not real-time.** Warehouse loads run on a schedule (incremental every 15 minutes, snapshots daily); every figure shows when its data was last loaded.
- **No new warehouse engine or BI SaaS.** Everything runs in the existing PostgreSQL, API, worker and Redis.

## Architecture

- **Transactional services stay authoritative** for current state, permissions, approvals, postings and sensitive-field access. The warehouse is authoritative only for snapshots, aggregates and trends, and never writes business data.
- **Warehouse:** fact tables `analytics_fact_*` and dimension tables in the existing database, plus an `analytics` schema for materialized views.
- **Loading:** a job runner (`server/src/analytics/warehouse/jobs.js`) runs in the existing worker:
  1. extract incrementally from a checkpoint watermark;
  2. map to facts (IDs and approved reporting attributes only);
  3. upsert idempotently;
  4. maintain dimensions;
  5. reconcile and record data-quality issues;
  6. refresh the materialized views and bump the cache version.
- **Semantic layer:** `server/src/analytics/query/queryService.js`. The browser sends governed metric keys, whitelisted dimensions and filters, a date range, comparison, grain and currency mode, never SQL, tables or columns. The server builds parameterized SQL from the code-defined metric; every identifier comes from a server whitelist.
- **Record scope:** the caller's source-record scope (the same `defaultScope` rules as the CRM) is applied in the `WHERE` clause **before** aggregation.
- **Code layout:**

  | Area | Location |
  |---|---|
  | Calendar and currency | `server/src/analytics/common` |
  | Sources, upsert, dimensions, jobs, reconciliation | `server/src/analytics/warehouse` |
  | Definitions and registry | `server/src/analytics/metrics` |
  | Reports and schedules | `server/src/analytics/reports` |
  | File writers and export governance | `server/src/analytics/exports` |
  | Controller | `server/src/analytics/api` |
  | Routes | `server/src/routes/analyticsRoutes.js` |

## Schema

Migration `20260927090000_phase12_analytics_warehouse` adds 36 tables, the `analytics` schema, a date dimension seeded for 2015–2040, and three materialized views with unique indexes (so they refresh concurrently): `analytics.mv_pipeline_daily`, `mv_invoice_monthly` and `mv_activity_daily`.

- **Every tenant row carries `organizationId`.**
- **Money:** `Decimal(18,2)`. The AI cost column is `Decimal(14,6)`.
- **Indexes:** fact tables are indexed on organization plus business date, and on organization plus owner.

## Dimensions

- **`analytics_dim_date`:** calendar date, ISO week, month, quarter and weekday.
- **`analytics_dimensions` and `analytics_dimension_versions`:**
  - *Slowly changing, type 2:* owner (department, team, status and roles tracked) and company (industry, country, archived). A change closes the current version (`effectiveTo`) and opens a new one, so historical ownership stays explainable.
  - *Lookups:* project, currency, lead source, contract type, payment method, support queue, AI provider, AI model, stage and country.
  - *Every version carries:* source ID, organization, effective-from/to, current flag, source-updated and warehouse-updated timestamps, and a deleted flag.

## Facts

| Group | Facts |
|---|---|
| **CRM** | leads (lifecycle, qualification, conversion, contact-info flag), activities (due, completed, follow-up) |
| **Sales** | deal events (creation plus every stage transition; won/lost from the stage classification), daily deal snapshots, quotes, orders, contracts (end date, renewal-notice date) |
| **Support and projects** | tickets (first response, resolution, SLA breaches, reopen count, open flag), projects, tasks, time entries |
| **Finance** | invoices (amount, paid, due), payments, expenses, budget-versus-actual snapshots |
| **AI** | usage ledger (tokens, estimated cost, latency, outcome), AI events (proposals, safety events excluding evaluation runs, feedback, Copilot answers) |
| **Aggregated snapshots** | AR aging, ticket backlog, renewal exposure, project health, AI budget consumption |

Facts hold IDs and approved attributes only, never full sensitive payloads; a unit test checks a lead fact carries no email. Missing history is not reconstructed: deal snapshots start on the first load, so earlier periods show "No prior-period value".

## Incremental refresh

- **Checkpoints:** one per organization and source (`analytics_job_checkpoints`), holding the watermark (`updatedAt`, or `createdAt` for append-only ledgers) and the last source ID.
- **Paging:** by `(watermark, id)` in batches of 500, with a 5-minute late-arrival overlap.
- **Retries never duplicate facts:**
  - loads use `INSERT … ON CONFLICT (organization, source key) DO UPDATE`;
  - every value is a bound parameter cast to its column's catalog type;
  - `RETURNING (xmax = 0)` counts inserted versus updated rows.
- **Locking:** one active job per organization and source, claimed with a conditional update. A duplicate request returns the existing job.
- **States:** Queued → Extracting → Transforming → Loading → Validating → Reconciling → Completed / Completed with warnings / Failed / Dead letter.
- **Retries:** up to 3; then Dead letter. Jobs stuck for more than 30 minutes are requeued.
- **Refresh modes:**
  - incremental (every 15 min);
  - daily snapshot (after 01:00 organization-local time);
  - manual refresh (`analytics_warehouse.refresh`);
  - backfill;
  - full rebuild: `analytics_warehouse.rebuild`, typed confirmation `REBUILD <source>`, disabled in production unless `ANALYTICS_ALLOW_REBUILD=true`.
- **Job record:** source, type, watermark from/to, rows read/inserted/updated/deleted/rejected, reconciliation, failure category, safe error, correlation ID. Worker logs never include record contents.

## Snapshots

- **Daily deal snapshot:** every open deal, plus deals closed in the last 400 days. Records stage classification, amount, weighted amount (value × probability), base-currency amounts, expected/actual close, stage-entered time, last activity, next action, owner and whether the deal has products.
- **Daily aggregates:**
  - AR aging buckets (current, 1–30, 31–60, 61–90, 90+) per currency and owner;
  - ticket backlog by priority, owner, team and department (with oldest age);
  - renewal exposure (contracts ending within 90 days);
  - project health;
  - organization AI budget consumption against soft and hard limits.
- **Budget versus actual:**
  - planned from the active budget version's lines;
  - actual from **posted** journal lines on the budgeted accounts within the fiscal year.
- **Semi-additive metrics** (pipeline value, open deals, budgets) use the last snapshot in the period and are never summed across days.

## Reconciliation

After every load:
- **Counts:** active source records, bounded by the checkpoint watermark, versus non-deleted facts.
- **Money totals:** exact decimal totals (quotes, orders, invoices, payments, expenses).
- **Orphans:** facts whose source row was hard-deleted are marked deleted.
- **Missing dimensions:** facts referencing an owner with no dimension row.
- **Conversion gaps:** rows with no approved exchange rate.

Each run is stored in `analytics_reconciliation_runs`. A failed count or money check opens a High data-quality issue and marks the dependent metrics stale on every dashboard.

## Data quality

`analytics_data_quality_issues` opens, refreshes and auto-resolves issues. Issues carry **aggregate counts only**, never record details.
- **Types implemented:** reconciliation difference, orphan fact, missing dimension, invalid rate (conversion unavailable), stale source (no successful load for 2 hours).
- **Surfaced:** on the Data Warehouse page, in `/analytics/freshness`, and as `freshness.stale` plus `issues` on every affected metric.

## Metric registry

- **Code implementation:** 56 metrics are defined in `server/src/analytics/metrics/definitions.js`, each declaring:
  - definition, formula, sources and source fields;
  - fixed conditions, grain, allowed dimensions;
  - currency behavior, additivity, null behavior;
  - owner, reviewer, permission module, sensitivity, freshness target and unit.
- **Registry and versions:**
  - `analytics_metrics` and `analytics_metric_versions` version the governed definition (checksum per version);
  - **published versions are immutable**: publishing a new version retires the previous one with a deprecation date;
  - administrators (`analytics_metrics.manage`) can draft and publish description, owner, reviewer and freshness changes, but the formula and sources change only with a code release (the API refuses a `formula` edit);
  - retired metrics cannot be queried.
- **Metric types:** count, count distinct, sum, average, ratio (computed from its numerator and denominator metrics, never averaged), current value ("as of today") and snapshot. Averages, ratios and distinct counts are never re-added across groups.
- **Distinct names:** order value, invoiced, payments received, outstanding receivables, pipeline and weighted pipeline, expenses, budget planned/actual. There is no "revenue", "profit" or "cash balance" metric.

## Sales, support, project, finance and AI metrics

| Area | Metrics |
|---|---|
| **Sales** | leads created, qualified, converted, lead conversion rate; deals created, won, lost, closed, win rate; open pipeline value, weighted pipeline, open deals, open deals without a next action; quoted value, quotes accepted; order value; contracts ending (renewal exposure) |
| **Activities** | created, completed, overdue (current), completion rate |
| **Support** | tickets created, resolved, open (current); average first response; average resolution time; response-SLA breaches, SLA-tracked tickets, breach rate; reopened tickets. No CSAT (none is invented). |
| **Projects** | active projects, projects at risk (current); tasks completed, overdue tasks; hours logged, billable hours, billable ratio |
| **Finance** (all *sensitive*) | invoiced, payments received, outstanding receivables, overdue receivables (current), expenses, budget planned, budget actual |
| **AI** | requests (shadow evaluations excluded), failed requests, failure rate, estimated cost (USD, "estimate — not an invoice"), tokens, average latency, proposals, proposals executed, safety events, helpful feedback, helpful rate |

## Currency

- **Stored:** every monetary fact keeps the original currency and amount, the base currency, the base amount, the rate date, the rate version and a conversion status.
- **Rates:** approved Finance exchange rates are copied into `analytics_exchange_rates` (versioned). Conversion uses the rate **effective on the business date**, never today's rate for history, with direct or inverse lookup.
- **No rate:** the base amount stays empty, the status is "Unavailable", and results say "Currency conversion unavailable for part of this result." Unavailable rows are excluded from the base total and counted.
- **Results carry:**
  - the base total **and** a per-currency breakdown;
  - in "original currencies" mode, one value only when a single currency is present; otherwise a per-currency list with "Multiple currencies are shown separately and not added together."

## Time zones and fiscal calendars

- **Business dates:** timestamps stay UTC; the business date is the organization's local date (from `settings.timeZone`, computed with `Intl`, so DST is safe).
- **Fiscal calendar:** `analytics_fiscal_calendars` holds each organization's time zone, base currency (from Finance settings) and fiscal-year start month (from the first fiscal year).
- **Periods:** presets cover this and last month, quarter, fiscal quarter, year, fiscal year, and the last 30/90 days. Comparisons are the previous period of equal length or the same period last year.
- **Comparison labels:** "New from zero.", "No prior-period value.", "No change (both zero).", and "Comparison unavailable" for current-value metrics. A percentage is never shown when the prior value is zero.

## Executive BI and department dashboards

| Route | Contents |
|---|---|
| `/analytics/overview` | executive summary across sales, activities, support, projects, finance and AI |
| `/analytics/sales` | the sales metrics; lead trend; pipeline by stage |
| `/analytics/activities` | activity volume, completion and overdue; trend; by type |
| `/analytics/support` | volume, response and resolution times, SLA, backlog; trend; by priority |
| `/analytics/projects` | active projects, health, tasks, time; trend; by health |
| `/analytics/finance` | invoicing, collections, receivables, expenses, budgets (financial badge and disclaimer) |
| `/analytics/ai` | usage, reliability, cost estimate, governed actions, feedback |

- **Every dashboard shows:**
  - the period, time zone, base currency and comparison period;
  - per metric: value, per-currency breakdown, comparison with absolute and percentage change (only when valid), definition and version on demand, and freshness (last load, stale flag);
  - drill-down to the records within the viewer's access;
  - an AI explanation for members with AI access;
  - the "not audited financial statements" disclaimer.
- **Hidden metrics:** metrics the role cannot read are omitted with "Additional restricted information is available to authorized roles."
- **Overview grant:** it exposes the overview's non-sensitive metrics (still record-scoped); financial metrics always need the finance grant. There is no fabricated overall score.
- **Charts:** every chart has a text summary and a "Show data table" alternative, and uses no color-only encoding.
- **Drill-down:**
  - re-authorizes against the source module (`view`) and applies the same scope and filters;
  - returns IDs and reporting attributes only (at most 200);
  - links only to real routes (lead, deal, quote, order, contract, ticket, project and invoice detail pages, or the activities, tasks, payments and expenses lists);
  - is audited.

## Report builder

- **Routes:** `/reports` (list and viewer), `/reports/builder` and `/reports/builder/:id`.
- **Inputs:**
  - name, description and visibility;
  - metrics (only published metrics the author can read, grouped by area);
  - group-by (only the dimensions **every** selected metric supports);
  - over-time grain, period (preset or custom), comparison, currency mode;
  - visualization (table, bar, line, key figures).
- **Preview** runs the governed query with the author's access. **Save** stores an immutable version; every definition change is a new version. **Clone** gives a private copy re-validated against the cloner's grants.
- **Visibility:** private, shared (members or roles), team, department, organization, executive and template.
  - Visibility decides who may **open** a report.
  - **Running it always uses the viewer's own grants and record scope**, so sharing never grants data. In the live check, a user viewing an admin's shared report saw 37 activities to the admin's 42.
  - An unreadable report returns 404.

## Schedules

- **Frequencies:** once, daily, weekly, monthly and quarterly (day of month 1–28), at a wall-clock time in the schedule's IANA time zone. Custom cron is not supported.
- **Time handling (DST-safe):** a time skipped by a spring-forward change runs at the next valid minute; a repeated time runs at its first occurrence. Unit tests cover New York DST and the next weekly, monthly and quarterly runs.
- **Idempotency:** each occurrence is claimed once through a unique occurrence key, so a second worker tick cannot deliver it twice. `run-now` queues the next occurrence immediately.
- **Policies:**
  - *stale data:* skip and notify the owner, deliver with a warning, or deliver;
  - *failure:* notify the owner, retry, or skip;
  - *expiry:* stops a schedule; a one-time schedule completes after its run.
- **Pausing:** paused, deleted and expired schedules never run. Archiving a report pauses its schedules.

## Recipient authorization

Before **every** delivery the worker re-checks:
- the owner is still an active member with the schedule grant (otherwise the schedule is paused);
- the report still exists and isn't archived;
- the freshness policy;
- for **each** recipient (members, or roles expanded to active members): active membership and report access. Recipients who lost access are skipped and recorded.

Each delivered recipient gets an export generated with **their own** grants and scope. Delivery methods:
- **In-app:** the recipient's Exports inbox.
- **Email with a sign-in link** (through the outbox): no figures in the body, and no attachment.

External addresses and attachments are rejected by validation.

## Exports

- **Formats:** CSV, XLSX, PDF and JSON, written without third-party libraries:
  - CSV: UTF-8 with a byte-order mark;
  - XLSX: a stored zip with inline strings, never formulas;
  - PDF: a minimal A4 landscape, paginated with a watermark footer.

  JSON is limited to technical roles (metric administrators and warehouse operators).
- **Formula-injection protection:** any cell starting with `= + - @`, tab, carriage return or `|` (and not a number) is prefixed with `'`.
- **Frozen query:** the export's query is frozen when requested. Generation re-checks the requester's **current** export and metric grants and runs with their current scope; a job can never broaden what was authorized.
- **Sensitive exports** (any financial metric, classification *Confidential*):
  - need `analytics_exports.sensitive`;
  - need approval by **someone else** with `approve`, so self-approval is refused.
- **Storage:**
  - AES-256-GCM encryption with the integration keyring, bound to the organization and export ID;
  - SHA-256 integrity check on download;
  - expiry after 7 days (`ANALYTICS_EXPORT_EXPIRY_DAYS`), after which the file bytes are erased; revoking also erases them.
- **Downloads:**
  - require a session, and are allowed only for the requester or a recipient;
  - the limit is enforced atomically (live check: third download → 429);
  - responses are `no-store` and `nosniff`.
- **File metadata:** title, generation time, range, time zone, base currency, metric versions, scope note, notes, disclaimer and the requester watermark.
- **Audit:** request, approval or rejection, generation (rows, bytes, format), each download, and revocation. Exported values are never logged.

## RBAC and sensitive data

- **Permission modules** (group "Analytics & Reports"):

  | Module | Actions |
  |---|---|
  | `analytics_overview`, `_sales`, `_activities`, `_support`, `_projects`, `_finance`, `_ai` | `read` |
  | `analytics_metrics` | `read`, `manage` |
  | `analytics_reports` | `create`, `read_own`, `read_team`, `read_department`, `read_organization`, `share`, `schedule` |
  | `analytics_exports` | `basic`, `sensitive`, `approve` |
  | `analytics_warehouse` | `monitor`, `refresh`, `rebuild` |

- **Role grants:**

  | Role | Grants |
  |---|---|
  | Super admin | all |
  | Admin | all except `rebuild` |
  | New **Executive / Business Owner** role | all dashboards, reports and basic export |
  | Team leader | team-level sales, activities, support and projects; reports and schedules; basic export |
  | User | own sales and activities; private reports; basic export |
  | Checker | overview, definitions, organization reports, warehouse monitoring |
  | Finance manager | finance, sensitive export and approval |
  | Accountant | finance; basic export |
  | AI governance and safety roles | AI analytics |

- **Scope:** the viewer's source-module scope (Own / Assigned / Team / Department / Organization) is applied in SQL **before** aggregation, so totals never include records the viewer couldn't open. Budget facts have no owner, so anything below organization scope sees none.
- **System Owner:** administers templates and warehouse health. Tenant figures use their own membership grants, and without a membership they are refused (`TENANT_DATA_RESTRICTED`).
- **Navigation:** "Analytics & Reports" lists only the pages the member's grants open (`GET /api/v1/analytics/access`). Pages never request data before the grant check passes.
- **Cache:** scoped by organization, the caller's scope signature (level, membership, team, department), the access path, the query and a per-organization data version that the worker bumps in Redis after every load. Grants are checked before the cache.

## AI integration

`POST /api/v1/analytics/explain` (needs `ai_features.use`):
- runs the governed query first;
- asks the existing governed **`overview.narrative`** capability to reword the deterministic summary. That brings Phase 11 governance, kill switches, moderation and the numeric guardrail.

The response:
- references the metric ID, version, value, range, comparison and freshness;
- if the AI adds any number not in the facts, or refuses, the deterministic summary is shown instead (`usedDeterministicFallback`).

AI never computes, stores or authors a metric value.

## Docker

- **No new container.** The warehouse loops run in the existing worker:
  - every minute: the scheduler, loads, reconciliation, view refresh and export expiry;
  - every 30 seconds: schedule deliveries and export generation.

  Each loop skips a tick while its previous run is still going.
- **Environment:**

  | Variable | Default |
  |---|---|
  | `ANALYTICS_INTERVAL_MS` | 60 s |
  | `ANALYTICS_DELIVERY_INTERVAL_MS` | 30 s |
  | `ANALYTICS_INCREMENTAL_INTERVAL_MS` | 15 min |
  | `ANALYTICS_BATCH_SIZE` | 500 |
  | `ANALYTICS_LATE_ARRIVAL_MS` | 5 min |
  | `ANALYTICS_STALE_SOURCE_MS` | 2 h |
  | `ANALYTICS_EXPORT_EXPIRY_DAYS` | 7 |
  | `ANALYTICS_CACHE_TTL_MS` | 5 min |
  | `ANALYTICS_WAREHOUSE_ENABLED` | on (`false` turns loads off) |
  | `ANALYTICS_ALLOW_REBUILD` | off in production |
  | `VITE_BACKEND_ANALYTICS_MODE` (frontend) | — |

- **Commands** (run in the VS Code terminal, from `server/`):
  - `npm run analytics -- seed`: seeds or versions the metric registry and refreshes each organization's analytics calendar.
  - `npm run analytics -- backfill [--org <id>]`: loads every source and snapshot.
  - `npm run analytics -- run`: runs queued jobs.

## Migrations

- `20260927090000_phase12_analytics_warehouse`: applied to the development database.
- `node scripts/seedRoles.js`: adds the analytics grants and the Executive role (run on development).

## Frontend tests

`src/pages/Analytics/analytics.test.jsx` (12 tests) covers:
- navigation from grants;
- value formatting;
- the dashboard refusal, with **no** request made;
- definitions, comparisons, currencies and hidden-metric notices;
- the chart summary and table alternative;
- scoped drill-down;
- the AI explanation fallback;
- the builder offering only accessible metrics and common dimensions, and saving a governed definition (no SQL);
- no self-approval of exports, downloads, required purpose;
- schedule descriptions and the recipient requirement;
- warehouse retry and the hidden rebuild.

Full frontend suite: 1563/1563.

## Backend tests

`server/src/analytics/analytics.test.js` (27 tests) covers:
- **Calendar:** local business dates across midnight and DST, fiscal periods, presets and comparison ranges.
- **Currency:** historical rates, inverse rates, exact decimals, unavailable rates.
- **Schedules:** DST skip and repeat, next weekly, monthly, quarterly and daily runs.
- **Export files:** formula neutralization; CSV, XLSX (zip structure, CRC-32, no formulas), PDF and JSON; export tables with metric versions and watermark.
- **Query validation:** SQL and unknown fields, metrics, filters and grains rejected; range limits.
- **Access:** metric access, including the overview rule; scope SQL for Own, Team, Organization and no-grant; budgets with no owner.
- **Definitions:** integrity of every metric; dashboards; financial sensitivity; mappers carrying no sensitive fields.
- **Reports and comparisons:** report visibility; zero and missing comparison labels.

Full server suite: 540/540.

**Live HTTP check** (`localhost:4000`, dev database): 14/14.
- all seven dashboards;
- user totals equal their own records (37 of 42);
- finance refused for users;
- checker overview 8 shown, 2 hidden;
- query rejections;
- grouped series, comparison and currency;
- scoped drill-down;
- metric draft, publish and immutability;
- reports: visibility, versioning, share (viewer-scoped) and clone;
- exports: encrypted at rest, watermark, audit, `no-store`, download limit, revoke;
- sensitive approval and all four formats;
- schedule validation, a DST-correct next run, one run per occurrence, and a recipient without access skipped;
- warehouse status and the rebuild guard;
- AI explanation verified.

A full backfill of all 17 sources reconciled with no differences.

## Build, lint and type-check

- `npm run build` passes.
- `npx eslint .` shows the 43 pre-existing problems and none from Phase 12.
- The project has no TypeScript type-check.

## Remaining limitations

- **Documents service (Phase 7) is not built.** Export files are stored AES-256-GCM encrypted in the export row (`fileData`), not in document storage.
- **No department/team model.**
  - Department and team come from the User record and from source records that carry them (tickets, projects, some CRM records).
  - Department-scoped members see only facts whose source carries a matching department.
- **Metrics not yet implemented:**
  - *Sales:* average deal size, sales-cycle duration, stage conversion and aging, company concentration, quotes expired.
  - *Activities and support:* meetings/calls split, follow-up delay, agent workload, customer waiting time.
  - *Projects:* estimated versus actual hours, utilization, margin.
  - *Finance:* collection rate and period, budget variance as its own metric, cash flow.
  - *AI:* reconciled AI cost, citation failures.
- **Dimensions and facts not built:**
  - *Dimensions:* contact, pipeline, product, price book, region, report, data source.
  - *Facts:* integration sync and document activity (export activity is in the export tables).
- **Refresh modes:** hourly and monthly snapshot job types exist, but the scheduler runs 15-minute incremental loads and daily snapshots only. Rebuild takes no automatic backup; it is development-only by default.
- **Data-quality checks not implemented:** invalid dates, prohibited negatives, impossible sequences, unmapped statuses and unexpected nulls. Severity uses High / Warning / Low rather than five levels. A failed reconciliation marks metrics stale but does not block scheduled delivery; the freshness policy does.
- **UI limits:**
  - Dashboards and the builder have no dimension-filter controls, although the API supports filters.
  - Sharing takes a role key or membership ID; there is no member picker.
  - Chart types are key figures, table, line and bar; no stacked, area, donut, funnel or cohort.
  - In-app delivery is the Exports inbox; outbox notifications are recorded, but there is no notification centre.
- **Materialized views** are created and refreshed, but dashboards read the fact tables directly. That is fine at current volumes, but query plans and benchmarks at scale have not been measured.
- **Performance on the development tunnel** (about 430 ms per query) makes a full backfill take minutes; production latency is far lower.
- **Portal accounts** have no analytics.

## Deploy notes (for the combined deployment at the end)

1. Apply the migration: `npx prisma migrate deploy`.
2. Seed the roles: `node scripts/seedRoles.js` (adds the analytics grants and the Executive role).
3. Seed the analytics registry and calendars: `npm run analytics -- seed`.
4. Run the initial load: `npm run analytics -- backfill`.
5. Set `VITE_BACKEND_ANALYTICS_MODE=true` for the frontend build (already set in `.env.production`).
6. Restart the API and worker.

**Stop:** waiting for approval before Phase 13 (Platform Security Hardening, Backups, Disaster Recovery and Production Deployment).

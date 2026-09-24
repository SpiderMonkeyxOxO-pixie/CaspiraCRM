# Backend Phase 12 — Analytics Warehouse, Scheduled Reports, Executive BI and Governed Data Exports (condensed checklist)

Source: the user's pasted Phase 12 prompt (2026-09-24).

## Architecture and boundaries
**Design:**
- Keep the **existing PostgreSQL**: analytics tables, the `analytics` schema for materialized views, incremental jobs, and the existing workers, queue, storage and notifications.
- **No new warehouse engine or BI SaaS**, but use adapters so one could be added later.

**Transactional services stay authoritative** for current state, permissions, approvals, postings, contract/order/payment status, ownership and sensitive-field access. The analytics layer is authoritative only for snapshots, aggregates, trends, precomputed metrics and scheduled outputs.

**Every dashboard shows:** data source, date range, last successful refresh, latency, applied filters, metric definition, currency, time zone and limitations.

**Never:**
- **Queries:** accept raw SQL, table names or arbitrary expressions from the browser; expose credentials; write business operations through analytics.
- **Values:** calculate in React; hard-code values; mix currencies without conversion; reveal unauthorized records through totals or comparisons.
- **Exports and delivery:** export sensitive data without permission; email unrestricted attachments; send to unverified recipients; create permanent public links.
- **Claims:** build reports for disabled modules; claim real-time freshness; use AI numbers as authoritative; call reports audited financial statements; deploy externally.

## Warehouse
**Dimensions** (SCD2 where history matters):
- date, time, organization, department, team, user/owner;
- company, contact, lead source, pipeline, stage, product, price book;
- currency, country, region, project, support queue, contract type, payment method;
- AI provider, AI model, report, data source.

Each carries a warehouse key, source ID, organization, effective-from and effective-to, a current flag, source-updated and warehouse-updated timestamps, and a deleted flag.

**Facts:**
- **CRM and activity:** lead lifecycle and conversion, activities.
- **Sales:** deal snapshots, stage transitions and outcomes; pipeline snapshots; quotes (values, approvals); orders; contracts and renewals.
- **Support and projects:** tickets, SLA; project progress, tasks, time.
- **Finance:** invoices, payments, expenses, budgets.
- **AI:** usage, Copilot, action proposals, safety events.
- **Other:** integration sync, document activity, export activity.

Facts hold IDs and approved attributes only, no full sensitive payloads.

**Events versus snapshots:**
- **Events:** stage and status transitions, payments, approvals, activity completion, ticket, task and AI events.
- **Periodic snapshots:** pipeline and weighted pipeline, open deals, ticket backlog, project health, AR, renewal exposure, budget and AI budget consumption.

Missing history is never reconstructed from current values; it is flagged as incomplete.

## Metric registry
**Each metric defines:** id, name, definition, formula, sources, filters, grain, dimensions, currency behaviour, additivity, null behaviour, owner, reviewer, version, effective and deprecated dates, permissions, sensitivity, data-quality requirements and freshness target.

**Types:** additive, semi-additive, non-additive, snapshot, ratio, count distinct, monetary, duration, percentage. Averages, percentages, balances and distinct counts are never summed.

**Distinct names** for: booked order value, invoiced revenue, (recognized revenue), collected cash, outstanding AR, contract value, pipeline, weighted pipeline, forecast, expenses, budget, profit estimate, cash balance.

**Metrics by module:**
- **Sales:** leads (total, new, qualified, converted, conversion rate, no contact info, qualified without deal); deals (open, won, lost); pipeline and weighted pipeline; average deal size, win rate, cycle duration; by-stage figures (conversion, aging), inactivity, passed close date, no next action, no owner, no products, concentration by company; quotes (value, acceptance, expired); order value; contract value; contracts expiring; renewal notice deadlines.
- **Activities:** created, completed, due, overdue, completion rate; meetings and calls completed; follow-ups created and completed; activities by owner and by company; companies without recent communication; users without a next action; average follow-up delay.
- **Support** (only if the data exists; no invented CSAT): new, open, resolved, backlog; first-response and resolution time; SLA compliance and breaches; reopened; age; by priority, queue and company; customer waiting time; agent workload.
- **Projects:** active, completed, status, health, milestones; tasks (created, completed, overdue, blocked), completion; estimated versus actual hours; billable and non-billable time; utilization; budget consumption; margin (authorized roles only).
- **Finance:** invoice value, paid, AR, overdue AR, collection rate, average collection period; expenses (approved, rejected, pending); budget, actual, variance; cash in, out and net; cash balance and profit estimate if supported. Each shows currency, conversion method, rate date, accounting basis, included states and limitations. Never presented as audited statements.
- **AI:** requests, successes, failures, model usage; tokens (input, output, cached); estimated and reconciled cost; budget; latency; citation failures; proposals (approved, rejected); safety events; feedback. Costs and conversations are hidden from unauthorized roles.

## Currency, time and fiscal
**Currency:**
- Keep original currency and amount, base currency, converted amount, rate source, date, version and conversion time.
- Never mix currencies: convert, or show a total per currency.
- Use the historical rate, not today's rate.
- Where no rate exists: "Currency conversion unavailable for part of this result."

**Time:**
- Organization time zone and user display time zone.
- Fiscal year start, quarters, week start, DST and month end.
- Timestamps stored in UTC; business date assigned in the organization's time zone.

## Pipeline, jobs and reconciliation
**Job mechanics:** watermark, incremental extraction, idempotent upserts, late and deleted records, backfill, retry, dead letter, reconciliation, locking, checkpoints, correlation. Retries never create duplicate facts.

**Refresh modes:** near-current incremental, hourly, daily snapshot, monthly snapshot, manual authorized refresh, backfill, full rebuild (development only; elevated permission, confirmation, backup).

**Job states:** Queued, Extracting, Transforming, Loading, Validating, Reconciling, Completed, Completed with warnings, Failed, Cancelled, Stale, Dead letter.

**Job record:** job, organization, source, type, watermark, start and end, rows read/inserted/updated/deleted/rejected, reconciliation, failure category, safe error, correlation.

**Reconciliation checks:** counts, exact decimal monetary totals, status counts, organization and date boundaries, currency totals, deletes, duplicates, missing dimensions, orphans.

**When reconciliation fails:** mark metrics stale or unreliable, block distribution where policy requires, notify, and open a data-quality incident. Never publish silently.

**Data-quality checks:** missing source records or dimensions, duplicates, orphans, invalid dates, currencies or rates, prohibited negatives, impossible sequences, stale sources, failed refreshes, reconciliation differences, unmapped statuses, unexpected nulls. Severity runs Critical, High, Medium, Low, Informational. Counts never reveal hidden records.

## Semantic layer, reports and dashboards
**The browser may send:** metric IDs, dimension IDs, filters, date range, grouping, sorting, pagination, comparison, display currency, grain.

**Never:** SQL, table names, credentials, expressions or joins.

**The server validates:** metric, dimension and filter permissions; organization and record scope; sensitive fields; range, result and export limits.

**A report stores:** id, name, description, owner, organization, visibility, metrics, dimensions, filters, range, comparison, currency, time zone, sort, visualization, refresh, schedule, delivery, export policy, version and dates. It references registered metrics and dimensions only, never SQL.

**Routes:** `/analytics/{overview,sales,activities,support,projects,finance,ai}`, `/reports`, `/reports/builder`, `/reports/schedules`, `/reports/exports`. Dashboards whose module is incomplete are hidden.

**Executive BI:** a business summary; pipeline; orders and collections; renewals; support; delivery; expenses and budget; AI governance; data-quality limits; freshness. Supports current and previous period, year over year (where history exists), and filters for organization, department, team, company, owner, currency and range. No fabricated overall score.

**Metric cards:** name, value, comparison, absolute change, percentage (only when valid), trend, freshness, definition, filters, drill-down. A zero comparison reads "New from zero", "No prior-period value" or "Comparison unavailable".

**Drill-down:** reauthorizes, keeps filters, lists the included records, shows excluded categories without revealing unauthorized records, links only to built authorized routes, masks sensitive fields, paginates and shows the calculation.

**Report builder:**
- **Inputs:** name, description, module, metrics, dimensions, filters, range, comparison, currency, grain.
- **Actions:** table and chart preview, save, save as, schedule, export.
- **Charts:** KPI, table, line, bar, stacked bar, area, donut, funnel, pipeline, cohort (when supported). Chart types that would misrepresent the metric are not offered.
- **Visibility:** private, selected users, team, department, organization, executive, system template. Sharing never grants data access; each viewer's authorization applies at run time.

## Schedules, delivery and exports
**Schedules:**
- **Frequencies:** one-time, daily, weekly, monthly, quarterly; custom cron for administrators only.
- **Fields:** report, owner, organization, time zone, frequency, next run, recipients, method, format, expiry, failure policy, active.
- **Recipients:** app users, role groups, verified external addresses (only if policy permits).
- **Before every delivery**, recheck owner, recipients, report permission, export policy, freshness, sensitivity and organization policy.
- **Delivery:** in-app, secure link, or an email containing a secure link. Direct attachments only for low-risk reports where policy allows. Sensitive reports use authenticated, short-lived, recipient-bound, download-limited links, encryption at rest and audit, and never put values in the email body.
- **Handles:** time zones and DST, missed runs, retry, duplicates (one idempotency key per occurrence), paused and expired schedules, recipient removal, owner deactivation, stale or partial data, delivery failures.

**Exports:**
- **Formats:** asynchronous CSV, XLSX, PDF, and JSON (technical roles only).
- **Request:** report or dataset, filters, range, columns, currency, time zone, format, purpose, requester, organization, expiry.
- **States:** Requested, Validating, Queued, Generating, Scanning, Ready, Downloaded, Expired, Cancelled, Failed, Revoked.
- **Limits:** rows, columns, range, sensitive fields, organization, masking, rate, concurrency, size, retention, expiry and audit. Large exports need elevated permission or approval, and a job can never broaden the filters it was authorized with.
- **Files:** stored through the secure Document service, with organization, classification, date, range, filters, currency, time zone, report and metric versions, expiry and watermark. Nothing is permanent without a retention policy.
- **Audit:** requester, organization, report, filters, columns, rows, size, classification, approver, generated date, downloads, expiry, revocation and failure. Exported values are never logged.

## Cache, AI, RBAC
**Cache:**
- Only authorized aggregates, registered results, metadata and configuration.
- **Keys:** organization, permission scope, metric version, filters, range, currency, time zone, watermark.
- **Invalidated on:** source changes, authorization changes, metric versions, rates, refresh, report changes.

**AI:**
- **May:** explain registered metrics, summarize authorized results, compare approved periods, point out computed trends, link reports, state limits.
- **May not:** create formulas, invent totals, modify the warehouse, run arbitrary queries, reach unregistered metrics, reveal restricted values, or treat a forecast as revenue.
- **Every explanation references** metric id, version, value, range, filters, freshness and evidence.

**Permissions:**
- `analytics.{overview,sales,activities,support,projects,finance,ai}.read`;
- `analytics.metric.{read,manage}`;
- `analytics.report.{create,read.own,read.team,read.department,read.organization,share,schedule}`;
- `analytics.export.{basic,sensitive,approve}`;
- `analytics.warehouse.{monitor,refresh,rebuild}`.

**Roles:**

| Role | Analytics access |
|---|---|
| System Owner | templates and warehouse health, no tenant data |
| Organization Administrator | organization reports, schedules, export policy |
| Executive | executive and organization analytics |
| Department Manager | department analytics |
| Sales Manager | team sales analytics |
| Sales Representative | own and permitted records only |
| Finance | per the existing Finance permissions |
| Auditor | read-only definitions, calculations, refresh history and export audit |
| Portal | only explicitly enabled analytics for their own account |

**Sensitive data** (personal data, cost, margin, discounts, finance, payments, HR, audit, AI conversations, provider costs, integration metadata) is excluded **before** aggregation, never masked afterwards. When it would contribute, show "Additional restricted information is available to authorized roles."

## Models and API
**Models:**
- **Registry:** `analytics_dimensions` and `_versions`; `analytics_metrics` and `_versions`.
- **Facts:** `analytics_fact_{leads,activities,deal_events,deal_snapshots,quotes,orders,contracts,support,projects,time,invoices,payments,expenses,ai_usage}`.
- **Reference and jobs:** `analytics_exchange_rates`, `analytics_fiscal_calendars`, `analytics_warehouse_jobs`, `analytics_job_checkpoints`, `analytics_reconciliation_runs`, `analytics_data_quality_issues`.
- **Reports:** `analytics_reports`, `analytics_report_versions`, `analytics_report_shares`, `analytics_report_schedules`, `analytics_schedule_runs`.
- **Exports:** `analytics_export_jobs`, `analytics_export_downloads`.

Every tenant row carries the organization; money is Decimal.

**API:**
- **Analytics:** `/api/v1/analytics/{overview,sales,activities,support,projects,finance,ai}`, `POST query`, `GET drilldown`.
- **Metrics:** CRUD, versions, publish, retire.
- **Reports:** `/reports` CRUD, clone, run, share (plus delete share).
- **Schedules:** CRUD, pause, resume, run-now.
- **Exports:** CRUD, cancel, approve, revoke, download.
- **Warehouse:** status, jobs, refresh, backfill, reconcile, data-quality.

## Docker, performance, accessibility, tests
**Docker:** the existing services only, no warehouse container. Health checks for the API, database, queue, warehouse worker, scheduler, export worker and storage. Commands are documented.

**Performance:** indexes on fact foreign keys and on organization and date; timeouts, limits and pagination; materialized aggregates; incremental refresh; background exports; no N+1 queries; query-plan or benchmark checks for major dashboards.

**Accessibility:** heading hierarchy, keyboard use, a text summary for every chart, a table alternative, focus, labels, reduced motion, contrast.

**Responsive:** 360–1920 px, filter drawer, wrapping cards, contained tables, no horizontal overflow.

**Tests:** the long list in the prompt (every dashboard, facts, incremental jobs, reconciliation, currency, time zones, metric math, query validation, scopes, drill-down, reports, sharing, schedules, delivery rechecks, exports, cache, AI, accessibility, Docker, regressions).

**Report headings:** architecture, schema, dimensions, facts, incremental refresh, snapshots, reconciliation, data quality, metric registry, sales, support, project, finance and AI metrics, currency, time zones and fiscal calendars, executive BI, department dashboards, report builder, schedules, recipient authorization, exports, RBAC and sensitive data, AI integration, Docker, migrations, frontend tests, backend tests, build/lint/type-check, limitations.

Stop for approval before **Phase 13 — Platform Security Hardening, Backups, Disaster Recovery and Production Deployment**.

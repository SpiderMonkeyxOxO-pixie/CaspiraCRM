# Backend Phase 3 — Sales Pipeline, Deals, Catalog, Quotes, Orders and Contracts

This document covers what Backend Phase 3 added on top of Phase 1 (Docker,
auth, organizations, RBAC) and Phase 2 (CRM core: Leads/Contacts/Companies/
Activities). It extends the pre-existing Deal/CatalogItem/PriceBook/Quote/
Order/Contract Prisma models and replaces their non-org-scoped legacy
routes; it does **not** touch payment processing, accounting, inventory,
shipping, electronic signatures, Support/Projects/Finance/Integration
Center, or any AI provider.

## Architecture

```
server/src/routes/sales/{pipelineRoutes,dealRoutes,catalogRoutes,priceBookRoutes,quoteRoutes,orderRoutes,contractRoutes,reportRoutes}.js
server/src/controllers/sales/{pipelinesController,dealsController,catalogController,priceBooksController,quotesController,ordersController,contractsController,reportsController}.js
server/src/services/sales/{
  moneyService, documentNumberService, pipelineSeedService, dealTransitionService, dealRiskService,
  priceBookResolutionService, quoteApprovalService, quoteToOrderService, orderToContractService,
  contractLifecycleService, calculationService
}.js
server/src/jobs/sales/salesDeadlineJobs.js (registered into server/src/worker.js)
```

Controllers stay thin; `requireCrmOrgPermission` (Phase 2's generic org-permission middleware, reused as-is) authorizes every route; business rules live in `services/sales/*`; every mutation records an audit event via the existing `auditService.js`; all money math goes through `moneyService.js` so every document type computes totals identically.

## Routes

All mounted under `/api/v1/sales/*`, session-cookie authenticated, RBAC-gated per module+action, `organizationId` resolved from query/body and validated against a real membership (never trusted blindly).

| Resource | Notes |
|---|---|
| `/sales/pipelines` | CRUD + stage CRUD + `/stages/reorder` (transactional) |
| `/sales/deals` | CRUD, `/assign`, `/transition` (the one endpoint Kanban and the detail form both use), `/mark-won`, `/mark-lost`, `/reopen`, `/archive`, `/restore`, `/stage-history`, `/risk-flags`, `/line-items` CRUD, `/bulk` |
| `/sales/catalog` | CRUD + `/archive`, `/restore` |
| `/sales/price-books` | CRUD + `/entries` CRUD |
| `/sales/quotes` | CRUD, `/submit`, `/approve`, `/reject`, `/issue`, `/accept`, `/reject-by-customer`, `/cancel`, `/new-version`, `/order-preview`, `/convert-to-order`, `/archive`, `/restore`, `/bulk` |
| `/sales/orders` | CRUD, `/submit`, `/confirm`, `/cancel`, `/mark-in-progress`, `/mark-fulfilled`, `/contract-preview`, `/convert-to-contract`, `/archive`, `/restore` |
| `/sales/contracts` | CRUD, `/submit`, `/approve`, `/record-signature`, `/activate`, `/start-renewal-review`, `/renewal-reviews/:id/decide`, `/expire`, `/terminate`, `/cancel`, `/archive`, `/restore`, `/obligations` CRUD + `/complete` + `/waive` |
| `/sales/reports` | `/pipeline-summary`, `/forecast` |

Static paths (`/summary`, `/bulk`, sub-resource collections) are declared before their `/:id` route in every router — Express matches in declaration order.

## Database models and migrations

Extended in place (Backend Phase 2's own pattern): `Deal`, `DealLineItem`, `CatalogItem`, `PriceBook`, `PriceBookEntry`, `Quote`, `QuoteLineItem`, `Order`, `OrderLineItem`, `Contract`, `ContractLineItem` all gained `organizationId`, `ownerMembershipId`, `createdBy`/`updatedByMembershipId`, `version`, and archive fields. New tables with no prior equivalent: `Pipeline`, `PipelineStage`, `DealStageHistory` (append-only), `SalesApproval`, `ContractObligation`, `ContractRenewalReview`, `SalesDocumentCounter`.

Migrations (chronological): `phase3_sales_core` (the main additive migration), `sales_default_partial_indexes` (at most one active default Pipeline per organization), `deal_value_decimal` (a follow-up fixing a field the main migration missed — see "Money and calculation behavior" below).

## Stable IDs and document numbering

Every record keeps its existing `cuid()` `id` (exposed as `_id`). New sequential document numbers — `DEAL-2026-000001`, `QUOTE-2026-000001`, `ORDER-2026-000001`, `CONTRACT-2026-000001` — come from `documentNumberService.js`: one `SalesDocumentCounter` row per `(organizationId, docType)`, incremented via a single `UPDATE ... RETURNING` inside the creating transaction. Concurrency-safe, never reused, never based on a row count.

## Pipeline and Stage behavior

`Pipeline`/`PipelineStage` are genuinely new models (none existed before). `pipelineSeedService.js`'s `ensureDefaultPipelines()` lazily seeds 3 pipelines per organization on first touch, matching the frontend's `PIPELINE_CONFIGS` exactly: **New Business** (default), **Renewals**, **Partnerships** (with a `wipLimits` JSON column), each with the same 6 ordered open/won stages (Discovery/Qualified/Proposal/Negotiation/Approval/Won at probabilities 10/25/50/70/90/100) plus 3 terminal outcome stages (Lost/Cancelled/On Hold, all probability 0). Stage `classification` (`Open|Won|Lost|Cancelled|OnHold`) drives every lifecycle rule — never a hardcoded stage name. A partial unique index enforces at most one active default Pipeline per organization. Stage reordering is transactional; a Stage with active Deals cannot be archived.

## Deal persistence and lifecycle

A real naming bug in the legacy backend was corrected: it wrote `stage: "Closed Won"`/`"Closed Lost"`, but the frontend's actual vocabulary is `"Won"`/`"Lost"` (with `"Cancelled"`/`"On Hold"` as further outcomes). Transitions now resolve the target Stage by classification, never a hardcoded string. `dealTransitionService.js` is the single source of truth both Kanban drag-and-drop and the detail form call through `/transition`: entry into a Won-classified Stage requires an actual close date; Lost/Cancelled/On-Hold require a reason; a closed Deal cannot move back to Open except via the dedicated `/reopen` (its own permission + reason); Stage-declared required fields are enforced server-side. Ordinary `PATCH /deals/:id` rejects any attempt to change `stage`/`status`/`pipelineId`/`pipelineStageId` directly.

## Deal Stage History

Append-only (`DealStageHistory`) — snapshots the from/to Stage name and probability at the moment of each transition, so a later Stage rename or probability change never rewrites historical meaning.

## Product and Service catalog

SKU uniqueness is enforced per organization (composite unique constraint), not globally. Product cost (`costPreview`) is masked from callers without the `products_services` module's `view_financial_fields` grant, returning an explicit `costFieldsRedacted: true` flag.

## Price Books

Effective/expiration date ordering is validated server-side. An archived catalog item cannot be added to a new Price Book entry. `priceBookResolutionService.js` ports the frontend's exact specificity-ranking rule (company > contract-type > customer-segment > market > channel > standard, tie-broken by `priority`) and reports an **unresolved conflict** rather than silently picking a winner when both tie. Cross-currency Price Book entries are only allowed for Fixed Price/Quantity Tier/Custom Quote adjustments — percentage/fixed adjustments require the same currency as the catalog item, since this system never assumes a live exchange rate.

## Money and calculation behavior

Every first-class relational money column (`Deal.value`, every line-item unit price/discount/tax/total, `CatalogItem.standardPrice`/`costPreview`, `PriceBookEntry` pricing, and new document-level `subtotal`/`discountTotal`/`taxTotal`/`grandTotal` columns on Quote/Order/Contract) is Postgres `numeric(14,2)`/Prisma `Decimal` — never a binary float. `moneyService.js` is the **only** place that does Sales-domain money arithmetic: round-half-up to the currency's minor unit, and the documented calculation order (quantity × unit price → line discount → line subtotal → tax → line total → document subtotal/discount/tax → grand total). Client-submitted totals are never trusted — verified live: a quote created with `subtotal: 1, grandTotal: 1` in the request body was created with the server's actual computed values (`1000`/`1080`), not the submitted ones. JSON-embedded pricing structures (`tieredPricing`, `alternativePrices`, `usageConfig`) remain JS numbers inside JSON columns — a documented, deliberate limitation, not a gap in the relational totals. Every summary/forecast calculation groups by currency (`moneyService.sumByCurrency`) and never combines values across currencies.

**A real mistake was found and corrected during Step 1**: `Deal.value` was initially left as `Float` when every other Sales money field was converted to `Decimal` — caught by a direct Prisma sanity check, fixed with a follow-up migration (`deal_value_decimal`) before any Deal logic was built on top of it.

## Quote persistence and versioning

Adopts the frontend's full real status vocabulary — Draft, Internal Review, Approval Pending, Approved, Preview Sent, Preview Viewed, Preview Accepted, Preview Rejected, Expired (derived from `validUntilDate`, never stored), Cancelled, Superseded — rather than the legacy backend's narrower lifecycle or the spec's own illustrative shorter list. A Quote can only be freely edited while in Draft; `/new-version` is the only way to change commercial terms afterward, and it snapshots a new row, marks the previous version `Superseded`, and invalidates any pending `SalesApproval`.

## Quote approval

`quoteApprovalService.js` requires approval when a line discount exceeds the frontend's own 20% warning threshold, a price was manually overridden, or the grand total exceeds a configured high-value threshold. Approval decisions go through the new `SalesApproval` model (append-only, rejection requires a reason). The requester can never approve or reject their own request — verified live (a self-approval attempt returned `403 SALES_SELF_APPROVAL_FORBIDDEN`; a different organization membership successfully approved the same quote). `/submit` and `/approve` are idempotency-key protected.

## Quote-to-Order conversion

`quoteToOrderService.js`: a read-only preview and a transactional, idempotency-key-protected conversion, eligible only from an Approved or customer-Accepted Quote. Re-checks for an existing non-cancelled Order for the same Quote **inside** the creating transaction, so two concurrent conversion requests can't create two Orders — verified live (a second conversion attempt on the same Quote returned `409 SALES_DUPLICATE_CONFLICT`). Line items are copied as frozen commercial snapshots, never linked to live catalog/Price Book prices afterward.

## Order persistence and lifecycle

Adopts the frontend's `ORDER_STATUSES`: Draft → Pending Confirmation → Confirmed → Processing → Fulfilled, plus Cancelled. `/confirm` requires a valid Company, a valid Contact, at least one line item, and a valid currency — verified live (confirmation was rejected without a Company, then succeeded once Company and Contact were set). Order line items become immutable once the Order leaves Draft/Pending Confirmation.

## Order-to-Contract conversion

`orderToContractService.js`: identical discipline to Quote-to-Order — read-only preview, transactional, idempotency-key-protected, re-checks for a duplicate Contract inside the transaction, eligible only from a Confirmed/Processing/Fulfilled Order, copies line items as frozen snapshots, creates the Contract in Draft.

## Contract lifecycle

Preserves the frontend's real vocabulary — `"Signed"` stays the operative in-force status (its own code comment says this must never be renamed, since other frontend logic keys off the exact string), reached once both signatories are recorded via `/record-signature` (existing, already-working frontend behavior, not something this phase invented). A genuinely new, explicit `/activate` action is distinct from signature capture: it requires the Contract to be fully Signed, rejects if already activated, is idempotency-key protected, and is never called automatically anywhere in this codebase — verified live (rejected while still Draft, succeeded once fully Signed, rejected on a second attempt).

## Contract obligations and renewals

Obligations support create/list/complete/waive (waiving requires a reason — verified live). Renewal reviews (`ContractRenewalReview`) are started explicitly (`/start-renewal-review`, only from a Signed Contract) and decided explicitly (`Renew`/`Do Not Renew`/`Renegotiate`) — a "Renew" decision only records the human decision; it never itself renews the Contract or creates a replacement.

## Deterministic Sales summaries

`calculationService.js`: open/weighted pipeline value, per-stage totals, won/lost value, win rate, average deal size, deal counts by owner, pipeline concentration by company, and date-bucketed (never AI-predicted) forecast buckets — mirroring the frontend's `dashboardSelectors.js` formulas exactly. Every function groups money by currency and never combines values across currencies. `GET /sales/reports/pipeline-summary` and `/forecast` apply the caller's record scope before any calculation runs — verified live against a real scoped Deal.

## RBAC and record scope

Reuses Phase 2's `requireCrmOrgPermission(moduleId, action)` and `resolveCrmScopeWhere()` unchanged — no new RBAC or scope model. New `sales.*` permission grants (pipeline/deals/products_services/price_books/quotes/orders/contracts/sales_reports modules, plus new action verbs: `transition`, `close`, `reopen`, `submit`, `issue`, `accept`, `cancel`, `override_pricing`, `activate`, `renew`, `terminate`, `manage_obligations`, `reorder`, `view_forecast`, `confirm`, `fulfill`) were added to all 5 existing built-in roles. This codebase has 5 roles total (System Owner, Organization Administrator, Department Manager, Auditor, Standard Employee) — there is no separate Executive/Sales-Manager/Customer-Portal role distinct from these; Department Manager was used as the closest analog to "Sales Manager," and no Customer Portal API surface was built or exposed (the spec's own instruction: only if one already exists).

## Sensitive financial-field protection

`CatalogItem.costPreview` is masked (`costFieldsRedacted: true`) without `products_services`'s `view_financial_fields` grant; `Deal.value` is masked (`financialFieldsRedacted: true`) without `deals`'s `view_financial_fields` grant — verified live against the `checker` (Auditor) role.

## Fixture import

`server/prisma/seedSalesFixtures.js` — idempotent, find-or-create by SKU/code/name, never run automatically. A direct Node import of the frontend's curated fixture arrays (`mockCatalogData.js`'s `CURATED_ITEMS`, etc.) was attempted first and rejected: those files use Vite-only extensionless relative imports (`./mockUsersData`, no `.js` extension), which fail under plain Node's ESM loader (`ERR_MODULE_NOT_FOUND`) outside a bundler. The script falls back to a small hand-curated dataset mirroring the frontend's field shapes (matching Phase 2's `seedCrmFixtures.js` precedent), and recalculates+compares its own expected totals against the server's actual `computeDocumentTotals()` result, reporting a mismatch rather than trusting either blindly. Verified idempotent by running it twice against the same organization.

## Frontend API adapters

`src/Helpers/backendSalesClient.js` — same pattern as `backendCrmClient.js` (httpOnly cookies, double-submit CSRF, one-shot refresh-on-401, idempotency-key parameters on every conversion/approval/confirmation call), gated by a new `VITE_BACKEND_SALES_MODE` flag. **Not wired into any live Sales page or Redux slice this phase** — `src/redux/sales/*Slice.js` and `src/redux/crm/dealsSlice.js` remain the active data source.

## AI preview compatibility

No AI provider was touched. This phase adds no AI code; the existing Frontend Analysis Preview continues to read whatever authenticated/authorized data is available to it and was not modified.

## Audit behavior

Every Pipeline/Stage/Deal/Catalog/PriceBook/Quote/Order/Contract/Obligation/Renewal mutation records an audit event via the existing `auditService.js` — no second audit table, no separate convention.

## Docker Desktop verification

All 5 services (`db`, `redis`, `mailpit`, `api`, `worker`) remained healthy throughout this phase's migrations and restarts. The Sales deadline sweep (quote/contract expiration, renewal-notice deadlines, overdue obligations) was manually triggered against live data and ran cleanly with no errors, and is now wired into the worker on a 15-minute interval.

## Tests executed

`cd server && npm test` — **189 tests passing** across 26 files, including new suites for `moneyService`, `documentNumberService`, `dealTransitionService`, `dealRiskService` (exercised via controllers), `pipelineSeedService`, `priceBookResolutionService`, `quoteApprovalService`, `calculationService`, `contractLifecycleService`, and `salesDeadlineJobs`.

## Lint and build results

No frontend route, component, or Redux slice was touched by this phase.

## Deferred functionality

Explicitly **not** part of this phase, per its own scope boundary: real payment processing, accounting ledger entries, accounts receivable/payable, tax filing, live foreign-exchange rates, inventory management, warehouse operations, shipping/fulfillment providers, electronic signatures, real quote/contract email delivery, Support tickets, Project management, third-party integrations, OAuth, any LLM/AI provider integration, automatic Quote approval, automatic Deal closure, automatic Order confirmation, and automatic Contract activation or termination. The CRM/Sales backend as a whole is **not** complete end-to-end — this phase covers Pipelines, Deals, Catalog, Price Books, Quotes, Orders, and Contracts persistence only.

# Backend Phase 4 — Support, Conversations, Tickets, Knowledge Base and SLA Management

This document reports Backend Phase 4 as completed against the owner's
Back-end (IV) prompt; the checklist is in `docs/specs/BACKEND_PHASE4_SPEC.md`.

It was built in five steps:

| Commit | What |
|---|---|
| `ce9f61b` | Data model; inboxes, queues, categories, canned responses |
| `87504e0` | Ticket lifecycle, conversation, assignment |
| `0383da2` | SLA engine, business hours, entitlements, worker jobs |
| `34767bd` | Customer Portal, satisfaction, Knowledge Base |
| (this commit) | Reports, fixture import, frontend adapters, docs |

**Not connected, by design:**

- external channels, providers or email delivery;
- AI (Claude, OpenAI, sentiment or summaries);
- files and attachments;
- payments.

Placeholder channels are flagged `connected: false`. Replies are never
marked "Sent" because no provider exists.

## Routes (all under `/api/v1`)

| Area | Routes |
|---|---|
| Inboxes | `support/inboxes` — list, create, get, update, `archive` |
| Queues | `support/queues` — list, create, get, update, `archive`, plus `members` (list, add, remove) |
| Categories | `support/categories` — list, create, update, `archive` (two levels) |
| Canned responses | `support/canned-responses` — list, create, update, `archive` |
| Tickets | `support/tickets` — list (filters, search, sort, paging), create, `bulk`; `:id` get and update |
| Ticket lifecycle | `:id/transition`, `resolve`, `close`, `reopen`, `escalate` |
| Ticket work | `:id/assign`, `followers` (add, remove), `archive`, `restore` |
| Ticket history and messages | `:id/events`, `messages`, `replies`, `internal-notes` |
| Related and merge | `:id/related`, `merge-preview`, `merge` |
| Messages | `support/messages/:id` (edit), `support/messages/:id/archive` |
| SLA | `support/business-hours` (list, create, update); `support/sla-policies` (list, create, get, update, `new-version`, `archive`) |
| Entitlements | `support/entitlements` (list, create, get, update); `support/tickets/:id/entitlement` (override, reason required) |
| Knowledge Base | `support/kb/categories` (list, create, update); `support/kb/articles` (list, create, get, update, `submit`, `approve`, `reject`, `publish`, `archive`, `versions` get and post) |
| Portal accounts | `support/portal-accounts` — list, link, update, `suspend`, `reactivate` |
| Reports | `support/satisfaction`, `support/reports/summary` |
| **Customer Portal** | `portal/support/tickets` (list, create, get, `replies`, `satisfaction`); `portal/knowledge-base/categories`, `portal/knowledge-base/articles`, `portal/knowledge-base/articles/:slug` |

The `advance` and `notes` routes from before the full spec remain as
aliases of `transition` and `internal-notes`.

**Idempotency keys** (header `Idempotency-Key`) are required on:

- ticket create, public reply, resolve, close, reopen and merge;
- KB publish;
- portal ticket create, reply and satisfaction.

A key is reserved before the request runs, so two simultaneous identical
requests can't both succeed. Keys are tied to the user who sent them.

## Tickets

- **Numbers:** `TICKET-2026-000001`, per organization. They're generated safely under concurrency, never reused, kept after archiving, and searchable. The stable public ID is the record's id.
- **Statuses:** New, Open, In Progress, Waiting for Customer, Waiting for Internal Team, Resolved, Closed, Cancelled. The frontend's statuses are kept; Waiting for Internal Team and Cancelled were added.
  - `/transition` makes the working moves; Cancelled needs a reason.
  - Resolving needs a resolution code or summary.
  - Closing needs its own permission and a Resolved ticket.
  - Reopening needs a reason.
  - Tickets are never resolved automatically.
- **Priorities:** Low, Medium, High, Urgent (the frontend's set), with meanings documented in `ticketLifecycleService.js`.
- **Fields added:** inbox, queue, category and subcategory (archived categories can't be chosen), owner, team, related lead, deal, order and contract (all checked to be in the same organization), entitlement, SLA policy version, cancellation and waiting reasons, resolution code, reopened, archived and merged.
- **Assignment:** manual, unassign, queue moves, or deterministic **round robin**:
  - active queue members only, ordered by when they joined, starting after the last pick;
  - members at their capacity are skipped;
  - the cursor is advanced with a version-checked update, so two simultaneous picks can't both take the same slot;
  - the reason is recorded, and it is never described as AI.
- **Followers:** same organization, no duplicates. A member can only be added if they can already see the ticket, so following never widens access.
- **Events:** an append-only `TicketEvent` log. Each event stores snapshots of the values at the time, so later renames never rewrite history.
- **Related and merge:**
  - Related tickets come from deterministic signals: same requester, company, similar subject, category, created within 7 days, same contract or order.
  - Merging needs a preview, the merge permission, a reason and an idempotency key.
  - The destination is kept. The source is archived as "Merged into …" with its history intact.
- **Bulk actions:** assign, transition or archive, up to 100 tickets. Each ticket is re-checked against the caller's scope and permission.

## Conversation and note protection

Each message has:

- a **type**: Customer Message, Agent Reply, Internal Note, System Event or Status Event;
- a **visibility**: Customer Visible, Internal Only or Restricted Management;
- a **delivery status**:
  - *Delivered to Portal* when the requester has portal access;
  - *Pending Provider* otherwise;
  - never "Sent".

Bodies are plain text, sanitized: markup and script blocks are removed.

Internal and restricted notes are filtered **in the database query**,
based on the `view_internal_notes` and `view_restricted_notes` grants.
Writing a restricted note needs the restricted permission. The Customer
Portal query only ever selects Customer Visible messages. Staff can edit or
archive their own messages (version-checked); customer messages can't be
edited by staff.

## SLA

- **Business-hours calendars:**
  - IANA time zones, calculated with `Intl` (never the browser's time zone);
  - several working intervals per day, with overlaps rejected;
  - holidays;
  - DST handled (a 23-hour day really counts 23 hours).
- **Policies are versioned:**
  - per-priority targets in **minutes**: first response, optional next response, resolution;
  - 24/7 or business hours; pause statuses; a warning percentage.
  - Rules change only through `new-version`. Each version keeps a frozen copy of its calendar, and running tickets keep the version they started on.
- **Which policy applies** (deterministic):
  1. the company's valid entitlement;
  2. otherwise the queue's default policy;
  3. otherwise the built-in windows, counted 24/7.
- **Entitlements:** an entitlement tied to a contract applies only while the contract is Signed and not expired.
- **Clocks** (`SlaClock`):
  - **First Response** is met only by a public agent reply, timed by the server's clock.
  - **Next Response** starts when the customer writes again.
  - **Resolution** pauses while Waiting for Customer (Waiting for Internal Team keeps it running); on resume, the paused time is added.
  - A **priority change** reschedules only clocks that haven't breached.
  - **Reopening** starts a new Resolution clock. Closing, cancelling, archiving or merging cancels any clocks still running.
- **Worker sweep** (every minute, `SUPPORT_SLA_SWEEP_INTERVAL_MS`):
  - breaches are recorded **at their due time**, so worker downtime never loses or shifts one;
  - one-time warnings;
  - clocks left paused by mistake are resumed.
  - It's idempotent (conditional updates and unique event keys) and only records events, audit entries and internal notifications. It never resolves tickets, changes priority or messages customers.

## Customer Portal

- **Accounts:** staff link a portal login to one Contact and that contact's Company. The customer never chooses these.
  - The login starts unusable. The customer sets a password from an invitation email (Mailpit in development).
  - An organization's own members can't be linked.
  - Company-wide ticket access is an explicit admin setting.
  - Suspension blocks the very next request.
- **Separation:** `/api/v1/portal` has its own access check and its own serializers. Portal responses never contain internal notes, staff names or ids, queue, priority, SLA settings, related leads, deals, orders or contracts, or audit data. The staff API refuses portal logins, since they have no organization membership.
- **What customers can do:**
  - list and read their own tickets;
  - raise tickets for their own account;
  - reply — this reopens a Resolved ticket, while a Closed one needs a new ticket;
  - rate a resolved ticket **once, as its requester** (1–5, optional comment).
- **Staff can't rate for the customer.** The old staff "close with a score" behaviour was removed.

## Knowledge Base

- **Article lifecycle:** Draft → In Review → Approved → Published (the previous published version becomes Superseded), or In Review → Rejected with a reason.
- **Published versions never change.** Any edit after review starts a new Draft version, and the portal keeps showing the published text until the new version is published.
- **Separation of duties:** the author can't approve or publish their own article.
- **Portal visibility:** only published articles marked **Customers**, in customer-visible categories, reach the portal. Internal articles never do.
- **Numbering and views:** articles are numbered `KB-2026-000001`, and portal views are counted.

## Canned responses

Canned responses are sanitized text, visible to the Team or only to the
author (Personal). They can be scoped to a queue or category. **They never
send anything**; the frontend uses them to fill a reply draft.

## Reports (`GET /support/reports/summary?from=&to=`)

- **Counts:**
  - open, new and unassigned tickets;
  - waiting for customer, waiting for internal team;
  - open tickets by status, priority, queue and agent;
  - backlog aging, tickets created and reopened in the period.
- **Times:** average first-response and resolution minutes.
- **SLA:** first-response and resolution compliance, active and upcoming breaches.
- **Other:** company volume, contract-related tickets, satisfaction average and count, top KB articles by views.

How the figures are produced:

- The caller's ticket scope is applied **before** anything is counted.
- Every rate includes its numerator and denominator.
- Below 5 records, the figure shows "Insufficient data" instead of a percentage.
- Definitions are returned with the data.
- Nothing is labelled as a prediction.

## Permissions (deny by default)

New modules:

- `support_inboxes`, `support_queues`, `support_sla`, `support_entitlements`;
- `knowledge_base`, `canned_responses`;
- `support_csat`, `support_reports`, `support_portal`.

New actions:

- `reply`, `resolve`, `escalate`;
- `view_internal_notes`, `add_internal_notes`, `view_restricted_notes`;
- `review`, `publish`.

The prompt's permission names map to these:

- `support.tickets.*` → `tickets:*`
- `support.messages.internal.read` → `tickets:view_internal_notes`
- `support.kb.publish` → `knowledge_base:publish`
- the same pattern for the rest.

| Role | Support access |
|---|---|
| System Owner, Org Admin | Everything |
| Department Manager (Support Manager-equivalent) | All ticket actions, configures queues and canned responses, reviews and publishes KB articles |
| Auditor/Checker | Read-only, including internal and restricted notes and audit history |
| Standard Employee (agent-equivalent) | Works tickets; creates KB drafts; no assign, merge, bulk or configuration |

**Ticket scope narrower than Organization** covers tickets the member:

- created, owns, is assigned or follows;
- sees through a queue they belong to;
- for Department scope, also sees through their department's queues.

## Fixture import

`SUPPORT_FIXTURE_ORG_ID=<org> npm run seed:support` (server) imports a
dataset. It is development only and refuses to run when
`NODE_ENV=production`.

The frontend's sample Support data is faker-random on every load, so it
has no stable IDs to preserve. Following the precedent of the existing CRM
and Sales fixture imports, the dataset is instead a small hand-written set
with the same shapes:

- a calendar, a business-hours policy, a round-robin queue with members, and inboxes (one Customer Portal, one disconnected Email placeholder);
- categories, a canned response;
- four tickets with replies and notes, with SLA clocks applied;
- a KB category and a published article.

Records are matched by stable names and slugs, so re-running creates
nothing (verified). The import prints a created, skipped and warnings
report.

## Frontend

`VITE_BACKEND_SUPPORT_MODE=true` (unchanged flag):

- the tickets slice sends an idempotency key for each create, reply, resolve, close and reopen;
- statuses include the two new ones;
- the ticket page shows an **append-only History** panel;
- in backend mode, the close control no longer records a staff satisfaction score.

`backendSupportClient.js` also has typed adapters for:

- queues, inboxes, categories, canned responses, SLA policies and entitlements;
- bulk actions, related tickets, followers, archive and restore, merge;
- the KB, reports and satisfaction;
- the Customer Portal.

Mock mode is unchanged and remains behind the flag.

## Verification

- **Backend:** 307 tests pass. Phase 4 accounts for 57 of them, covering:
  - settings; the ticket workflow, notes and round robin;
  - business hours, including DST; SLA clocks; sweep idempotency;
  - portal isolation; the KB; reports.
- **Frontend:** 1,526 tests pass; lint is clean; the production build passes.
- **Live checks against the VPS dev database:**
  - ticket core: 7/7;
  - SLA: 7/7, plus the sweep recording a breach once, at its due time;
  - portal and KB: 8/9 — the one miss is the staff API refusing a portal login with 404 instead of the expected 403, which is deliberate so an outsider can't confirm the organization exists.

## Deferred

- **Frontend pages that don't exist yet:** the Customer Portal UI, and admin screens for queues, categories, SLA, entitlements, canned responses, the KB and reports. The API and adapters are ready, but the completed frontend has no routes for them.
- **Notifications:** Mailpit notifications for public replies (optional in the prompt). SLA notifications are recorded as internal outbox events only.
- **AI preview:** consuming these summaries in the AI Intelligence preview; it remains a frontend mock.
- **Integration tests:** a separate `test:integration` suite. Verification is the unit suite plus the live checks above.
- **Legacy fields:** `csatScore`, `publicReplies`, `privateNotes` and `escalations` stay on old tickets but are no longer written.

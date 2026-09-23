# Backend Phase 4 — Support Tickets

This document covers what Backend Phase 4 added on top of Phases 1–3
(auth/organizations/RBAC, CRM core, Sales). It replaces the pre-Phase-4
ticket placeholder at `/api/v1/support/tickets` with an organization-scoped
implementation, and wires the frontend Support pages to it behind a flag.
It does **not** add email/chat/telephony channels, customer-portal access,
SLA business-hours calendars or automatic assignment — see "Deferred".

## What the placeholder got wrong

The old `routes/ticketRoutes.js` (removed) had no organization scoping and
no permission checks — any logged-in user could list and edit every
ticket — passed `PUT` bodies straight to Prisma, stored replies/notes as
JSON with only an author *name*, and numbered tickets from an in-memory
counter that reset on every restart, so the first ticket after a restart
collided with the unique `ticketNumber`.

## Architecture

```
server/src/routes/support/ticketRoutes.js
server/src/controllers/support/ticketsController.js
server/src/services/support/ticketLifecycleService.js   (SLA windows, status steps)
src/Helpers/backendSupportClient.js                     (API client, VITE_BACKEND_SUPPORT_MODE)
src/Helpers/supportTicketsBackend.js                     (maps API records onto the ticket UI's shape)
```

Same conventions as Phases 2–3: session-cookie auth, CSRF on mutations,
`requireCrmOrgPermission("tickets", action)` with `organizationId` from
query/body checked against a live membership, an allow-list for every
write (`utils/pickWritable.js`), and an audit event per mutation.

## Routes (`/api/v1/support/tickets`)

| Route | Permission | Notes |
|---|---|---|
| `GET /`, `GET /:id` | `view` | list is paged (`page`, `pageSize` ≤ 100); filters `status`, `priority`, `department`, `companyId`, `assignedMembershipId` (`unassigned`), `search` |
| `POST /` | `create` | always starts `New`; SLA deadlines computed from priority |
| `PATCH /:id` | `edit` | subject/description/source/category/priority/company/contact only; a priority change re-derives the SLA deadlines |
| `POST /:id/advance` | `edit` | New → Open → In Progress ⇄ Waiting for Customer |
| `POST /:id/assign` | `assign` | `assignedMembershipId` (or null) — an active member of the organization |
| `POST /:id/replies` | `reply` | customer-visible; the first reply records `firstRespondedAt` and opens a `New` ticket |
| `POST /:id/notes` | `edit` | internal note |
| `POST /:id/escalate` | `escalate` | moves the ticket to another department; reason required; kept as history |
| `POST /:id/resolve` | `resolve` | summary required |
| `POST /:id/close` | `close` | only from `Resolved`; optional CSAT 1–5 |
| `POST /:id/reopen` | `reopen` | only from Resolved/Closed; reason required |

## Data model

Migration `phase4_support_tickets` (additive, plus one index swap):
`Ticket` gains `organizationId`, `assignedMembershipId`,
`created/updatedByMembershipId`, `closedAt`, `version`; `ticketNumber` is
unique **per organization** (`TICKET-2026-000001`, from the same
`SalesDocumentCounter` Phase 3 uses) instead of globally. New tables:
`TicketMessage` (`Reply` | `Note`, with the author's membership) and
`TicketEscalation` (from/to department, reason, who, when). The legacy
JSON columns (`publicReplies`, `privateNotes`, `escalations`) and
`assignedAgentId` stay for pre-Phase-4 rows but aren't written anymore.

## SLA

Windows by priority — the frontend's own values: Urgent 1h/4h, High
4h/24h, Medium 8h/48h, Low 24h/72h (first response / resolution), counted
from the ticket's creation. Deadlines are only ever computed server-side.
Response SLA is met by the first public reply; resolution SLA by
resolving. The frontend derives "Overdue / At Risk / On Track / Met" from
the deadlines exactly as before.

## Permissions and scope

`tickets` grants on the five built-in roles (`prisma/seed.js`):
System Owner / Organization Administrator / Department Manager — all
actions; Auditor/Checker — `view` only; Standard Employee — view, create,
edit, reply, escalate, resolve, close (no assign/reopen).

A ticket's `department` is a support queue (Support/Billing/Technical),
not the member's HR department, so the generic Department/Team scope
can't match on it. For tickets, any scope narrower than Organization means
**tickets the member created or is assigned to**.

## Frontend

`VITE_BACKEND_SUPPORT_MODE=true` routes `redux/support/ticketsSlice.js`
through `supportTicketsBackend.js`, which maps messages and escalations
back to the UI's `publicReplies` / `privateNotes` / `escalations` arrays
and member ids to names. In backend mode the Assign dialog picks a real
member (mock mode keeps the free-text agent name) and starts from the
ticket's current department; choosing a different department there is
recorded as an escalation with that reason. Frontend tests pin this flag
off (`vite.config.js`).

## Verification

- `cd server && npm test` — 232 tests (7 new for tickets: SLA derivation,
  status steps, numbering, reply/note behavior, close rules, cross-company
  contact rejection, Own scope).
- Live check against the VPS dev database (7/7): create → reply/note →
  advance/escalate/assign → assignee scope → Auditor read-only (403 on
  reply) → resolve/close with CSAT/reopen → edits can't set status or SLA.

## Deferred

Inbound email/chat/phone channels and the Admin → Support & Communication
integrations (still a frontend preview), a customer portal, business-hours
SLA calendars and pause-while-waiting, automatic routing/assignment,
attachments, ticket merge/split, tags, bulk actions, and SLA breach
notifications through the worker.

# Backend Phase 6 — Finance

This document covers what Backend Phase 6 added on top of Phases 1–5. It
replaces the pre-Phase-6 placeholder at `/api/v1/finance` with an
organization-scoped implementation, connects Sales orders to invoicing, and
wires the Finance pages to it behind a flag.

It does **not** add payment gateways, accounting exports, multi-rate tax
setup, automatic recurring runs or invoice emails. See "Deferred".

## What the placeholder got wrong

The old `routes/financeRoutes.js` (removed) had several problems:

- It used bearer auth with no organization scoping. Any logged-in user could read every invoice and expense.
- It passed request bodies straight to Prisma. `PUT /invoices/:id` could set `status: "Paid"`, `amountPaid` or `total` directly.
- It stored money as floating point.
- It numbered invoices, credit notes and expenses from in-memory counters that reset on every restart, so numbers collided with the unique indexes.
- Its only approval rule was a role-name check.

## Architecture

```
server/src/routes/finance/financeRoutes.js
server/src/controllers/finance/invoicesController.js         (invoices, payments, credit notes)
server/src/controllers/finance/expensesController.js
server/src/controllers/finance/recurringInvoicesController.js
server/src/services/finance/financeRulesService.js           (totals, statuses, settlement)
server/src/services/finance/invoiceService.js                (the one place invoices are created)
src/Helpers/backendFinanceClient.js                          (API client, VITE_BACKEND_FINANCE_MODE)
src/Helpers/financeBackend.js                                (maps API records onto the Finance UI's shape)
```

These follow the same conventions as Phases 2–5:

- session-cookie auth, with CSRF protection on mutations;
- `requireCrmOrgPermission(module, action)`;
- server-side validation of every field;
- an audit event for every mutation.

## Routes (`/api/v1/finance`)

| Route | Permission | Notes |
|---|---|---|
| `GET /invoices`, `GET /invoices/:id` | `invoices:view` | Paged. Filters: `status` (including the derived `Overdue`), `companyId`, `orderId`, `search`. Each invoice includes its payments and credit notes. |
| `POST /invoices` | `invoices:create` | `{ companyId, dealId?, items: [{ name, qty, unitPrice, taxCategory? }], currency?, dueDate? }`. The invoice is always a Draft, and totals are always computed by the server. |
| `PATCH /invoices/:id` | `invoices:edit` | Draft only. Changes company, due date and lines; totals are recomputed. |
| `POST /invoices/:id/approve` | `invoices:approve` | Draft → Approved. At **10,000 or more**, the approver can't be the creator. |
| `POST /invoices/:id/send` | `invoices:issue` | Approved → Sent. |
| `POST /invoices/:id/void` | `invoices:cancel` | Reason required. Not allowed once any payment is recorded. |
| `POST /invoices/:id/payments` | `payments:create` | Sent or Partially Paid invoices only. The amount can't exceed what's due. Moves the invoice to Partially Paid or Paid. |
| `GET /credit-notes` | `invoices:view` | |
| `POST /credit-notes` | `invoices:credit` | `{ invoiceId, amount, reason }`. Sent, Partially Paid or Paid invoices only. Capped at the total minus earlier credits. Reduces the amount due. |
| `GET /expenses`, `POST /expenses` | `expenses:view` / `create` | A new expense is always Pending and is submitted by the caller. |
| `POST /expenses/:id/review` | `expenses:approve` or `reject` | `{ status, note? }`. Pending expenses only, and never your own. |
| `GET/POST /recurring-invoices`, `PATCH /recurring-invoices/:id` | `recurring_invoices:view` / `create` / `edit` | Line templates are validated like invoices. `active` pauses or resumes the template. |
| `POST /recurring-invoices/:id/generate` | `recurring_invoices:view` + `invoices:create` | Creates a Draft invoice. Blocked while the template is paused. |

**Sales → Finance:** `POST /sales/orders/:id/request-invoice` now creates
the order's Draft invoice from the order's own lines, including discounts
and tax categories, so the totals match the order. Each order can have
only one open (non-void) invoice.

## Money and statuses

- Every money column is `numeric(14,2)`, and all arithmetic goes through `moneyService`, the same code Quotes and Orders use. Tax uses the Sales tax categories (Standard 8%).
- `amountDue = total − amountPaid − amountCredited`, and it never goes below 0.
- Stored statuses: Draft, Approved, Sent, Partially Paid, Paid, Void.
- **Overdue** is never stored. It's derived on every read for a Sent or Partially Paid invoice that's past its due date.
- Numbers are unique per organization: `INV-2026-000001`, `CN-…` and `EXP-…`, from the same counter Sales and Support use.

## Data model

Migration `20260924090000_phase6_finance`:

- `Invoice`, `Payment`, `CreditNote`, `Expense` and `RecurringInvoice` gain `organizationId` and membership-based audit fields (who created, approved, voided, recorded, issued, submitted or reviewed).
- `Invoice` also gains `approvedAt`, `sentAt`, `paidAt`, `voidedAt`, `amountCredited`, `source` (Manual, Order or Recurring), `recurringInvoiceId` and `version`.
- `Expense` gains `reviewNote`, `reviewedAt` and `currency`.
- `RecurringInvoice` gains `currency` and `dueDays`.
- Money columns change from `double precision` to `numeric(14,2)`.
- The three document numbers become unique per organization instead of globally.

## Permissions and scope

New action: **`credit`** (issue credit notes). Grants per role (`prisma/builtInRoles.js`):

| Role | invoices | payments | expenses | recurring_invoices |
|---|---|---|---|---|
| System Owner, Org Admin | view, create, edit, approve, issue, cancel, credit | view, create | view, create, approve, reject | view, create, edit |
| Department Manager | view, create, edit | view | view, create, approve, reject | view |
| Auditor/Checker | view, view_audit_history | view | view, view_audit_history | view |
| Standard Employee | — | — | view, create | — |

Finance records have no department of their own, so scope works like this:

- **Department/Team:** records created by members of the caller's department. For expenses, that's what lets a manager review their team's expenses.
- **Anything narrower:** the caller's own records.

## Frontend

`VITE_BACKEND_FINANCE_MODE=true` routes the four Finance slices through
`financeBackend.js`. That adapter maps:

- membership ids to names (expense submitter and reviewer, invoice approver);
- each invoice's company to `companyName`.

Backend rule failures show as a toast, for example:

- approving your own large invoice;
- reviewing your own expense;
- paying more than is due.

Frontend tests pin the flag off (`vite.config.js`).

## Verification

- `cd server && npm test`: 258 tests, 12 of them new. They cover:
  - exact totals and line validation;
  - derived Overdue;
  - Draft-only creation that ignores client totals;
  - separation of duties at the threshold;
  - payment rules and settlement;
  - no voiding after payment;
  - credit note caps;
  - expense review rules;
  - paused templates;
  - scope.
- Frontend: 1,526 tests, 4 of them new.
- Live checks against the VPS dev database (8/8, plus 3/3 for order → invoice):
  1. Create a $12,000 invoice: the creator can't approve it (403), another admin can.
  2. Send it. An overpayment is rejected, a partial payment moves it to Partially Paid, and the final payment to Paid.
  3. The paid invoice can't be voided, and a credit note above the cap is rejected.
  4. An employee submits an expense, can't see invoices (403), and the manager approves the expense.
  5. The Auditor is read-only.
  6. A recurring template generates a Draft, and pausing it blocks generation.
  7. A confirmed order with a 10% line discount produces a Draft invoice for exactly the order's total, and a second request is rejected.

## Deferred

- Payment gateway integration (still a frontend preview under Admin → Commerce & Finance).
- Accounting exports.
- Configurable tax rates, and currencies beyond the Sales set.
- Automatic recurring runs through the worker (the next date from `interval`).
- Invoice and credit-note email delivery, and a customer portal.
- Refunds as their own record.
- Partial voids, write-offs, and receipt attachments on expenses.

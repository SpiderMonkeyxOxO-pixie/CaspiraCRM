# Backend Phase 6 — Finance, Expenses, Invoices, Payments, Budgets and Reconciliation

This document reports Backend Phase 6 as completed against the owner's
Back-end (VI) prompt; the checklist is in `docs/specs/BACKEND_PHASE6_SPEC.md`.
It replaces the earlier, narrower Phase 6 write-up (invoices, expenses,
credit notes and recurring invoices without a ledger).

**Finance records transactions. It never moves money.** A payment means
"recorded in the CRM": every payment carries the label *"Recorded payment —
no bank or payment-provider transfer was performed."* Nothing here claims
IFRS, GAAP or tax compliance, and no report is called audited.

It was built in five steps:

| Commit | What |
|---|---|
| `58e94a7` | Data model; settings, chart of accounts, fiscal years and periods, cost centers, tax rates, exchange rates, journals and posting |
| `d98fbf7` | Expenses, expense reports, vendors, vendor bills |
| `ffaca18` | Invoice posting, credit notes, payments and allocations, financial accounts |
| `6095c56` | Statement import, reconciliation, budgets |
| (this commit) | Reports, Customer Portal invoices, worker sweep, fixture import, frontend adapters, docs |

**Not built, by design (the prompt's boundary):**

- payment providers of any kind (Stripe, PayPal and similar), bank APIs or feeds, and card storage;
- payroll, tax filing and government reports;
- automatic approvals, posting, payment or period close;
- live exchange-rate providers;
- stored receipts or documents, and e-signatures;
- AI of any kind;
- external accounting integrations.

**Before running this phase's migration** on a database with real data,
take a backup: see `docs/FINANCE_BACKUP_RESTORE.md`.

## Money, currencies and rounding

- Amounts are Postgres `numeric`. The app does its arithmetic in Decimal and parses client input as text, never as a float.
- Currencies are validated against ISO 4217.
- Totals are never blended across currencies. Document reports keep each currency separate.
- Every total is recalculated by the backend. Client totals are ignored.
- Each line is rounded half-up to the currency's minor unit at each step:
  1. gross = quantity × price;
  2. net = gross − discount;
  3. exclusive tax: tax = net × rate, total = net + tax;
  4. inclusive tax: net = total ÷ (1 + rate), tax = total − net.
- Document totals are the sums of their rounded lines.
- **Exchange rates** are entered and approved by people, and each needs a stated source. A missing rate is refused, never guessed. The rate is snapshotted onto journals and documents.
- **Conversion rounding:** a base-currency difference of a minor unit goes onto the largest line of the lighter side, and the response reports it.
- **Finance entity:** the frontend has no multiple legal entities, so the organization is the entity. Each organization has exactly one ledger, and ledgers never mix.

## Data model

Migration `20260924170000_phase6_finance_full` is additive:

- **New tables:** `FinanceSettings`, `FinanceOverride`, `FiscalYear`, `FiscalPeriod`, `LedgerAccount`, `CostCenter`, `TaxRate`, `ExchangeRate`, `JournalEntry`, `JournalLine`, `Vendor`, `ExpenseReport`, `VendorBill`, `VendorBillLine`, `InvoiceLine`, `FinancialAccount`, `PaymentAllocation`, `StatementImport`, `StatementLine`, `ReconciliationSession`, `ReconciliationMatch`, `Budget`, `BudgetVersion`, `BudgetLine`.
- **Extended:** `Invoice`, `Payment`, `CreditNote`, `Expense`.
- **Backfill:** invoice lines are copied from the old JSON into `InvoiceLine`. Existing payments and credit notes become `Legacy Recorded`, and payments get an allocation to their invoice.
- Records created before the ledger have no journal. They're labelled *"Legacy — not in the ledger"*, and the official reports don't include them.
- **Numbers:** `JE-`, `EXPR-`, `BILL-` and `PAY-` join `INV-`, `CN-` and `EXP-`, all from the shared per-organization counter.

## The ledger

- **Double entry:**
  - at least two lines;
  - each line is a debit **or** a credit, positive and within the currency's decimals;
  - debits equal credits in both the transaction and the base currency;
  - accounts must be in the organization, active and postable (not header accounts), and allow the currency.
- **Periods:**
  - monthly periods in each fiscal year;
  - statuses Open, Soft Closed, Closed and Reopened;
  - a Closed period refuses postings; a Soft Closed one needs `fiscal_periods:post`;
  - soft close and close are separate people;
  - the close is refused while journals in the period still wait for approval;
  - reopening needs a reason;
  - nothing closes automatically.
- **Journals:**
  - Draft → Submitted → Approved → Posted, or Cancelled;
  - approval is required by default (Finance settings);
  - the creator can't approve their own journal, and neither the creator nor the approver can post it;
  - posting re-checks the balance from the stored lines and the period, then flips the status under a version check;
  - posted journals are immutable; a correction is a **reversal** (a mirror entry, linked both ways, at most one per journal) plus a new entry.
- **Journals behind documents** (invoice, bill, expense, expense report, payment, credit note, write-off): created and posted in the same transaction as the document's posting step. They are reversed only through the document (void or reverse), never directly.
- **Chart of accounts:**
  - `POST /finance/setup/chart-of-accounts` previews a starter chart; `confirm: true` creates only the codes that are still free, and sets the default accounts;
  - an account's type, normal balance and currency lock once it has lines;
  - codes never change;
  - archived accounts stay in reports.

## Documents

| Document | Flow | Posting creates |
|---|---|---|
| Expense | Draft → Pending (submitted) → Approved / Rejected → Posted → Reimbursed Record | Dr expense (+ non-recoverable tax), Dr recoverable tax / Cr Employee Reimbursements Payable |
| Expense report | Draft → Submitted → Under Review → Approved / Rejected → Posted → Reimbursed Record | One journal for all its expenses (one currency per report) |
| Vendor bill | Draft → Submitted → Approved → Posted → Partially Paid → Paid; Disputed; Void | Dr line accounts, Dr recoverable tax / Cr Accounts Payable |
| Invoice | Draft → (Submitted) → Approved → Posted → Sent → Partially Paid → Paid; Disputed; Void; Written Off | Dr Accounts Receivable / Cr revenue, Cr tax payable |
| Credit note | Draft → Approved → Posted | Dr revenue, Dr tax / Cr Accounts Receivable |
| Payment | Draft → Submitted → Approved → Posted → Reversed | In: Dr cash account / Cr AR. Out: Dr AP / Cr cash account |

- **Expenses:**
  - the frontend's "Pending" label is kept for submitted expenses;
  - over the policy limit an expense needs a reason from the submitter, and `expenses:approve_exception` from the approver;
  - rejection needs a reason;
  - editing the amount, date, currency, category or tax after review sends it back to Pending;
  - receipts are metadata only: `stored: false`, and no file is kept;
  - "Reimbursed Record" posts Dr Employee Reimbursements Payable / Cr the chosen financial account. It is a record — no money moves.
- **Invoices:**
  - lines are immutable snapshots, never repriced from the catalog;
  - a line with `taxRateId` uses a configured tax rate; otherwise the Sales tax category's preview rate is snapshotted (the same totals as Quotes and Orders);
  - at or above the approval threshold (Finance settings, default 10,000) the creator can't approve;
  - `post` is a separate, idempotent step by `invoices:post`;
  - `send` only marks a posted invoice as sent — no email leaves the CRM;
  - void reverses the posted journal, and is refused once there are payments or credits;
  - write-off needs a reason and an expense account.
- **Credit notes:**
  - only against a posted invoice;
  - capped at the invoice total minus credits, including drafts; exceeding it needs the audited override;
  - split into revenue and tax in the invoice's proportion;
  - a refund is a separate recorded outgoing payment.
- **Payments:**
  - allocations are validated against the organization, currency, direction, customer or vendor, and what's still owed; they're re-validated at posting;
  - allocations change a document's paid and due amounts only when the payment is posted, atomically, under the document's version;
  - reversing a payment reverses its journal and every allocation;
  - the Invoice page's "Record payment" now creates a **draft** payment allocated to that invoice. It reaches the invoice only after approval and posting, so the page shows it under `pendingPayments` until then.
- **Vendor bills:** a vendor reference can't be entered twice for the same vendor (409).
- **Financial accounts:**
  - only the last 4 digits are accepted, shown as `•••• 1234`;
  - the reference is masked further without `financial_accounts:view_sensitive_fields`;
  - an opening balance is a drafted journal that goes through the normal steps, never a stored number.

## Statement import and reconciliation

- **Import:**
  - `import-preview` parses, maps columns, validates, flags duplicates and lists row errors, and **saves nothing**;
  - `import-confirm` saves atomically, refuses the same file (checksum) and skips lines already imported (per-line fingerprint);
  - row errors block the import unless `skipInvalidRows: true`;
  - limits: 1 MB and 5,000 rows per file;
  - date formats are explicit;
  - text starting with `=`, `+` or `@` is stored with a leading apostrophe, so it can never run as a formula;
  - there's no bank connection.
- **Reconciliation:**
  - a session covers one account and a period, and is completed only by a person;
  - matching is manual and supports one-to-one, split, many-to-one and one-to-many groups; a group's signed totals must be equal;
  - suggestions come from an exact-match rule (amount and sign, date within 3 days, reference hints first) and say "Not AI";
  - lines can be excluded with a reason;
  - `adjustment-preview` drafts a journal for, say, a bank fee, and saves nothing;
  - to complete, every statement line in the period must be matched or excluded, the difference must be zero, and the approver must be someone other than the preparer.

## Budgets

- Versions go Draft → Submitted → Approved or Rejected → Active → Superseded.
- Only a Draft version's lines change; any other change is a new version.
- Lines are revenue and expense accounts, optionally by period, cost center, department or project.
- The preparer can't approve their own version.
- Activating a version supersedes the previous active one and creates **no** journals.

## Reports

`GET /finance/reports` lists the reports; `GET /finance/reports/:report` runs one.

**From posted journals** (base currency; reversals included, so reversed entries net to zero):

- `trial-balance`, `profit-and-loss`, `balance-sheet`, `cash-flow` (direct method, by the other side of each journal), `general-ledger` (with running balance), `journal-register`, `revenue-by-period`, `tax-summary` (labelled *operational estimate*);
- `budget-vs-actual` (actuals from the ledger; a budget in another currency is flagged, not converted).

**From documents** (per currency, never blended):

- `receivables-aging`, `payables-aging`, `invoice-status`, `overdue-invoices`, `bill-status`, `recorded-payments`, `expenses` (by category, department and project), `cash-balances`, `reconciliation-differences`, `currency-exposure`.

**Aging buckets** are measured in days past due at the as-of date:

- **Current:** not yet due (a due date on the as-of date counts as current);
- then 1–30, 31–60, 61–90 and 90+ days.

Void, written-off and paid documents are excluded.

Every report returns a `meta` block with its name, date or period, source, definition, base currency and "not audited" disclaimer. The balance sheet shows accumulated earnings as a separate equity line, because there is no year-end closing entry.

## Customer Portal

- **Routes:** `/portal/finance/invoices` (list, get), `/portal/finance/credit-notes` and `/portal/finance/payments`.
- **What a customer sees:** only their own company's **posted** invoices — all of them with company-wide access, otherwise those addressed to their contact.
- **Never exposed:** ledger accounts, journals, approvals, creators, cost or margin, bills and other customers.
- Payments carry the record-only label, and `payNow` is always `false`.

## Worker

The worker runs `runFinanceSweep` hourly (`FINANCE_SWEEP_INTERVAL_MS`). It records one internal notification per subject for:

- overdue and due-soon invoices and bills;
- periods ending within 5 days that are still open;
- accounts with statement lines unreconciled after 30 days.

It never approves, posts, pays, closes a period, contacts a customer or calls AI. Reports are computed live, so there's no cache to refresh.

## Permissions

**New modules** (deny by default): `finance_configuration`, `fiscal_periods`, `ledger_accounts`, `journals`, `credit_notes`, `vendors`, `bills`, `financial_accounts`, `reconciliation`, `budgets`, `finance_reports`, `finance_overrides`. The existing modules are `invoices`, `payments`, `expenses` and `recurring_invoices`.

**New actions:** `post`, `reverse`, `allocate`, `reimburse`, `override_controls`, `approve_exception`.

| Role | Finance access |
|---|---|
| System Owner | Everything, including `override_controls`; still audited |
| Organization Administrator | Configures settings, the chart, tax, vendors and financial accounts; approves invoices, bills, credit notes, expenses and budgets. **No** posting, payments or period close |
| **Finance Manager** (new) | Approves and posts, reverses, closes and reopens periods, approves reconciliations, activates budgets |
| **Accountant** (new) | Prepares and posts journals, invoices, bills, payments and credit notes; soft-closes periods; prepares reconciliations |
| Department Manager | Drafts invoices; reviews the department's expenses; drafts department budgets |
| Auditor / Checker | Read-only everywhere, including overrides |
| Standard Employee | Their own expenses (create, submit, view) |

**Separation of duties** (403 `FINANCE_SEPARATION_OF_DUTIES`):

- expense or report submitter vs approver;
- invoice creator vs approver, at or above the threshold;
- journal creator vs approver vs poster;
- bill entrant vs approver;
- payment recorder vs approver;
- credit-note creator vs approver;
- reconciliation preparer vs approver;
- budget preparer vs approver;
- period soft-closer vs closer;
- exchange-rate enterer vs approver.

It can be switched off per organization in Finance settings, and that change is audited. The emergency override needs `finance_overrides:override_controls` plus an `overrideReason`. It's recorded in `FinanceOverride`, which auditors can list at `GET /finance/overrides`, and in the audit log. Refused attempts are audited too.

**Idempotency keys** are required on:

- journal post and reverse;
- invoice post, write-off and "record payment";
- credit-note post;
- bill post;
- expense and expense-report post and reimbursement;
- payment post, allocate and reverse;
- statement import;
- reconciliation completion;
- budget activation.

## Fixture import

`FINANCE_FIXTURE_ORG_ID=<org id> npm run seed:finance` refuses to run in production. It creates, only when missing:

- the starter chart;
- the current fiscal year;
- a 12% tax rate;
- a financial account;
- one posted invoice.

It then checks every invoice's lines against its totals, every posted journal's balance and the trial balance, and **reports** mismatches instead of fixing them.

Run twice on dev, the second run created nothing, and the trial balance balanced (9,092.50 on both sides).

## Frontend

`backendFinanceClient.js` has adapters for every area above, including the portal. Posting steps send an `Idempotency-Key`.

- In backend mode, **Send** on an approved invoice posts it first, then marks it sent.
- The invoice and expense status lists include the ledger states.
- The existing pages are otherwise unchanged, and mock mode stays.

**Deploy the frontend and backend together.**

## Verification

- `cd server && npm test`: 400 tests pass (51 files); 72 of them are in `controllers/finance` and cover:
  - the ledger, periods, separation of duties and overrides;
  - expenses, reports and bills;
  - invoices, payments, settlement and credit notes;
  - statement import, reconciliation and budgets;
  - reports, the portal and the sweep.
- Frontend: 1,526 tests pass; `vite build` succeeds.
- Live checks against the VPS dev database (this machine's API on port 4100), all passing:
  - **Step 1 (8/8):** chart, fiscal year, unbalanced and header-account refusals, journal separation of duties, idempotent post replay, reversal, period close and reopen, exchange-rate approval, read-only auditor.
  - **Steps 2–3 (9/9 after a script fix):** masked financial account, expense and reimbursement, expense report, bill with tax and duplicate refusal, invoice post and send, payment and allocation, outgoing payment settling a bill, credit note, payment reversal restoring the balance.
  - **Step 4 (3/3):** import preview, confirm and duplicate refusal with inert formulas; reconciliation from suggestions to completed with zero difference; budget versions superseding each other with no journals.
  - **Step 5:** reports on the live ledger. The trial balance balanced (9,092.50 on both sides), P&L net income (2,030.43) equalled balance-sheet equity with the sheet balanced, aging stayed per currency, the tax summary was labelled an estimate, budget vs actual used the active version, and an employee got 403.

## Deferred

- New frontend screens for the ledger, periods, bills, payments, reconciliation, budgets, reports and the portal's finance pages: the adapters exist, the pages don't yet.
- The prompt's deterministic AI-preview scenarios (no AI in this phase).
- A year-end closing entry to retained earnings.
- Recurring-invoice generation in the worker (still a person's action).
- The portal finance endpoints have unit tests but weren't exercised with a live portal login this phase.
- The prompt asks for roughly 120 test cases; 72 finance unit tests plus the live checks cover the main rules, but not every listed case.

# Backend Phase 6 — Finance, Expenses, Invoices, Payments, Budgets and Reconciliation

This is a condensed checklist of the owner's "Back-end (VI)" prompt, the
source of truth for this phase. Every requirement is kept; the wording is
shortened.

**Critical boundary:** Finance records transactions. It never moves money.
A Payment means "recorded in the CRM", not "transferred". Don't claim
IFRS, GAAP or tax compliance.

## Boundary: do NOT implement

- Payment providers: Stripe, PayPal, Razorpay, GCash, PayMaya, crypto.
- Banking: bank APIs, open banking, automatic feeds, real collection or refunds, card storage.
- Payroll and government: payroll, tax filing, government reports.
- Automation: live exchange-rate providers, automatic accounting decisions, automatic approval of expenses, invoices or payments, automatic posting, automatic period close.
- Documents: receipt or document storage, e-signatures.
- AI: Claude or OpenAI, AI advice, categorization or fraud flags.
- Also out: external accounting integrations.
- Don't redesign the Finance routes or remove mock mode.

## Models and rules

- **Money:**
  - Postgres numeric (or minor units), with decimal arithmetic in the app. Never floats.
  - Every amount has a currency (ISO 4217, validated), precision, rounding mode and calculation order.
  - No silent conversion and no mixed-currency totals.
  - The backend recalculates every total, and frontend totals are previews only.
  - Rounding is documented.
- **Finance Entity:** only if the frontend supports several legal entities; otherwise the organization is the entity and the limitation is documented. Ledgers never mix. No invented tax IDs.
- **Fiscal Year and Periods:**
  - Name, start, end, period number, status (Open, Soft Closed, Closed, Reopened), closed and reopened by and date, reopen reason, version.
  - No overlaps. Postings need a valid period. Closed periods reject postings; soft-closed need an elevated permission.
  - Reopening needs an elevated permission and a reason. Audited, and never closed automatically.
- **Chart of Accounts:**
  - Code (unique), name, description, type (Asset, Liability, Equity, Revenue, Expense), parent, normal balance, currency restriction, posting allowed, active, audit fields, version, archived.
  - Same ledger, no cycles. Header accounts can't be posted to. Accounts with activity can't be deleted and their type is locked. Archived accounts stay in reports.
- **Cost Center:** code, name, description, parent (no cycles), department, project, owner, active, effective dates, archived. Same organization only.
- **Tax Rate:**
  - Name, code, rate (% or basis points), type, recoverable, inclusive or exclusive, effective dates, ledger accounts, active, version.
  - A snapshot is kept on posted documents, and later changes never alter history. No compliance claims, no fetching rates.
- **Exchange Rate (manual):** base, quote, positive rate, effective date, **source description required**, entered and approved by, version. Snapshotted into transactions, with no provider.
- **Journal Entry:**
  - Number, entry date, period, description, source type and ID, reference, currency, rate snapshot, status (Draft, Submitted, Approved, Posted, Reversed, Cancelled), submitted, approved and posted by, posted date, reversal links, version.
  - **Lines:** account, cost center, project, description, debit, credit, currency, base debit and credit, tax snapshot, order.
  - Debits equal credits, at least 2 lines, never both a debit and a credit on one line, no negatives.
  - Accounts must be active and postable. The date must fall in an eligible period.
  - Posted entries are immutable; corrections use a reversal plus a replacement. Client totals aren't trusted, and posting is atomic.
- **Posting:** done by a person, with a permission, approval (if configured), separation of duties, a version check, an idempotency key, an open period, balanced lines, valid accounts and an audit event. The creator can't approve or post their own restricted journal.
- **Vendor:** a profile on a Phase 2 Company (not a copy): vendor code, payment terms, tax configuration, currency, default payable account, active. Not exposed through CRM endpoints.
- **Expense:**
  - Number, submitter, category, merchant or vendor, date, description, currency, amount before tax, tax, total, rate snapshot, base amount;
  - cost center, project, billable, customer company, payment method description;
  - status, policy exception and reason, submitted, approved and rejected by and date, reason, posted journal, version, archived.
  - Receipt metadata only, as a placeholder, never pretending a file is stored.
- **Expense Report:**
  - Number, submitter, date range, currency summary, description, status (Draft, Submitted, Under Review, Approved, Rejected, Posted, Reimbursed Record, Cancelled), dates, reason, posted journal, version.
  - "Reimbursed Record" means recorded, not paid.
- **Expense approval:** no approving your own; rejection needs a reason; exceptions need a permission; material edits reset approval; approved reports stay unposted until posted separately; posting creates a balanced journal; posted is immutable; corrections via adjustment or reversal; no automatic reimbursement.
- **Customer Invoice:**
  - Number, company, contact, source order, contract and project, currency, rate snapshot, invoice date, due date, payment terms, billing address snapshot;
  - status (Draft, Submitted, Approved, Posted, Partially Paid, Paid, Overdue, Disputed, Void, Written Off — adapted to the frontend's labels);
  - subtotal, discount, tax, grand total, paid, balance due, approval status, posted journal, created, approved and posted by, version, archived.
- **Invoice lines:** immutable snapshots of product, description, quantity, unit price, discount, tax-rate snapshot, tax, line subtotal and total, revenue account, cost center, project, order. Recalculated by the backend, never repriced from the catalog.
- **Invoices generally:** posted is immutable; no real email; generating from an order needs a person to confirm.
- **Invoice posting:** checks approval, totals, accounts and period; creates a balanced journal (Accounts Receivable, revenue, tax) and links it; atomic, idempotent, audited.
- **Credit Note:**
  - Number, source invoice, company, date, reason, currency, line snapshots, subtotal, tax adjustment, total, status, approval, posted journal, applied and remaining amounts, version.
  - Can't exceed what's eligible without an exception. Posting creates a reversing journal. No money moves (refunds are manual records). Posted is immutable.
- **Vendor Bill:** number, vendor, vendor reference, bill and due dates, currency, rate, terms, status (Draft, Submitted, Approved, Posted, Partially Paid, Paid, Overdue, Disputed, Void), subtotal, tax, total, paid, balance, accounts, cost center, project, approval, journal, version, archived. Duplicates blocked by organization + vendor + vendor reference.
- **Payment (manual record):**
  - Number, direction (Incoming, Outgoing), financial account, company, currency, amount, rate, date, reference, method, status (Draft, Submitted, Approved, Posted, Reversed, Cancelled), approval, journal, reversal payment, created, approved and posted by, version.
  - Labelled **"Recorded payment — no bank or payment-provider transfer was performed."**
- **Allocation:**
  - Payment → invoice or bill, amount, date, created by, reversal state.
  - Same organization and currency; never more than the payment has or the document owes.
  - Updates paid and balance atomically (full → Paid, partial → Partially Paid). Reversing a payment reverses its allocations and ledger entries. Concurrency-safe.
- **Financial Account:** name, type (Cash, Bank, Clearing, Card, Other), **masked** reference, currency, ledger account, opening balance via a journal only, active, archived. No bank credentials, no full card numbers.
- **Statement import:**
  - Bounded CSV that's previewed first: parse without saving, map columns, validate, detect duplicates, show errors, then confirm and save atomically.
  - Import record: account, period, checksum, safe file name, imported by, status, line count.
  - Lines: date, value date, description, reference, debit or credit, amount, currency, running balance, row number, duplicate fingerprint, reconciliation status.
  - Size and row limits; formulas never executed; checksum and fingerprint dedupe; no claim of a bank connection.
- **Reconciliation:**
  - Session: account, dates, opening, closing, statement and ledger balances, difference, status, created and approved by, completed, version.
  - Match: statement line ↔ journal line or payment, type, amount, reason, created and approved by, reversed.
  - Manual matching, deterministic exact-match suggestions (amount, currency, date tolerance, reference, company, payment number), split, many-to-one and one-to-many matches, unmatched items, adjustment preview.
  - Nothing is committed without a person confirming, and suggestions are never called AI.
- **Budget:**
  - Name, fiscal year, currency, status (Draft, Submitted, Approved, Active, Superseded, Archived), owner, current version.
  - Immutable versions with lines: account, cost center, department, project, period, planned amount, notes.
  - Approved versions are immutable; a change creates a new version; no approving your own; activating supersedes the previous version; nothing is deleted; activation creates no journals.

## Permissions (deny by default)

- **Setup:** `finance.configuration.read/manage`, `periods.read/close/reopen`.
- **Ledger:** `accounts.read/manage`, `journals.read/create/approve/post/reverse`.
- **Expenses:** `expenses.read_own/read_team/create/submit/approve/post`.
- **Invoices and credit notes:** `invoices.read/create/update/approve/post/void`, `credit_notes.create/approve/post`.
- **Bills and payments:** `bills.read/create/approve/post`, `payments.read/create/approve/post/reverse`.
- **Reconciliation and budgets:** `reconciliation.read/manage/approve`, `budgets.read/create/approve/activate`.
- **Reports and audit:** `reports.read`, `sensitive.read`, `audit.read`.

Roles:

- **System Owner:** still audited.
- **Org Admin:** configures, but does NOT automatically get posting or payment permissions.
- **Executive:** reports, and approvals where assigned.
- **Finance Manager.**
- **Accountant.**
- **Department Manager:** department expenses and budgets.
- **Project Manager:** project financial summaries only.
- **Employee:** own expenses.
- **Auditor:** read-only.
- **Portal user.**

## APIs (under `/api/v1/finance`)

- **Endpoints for:** configuration, fiscal years and periods, accounts, cost centers, tax rates, exchange rates, journals, expenses, expense reports, invoices, credit notes, vendors, bills, payments and allocations, financial accounts, statement import, reconciliation, budgets, reports.
- **Journals:** list, create, get, update, `submit`, `approve`, `post`, `reverse`.
- **Expenses:** list, create.
- **Expense reports:** create, `submit`, `approve`, `reject`, `post`.
- **Invoices:** list, create, get, update, `submit`, `approve`, `post`, `void`.
- **Bills:** list, create, `approve`, `post`.
- **Payments:** list, create, `approve`, `post`, `reverse`, `allocations`.
- **Statements:** `statements/import-preview`, `import-confirm`.
- **Reconciliations:** list, create, `matches`, `complete`.
- **Budgets:** list, create, `versions`, `submit`, `approve`, `activate`.
- **Portal:** `/portal/finance/invoices` (list, get), `credit-notes`, `payments`. Never exposes ledger accounts, journals, cost or margin, approvals, bills or other customers, and has no "Pay Now" button.

## Other requirements

- **Reports:**
  - Statements: Profit & Loss, Balance Sheet, Cash Flow, Trial Balance, General Ledger, journal register.
  - Breakdowns: revenue by period; expenses by category, department and project.
  - Documents: receivables aging, payables aging, invoice status, overdue invoices, bill status, recorded payments.
  - Other: budget vs actual, cash account balances, reconciliation differences, tax summary (marked "operational estimate"), multi-currency exposure.
  - Official reports use posted journals only. Draft, Approved and Posted are kept apart; records are authorized first; currencies stay separate; each report shows its date, period, source and definition; nothing is called "audited".
- **Aging buckets:** Current, 1–30, 31–60, 61–90, 90+ days, with date boundaries documented; Void and fully paid excluded.
- **Worker:** mark or identify overdue invoices and bills, due-date notifications, periods nearing close, unreconciled lines, report caches. Idempotent. Never approves, posts, pays, closes, messages customers or calls AI.
- **Sensitive fields (backend-protected everywhere):** balances, bank references, expenses, cost, margin, vendor terms, payment references, rates, tax configuration, budgets, journals, thresholds, reconciliation data, reports.
- **Separation of duties** (configurable) between:
  - expense submitter and approver;
  - invoice creator and approver;
  - journal creator and approver, and approver and poster;
  - payment creator and approver;
  - reconciliation preparer and approver;
  - budget creator and approver;
  - period preparer and closer.
  - An emergency override needs an elevated permission, a reason, an audit event and visibility to auditors.
- **Version checks:** configuration, periods, accounts, expense, invoice and bill edits, allocations, matches, budget versions.
- **Idempotency keys:** journal post and reverse, invoice generation and posting, credit-note posting, bill posting, payment post and reverse, allocations, statement import, reconciliation completion, budget activation.
- **Fixture import:** idempotent, recalculates totals, validates balanced journals, reports mismatches, never in production.
- **Frontend adapters:** for every area, with Draft, Approved and Posted clearly shown, the honest payment label, no silent mock fallback, and duplicate submissions prevented.
- **AI preview:** deterministic scenarios only.
- **Audit:** everything above, including overrides and unauthorized attempts. Bank references are never exposed.
- **Backup and restore:** documented development database backup and restore commands before financial migrations.
- **Tests and security:** about 120 test cases (see the original), plus the security list.

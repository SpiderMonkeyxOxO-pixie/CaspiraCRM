// Backend Phase 6 (full spec) — customer invoices.
//
// Draft → (Submitted) → Approved → Posted → Sent → Partially Paid → Paid;
// Disputed; Void; Written Off. "Overdue" is derived on read. Only a Draft
// is editable; totals are always computed here. At or above the approval
// threshold (Finance settings) the creator can't approve their own invoice.
// Posting is a separate, idempotent step by a person with invoices:post: it
// creates a balanced journal (Accounts Receivable against revenue and tax)
// and makes the invoice immutable. "Send" only marks it as sent — no email
// leaves the CRM. Payments and credit notes change what's owed only when
// they are posted.
import prisma from "../../lib/prisma.js";
import { toApi } from "../../utils/serialize.js";
import { broadestScope } from "../../services/crm/scopeService.js";
import { toMoney } from "../../services/sales/moneyService.js";
import { createDraftInvoice, computeInvoiceDocument, invoiceLineRows } from "../../services/finance/invoiceService.js";
import { PAYABLE_STATUSES } from "../../services/finance/financeRulesService.js";
import {
  invalid, notFound, badTransition, versionConflict, staleVersion, audit, isCurrency, parseDay, text, getSettings, checkSeparation, PAYMENT_LABEL,
} from "../../services/finance/financeCommon.js";
import { loadTaxRates } from "../../services/finance/documentMath.js";
import { LedgerError, sendLedgerError, postSystemJournal, reverseJournal } from "../../services/finance/ledgerService.js";
import { canPostSoftClosed } from "./ledgerSetupController.js";

const MAX_PAGE_SIZE = 100;
const who = (req) => req.membership?.id || null;
export const INVOICE_STATUSES = ["Draft", "Submitted", "Approved", "Posted", "Sent", "Partially Paid", "Paid", "Disputed", "Void", "Written Off", "Overdue"];
const UNPAID = ["Posted", "Sent", "Partially Paid"];

// Finance records have no department of their own: Department/Team scope
// means records created by members of the caller's department, anything
// narrower means the caller's own. Shared with expenses/recurring.
export function financeScopeWhere(req, moduleId, membershipRelation, membershipIdField) {
  if (req.isSystemOwnerOverride) return {};
  const scope = broadestScope(req.membership, moduleId);
  if (scope === "Organization" || scope === "System-wide") return {};
  if ((scope === "Department" || scope === "Team") && req.user.department) {
    return { [membershipRelation]: { user: { department: req.user.department } } };
  }
  return { [membershipIdField]: req.membership.id };
}

export const scopeWhere = (req) => financeScopeWhere(req, "invoices", "createdByMembership", "createdByMembershipId");

const INCLUDE = {
  company: { select: { id: true, name: true } },
  payments: { orderBy: { date: "asc" } },
  creditNotes: { orderBy: { createdAt: "asc" } },
  lines: { orderBy: { lineNumber: "asc" } },
  allocations: { include: { payment: { select: { id: true, paymentNumber: true, status: true, method: true, date: true, reference: true } } } },
};

// "Overdue" is time-dependent, so it's derived on every read.
export function displayStatus(invoice, now = new Date()) {
  if ([...UNPAID, ...PAYABLE_STATUSES].includes(invoice.status) && invoice.dueDate && new Date(invoice.dueDate) < now && toMoney(invoice.amountDue).greaterThan(0)) return "Overdue";
  return invoice.status;
}

export const serializeInvoice = (invoice) => {
  const out = { ...toApi(invoice), status: displayStatus(invoice), storedStatus: invoice.status, ledgerState: invoice.journalEntryId ? "Posted to ledger" : invoice.status === "Draft" || invoice.status === "Submitted" || invoice.status === "Approved" ? "Not posted" : "Legacy — not in the ledger" };
  // The payments list shows posted allocations as the UI's `payments`.
  if (invoice.allocations) {
    out.payments = invoice.allocations.filter((a) => a.status === "Active").map((a) => ({ _id: a.payment?.id || a.id, amount: Number(a.amount), method: a.payment?.method || null, date: a.payment?.date || a.allocationDate, reference: a.payment?.reference || null, label: PAYMENT_LABEL }));
    out.pendingPayments = invoice.allocations.filter((a) => a.status === "Pending").map((a) => ({ paymentId: a.paymentId, amount: Number(a.amount), paymentStatus: a.payment?.status }));
  }
  return out;
};

export async function loadInvoice(req, res, id = req.params.invoiceId) {
  const invoice = await prisma.invoice.findFirst({ where: { id, organizationId: req.organizationId, ...scopeWhere(req) }, include: INCLUDE });
  if (!invoice) res.status(404).json({ code: "FINANCE_RECORD_NOT_FOUND", message: "Invoice not found." });
  return invoice;
}

async function saved(res, invoiceId, status = 200, extra = {}) {
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId }, include: INCLUDE });
  res.status(status).json({ invoice: serializeInvoice(invoice), ...extra });
}

async function validateRefs(organizationId, { companyId, dealId, contactId, contractId, projectId }) {
  if (companyId && !(await prisma.company.findFirst({ where: { id: companyId, organizationId } }))) return "companyId";
  if (dealId) {
    const deal = await prisma.deal.findFirst({ where: { id: dealId, organizationId } });
    if (!deal) return "dealId";
    if (companyId && deal.companyId && deal.companyId !== companyId) return "dealId (belongs to a different company)";
  }
  if (contactId && !(await prisma.contact.findFirst({ where: { id: contactId, organizationId } }))) return "contactId";
  if (contractId && !(await prisma.contract.findFirst({ where: { id: contractId, organizationId } }))) return "contractId";
  if (projectId && !(await prisma.project.findFirst({ where: { id: projectId, organizationId } }))) return "projectId";
  return null;
}

export async function list(req, res) {
  const q = req.query;
  const page = Math.max(1, Number(q.page) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(q.pageSize) || 25));
  const where = { organizationId: req.organizationId, archivedAt: null, ...scopeWhere(req) };
  if (q.companyId) where.companyId = q.companyId;
  if (q.orderId) where.orderId = q.orderId;
  if (q.status === "Overdue") Object.assign(where, { status: { in: UNPAID }, dueDate: { lt: new Date() } });
  else if (q.status) where.status = q.status;
  if (q.search) where.AND = [{ invoiceNumber: { contains: q.search, mode: "insensitive" } }];
  const [invoices, total] = await Promise.all([
    prisma.invoice.findMany({ where, include: INCLUDE, orderBy: { issueDate: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.invoice.count({ where }),
  ]);
  res.json({ invoices: invoices.map(serializeInvoice), total, page, pageSize });
}

export async function getOne(req, res) {
  const invoice = await loadInvoice(req, res);
  if (!invoice) return;
  res.json({ invoice: serializeInvoice(invoice) });
}

export async function create(req, res) {
  const { companyId = null, dealId = null, contactId = null, contractId = null, projectId = null, items, currency = "USD" } = req.body;
  if (!isCurrency(currency)) return invalid(res, "currency must be an ISO 4217 code.");
  let dueDate;
  try { dueDate = parseDay(req.body.dueDate, "dueDate", { required: false }); } catch (err) { return invalid(res, err.message); }
  const refError = await validateRefs(req.organizationId, { companyId, dealId, contactId, contractId, projectId });
  if (refError) return res.status(400).json({ code: "FINANCE_REFERENCE_INVALID", message: `${refError} must reference a record in this organization.` });
  let invoice;
  try {
    invoice = await prisma.$transaction((tx) => createDraftInvoice(tx, {
      organizationId: req.organizationId, membershipId: who(req), companyId, dealId, lines: items ?? req.body.lines, currency, dueDate,
      extra: { contactId, contractId, projectId, billingAddress: req.body.billingAddress && typeof req.body.billingAddress === "object" ? req.body.billingAddress : undefined },
    }));
  } catch (err) {
    if (err instanceof RangeError) return invalid(res, err.message);
    throw err;
  }
  await audit(req, "finance.invoice.created", "Invoice", invoice.id);
  await saved(res, invoice.id, 201);
}

// Only a Draft can be edited; totals are recomputed from the lines.
export async function update(req, res) {
  const existing = await loadInvoice(req, res);
  if (!existing) return;
  if (existing.status !== "Draft") return badTransition(res, "Only a draft invoice can be edited.");
  if (staleVersion(req.body, existing)) return versionConflict(res, "invoice");
  const data = {};
  for (const f of ["companyId", "contactId", "contractId", "projectId"]) if (f in req.body) data[f] = req.body[f] || null;
  if ("dueDate" in req.body) {
    try { data.dueDate = parseDay(req.body.dueDate, "dueDate", { required: false }); } catch (err) { return invalid(res, err.message); }
  }
  if ("billingAddress" in req.body) data.billingAddress = req.body.billingAddress && typeof req.body.billingAddress === "object" ? req.body.billingAddress : null;
  const refError = await validateRefs(req.organizationId, { companyId: "companyId" in data ? data.companyId : existing.companyId, dealId: existing.dealId, contactId: data.contactId, contractId: data.contractId, projectId: data.projectId });
  if (refError) return res.status(400).json({ code: "FINANCE_REFERENCE_INVALID", message: `${refError} must reference a record in this organization.` });
  let doc = null;
  if ("items" in req.body || "lines" in req.body) {
    try { doc = await computeInvoiceDocument(prisma, req.organizationId, req.body.items ?? req.body.lines, existing.currency); } catch (err) {
      if (err instanceof RangeError) return invalid(res, err.message);
      throw err;
    }
    Object.assign(data, { items: doc.items, subtotal: doc.subtotal, tax: doc.tax, total: doc.total, discountTotal: doc.discountTotal, amountDue: doc.total });
  }
  const ok = await prisma.$transaction(async (tx) => {
    const updated = await tx.invoice.updateMany({ where: { id: existing.id, version: existing.version, status: "Draft" }, data: { ...data, updatedByMembershipId: who(req), version: { increment: 1 } } });
    if (updated.count !== 1) return false;
    if (doc) {
      await tx.invoiceLine.deleteMany({ where: { invoiceId: existing.id } });
      await tx.invoiceLine.createMany({ data: invoiceLineRows(req.organizationId, existing.id, doc.lines, existing.orderId) });
    }
    return true;
  });
  if (!ok) return versionConflict(res, "invoice");
  await audit(req, "finance.invoice.updated", "Invoice", existing.id);
  await saved(res, existing.id);
}

async function move(req, res, invoice, from, data, action, extra = {}) {
  const updated = await prisma.invoice.updateMany({ where: { id: invoice.id, version: invoice.version, status: { in: from } }, data: { ...data, updatedByMembershipId: who(req), version: { increment: 1 } } });
  if (updated.count !== 1) return versionConflict(res, "invoice");
  await audit(req, action, "Invoice", invoice.id, { before: { status: invoice.status }, after: { status: data.status }, ...extra });
  return saved(res, invoice.id);
}

export async function submit(req, res) {
  const existing = await loadInvoice(req, res);
  if (!existing) return;
  if (existing.status !== "Draft") return badTransition(res, "Only a draft invoice can be submitted.");
  return move(req, res, existing, ["Draft"], { status: "Submitted", submittedByMembershipId: who(req), submittedAt: new Date() }, "finance.invoice.submitted");
}

// Draft/Submitted → Approved. At or above the approval threshold the
// approver must not be the invoice's creator (separation of duties).
export async function approve(req, res) {
  const existing = await loadInvoice(req, res);
  if (!existing) return;
  if (!["Draft", "Submitted"].includes(existing.status)) return badTransition(res, "Only a draft or submitted invoice can be approved.");
  if (staleVersion(req.body, existing)) return versionConflict(res, "invoice");
  const settings = await getSettings(prisma, req.organizationId);
  const threshold = toMoney(settings.invoiceApprovalThreshold ?? 10000);
  if (toMoney(existing.total).greaterThanOrEqualTo(threshold)) {
    const rule = `Invoices of ${threshold.toFixed(2)} or more must be approved by someone other than their creator.`;
    if (!(await checkSeparation(req, res, { settings, sameActor: !!who(req) && existing.createdByMembershipId === who(req), rule, action: "invoice.approve", targetType: "Invoice", targetId: existing.id }))) return;
  }
  return move(req, res, existing, ["Draft", "Submitted"], { status: "Approved", approvedAt: new Date(), approvedByMembershipId: who(req) }, "finance.invoice.approved");
}

// Dr Accounts Receivable (total) / Cr revenue per line / Cr tax payable.
export async function invoiceJournalLines(db, invoice, settings) {
  if (!settings.receivableAccountId) throw new LedgerError("No Accounts Receivable account is configured in Finance settings.");
  const lines = [{ accountId: settings.receivableAccountId, debit: toMoney(invoice.total).toFixed(2), companyId: invoice.companyId, description: invoice.invoiceNumber }];
  const taxRatesById = await loadTaxRates(db, invoice.organizationId, invoice.lines.map((l) => l.taxRateId));
  const revenue = new Map();
  const tax = new Map();
  for (const l of invoice.lines) {
    const accountId = l.revenueAccountId || settings.revenueAccountId;
    if (!accountId) throw new LedgerError("No revenue account is configured in Finance settings.");
    const key = `${accountId}|${l.costCenterId || ""}|${l.projectId || invoice.projectId || ""}`;
    revenue.set(key, (revenue.get(key) || toMoney(0)).plus(toMoney(l.lineSubtotal)));
    if (toMoney(l.taxAmount).greaterThan(0)) {
      const taxAccount = (l.taxRateId && taxRatesById.get(l.taxRateId)?.salesAccountId) || settings.taxPayableAccountId;
      if (!taxAccount) throw new LedgerError("No Tax Payable account is configured in Finance settings.");
      tax.set(taxAccount, (tax.get(taxAccount) || toMoney(0)).plus(toMoney(l.taxAmount)));
    }
  }
  for (const [key, amount] of revenue) {
    const [accountId, costCenterId, projectId] = key.split("|");
    lines.push({ accountId, credit: amount.toFixed(2), costCenterId: costCenterId || null, projectId: projectId || null, companyId: invoice.companyId, description: `${invoice.invoiceNumber} revenue` });
  }
  for (const [accountId, amount] of tax) lines.push({ accountId, credit: amount.toFixed(2), description: `${invoice.invoiceNumber} tax` });
  return lines;
}

export async function post(req, res) {
  const existing = await loadInvoice(req, res);
  if (!existing) return;
  if (staleVersion(req.body, existing)) return versionConflict(res, "invoice");
  if (existing.status !== "Approved") return badTransition(res, "Only an approved invoice can be posted.");
  if (!existing.lines.length) return badTransition(res, "This invoice has no line snapshots; recreate it.");
  const settings = await getSettings(prisma, req.organizationId);
  let journal;
  try {
    journal = await prisma.$transaction(async (tx) => {
      const entryDate = parseDay(req.body.postingDate || existing.issueDate, "postingDate");
      const entry = await postSystemJournal(tx, {
        organizationId: req.organizationId, settings, entryDate, description: `Invoice ${existing.invoiceNumber}${existing.company ? ` — ${existing.company.name}` : ""}`,
        sourceType: "Invoice", sourceId: existing.id, reference: existing.invoiceNumber, currency: existing.currency, lines: await invoiceJournalLines(tx, existing, settings),
        membershipId: who(req), canPostSoftClosed: canPostSoftClosed(req),
      });
      const updated = await tx.invoice.updateMany({ where: { id: existing.id, version: existing.version, status: "Approved" }, data: { status: "Posted", postedByMembershipId: who(req), postedAt: new Date(), journalEntryId: entry.id, exchangeRate: entry.exchangeRate, version: { increment: 1 } } });
      if (updated.count !== 1) throw new LedgerError("This invoice was changed by someone else. Refresh and try again.", { status: 409, code: "FINANCE_VERSION_CONFLICT" });
      return entry;
    });
  } catch (err) {
    if (err instanceof LedgerError || err instanceof RangeError) return err instanceof LedgerError ? sendLedgerError(res, err) : invalid(res, err.message);
    throw err;
  }
  await audit(req, "finance.invoice.posted", "Invoice", existing.id, { after: { journalEntryId: journal.id, entryNumber: journal.entryNumber } });
  return saved(res, existing.id, 200, { journalEntryNumber: journal.entryNumber });
}

// Marks a posted invoice as sent to the customer. No email is sent.
export async function send(req, res) {
  const existing = await loadInvoice(req, res);
  if (!existing) return;
  if (existing.status === "Approved") return badTransition(res, "Post the invoice to the ledger before marking it as sent.");
  if (existing.status !== "Posted") return badTransition(res, "Only a posted invoice can be marked as sent.");
  return move(req, res, existing, ["Posted"], { status: "Sent", sentAt: new Date() }, "finance.invoice.sent");
}

export async function dispute(req, res) {
  const existing = await loadInvoice(req, res);
  if (!existing) return;
  if (!UNPAID.includes(existing.status)) return badTransition(res, "Only a posted, unpaid invoice can be disputed.");
  const reason = text(req.body.reason, 500);
  if (!reason) return invalid(res, "A dispute needs a reason.");
  return move(req, res, existing, UNPAID, { status: "Disputed", disputeReason: reason }, "finance.invoice.disputed", { reason });
}

export async function resolveDispute(req, res) {
  const existing = await loadInvoice(req, res);
  if (!existing) return;
  if (existing.status !== "Disputed") return badTransition(res, "This invoice isn't disputed.");
  const status = toMoney(existing.amountPaid).greaterThan(0) || toMoney(existing.amountCredited).greaterThan(0) ? "Partially Paid" : existing.sentAt ? "Sent" : "Posted";
  return move(req, res, existing, ["Disputed"], { status, disputeReason: null }, "finance.invoice.dispute_resolved", { reason: text(req.body.reason, 500) || null });
}

// Voiding cancels an invoice outright — not possible once money has been
// received or credit given (a credit note is the way to reduce it). A
// posted invoice's journal is reversed in the same transaction.
export async function voidInvoice(req, res) {
  const reason = text(req.body.reason, 500);
  if (!reason) return invalid(res, "A reason is required to void an invoice.");
  const existing = await loadInvoice(req, res);
  if (!existing) return;
  if (["Void", "Written Off"].includes(existing.status)) return badTransition(res, `This invoice is already ${existing.status.toLowerCase()}.`);
  if (toMoney(existing.amountPaid).greaterThan(0) || toMoney(existing.amountCredited).greaterThan(0)) return badTransition(res, "An invoice with payments or credits can't be voided — issue a credit note instead.");
  const pending = await prisma.paymentAllocation.count({ where: { invoiceId: existing.id, status: { in: ["Pending", "Active"] } } });
  if (pending) return badTransition(res, "Payments are allocated to this invoice; cancel or reverse them first.");
  try {
    await prisma.$transaction(async (tx) => {
      if (existing.journalEntryId) {
        const entry = await tx.journalEntry.findUnique({ where: { id: existing.journalEntryId }, include: { lines: true } });
        if (entry?.status === "Posted") await reverseJournal(tx, entry, { membershipId: who(req), reason: `Invoice ${existing.invoiceNumber} voided: ${reason}`, canPostSoftClosed: canPostSoftClosed(req) });
      }
      const updated = await tx.invoice.updateMany({ where: { id: existing.id, version: existing.version }, data: { status: "Void", voidReason: reason, voidedAt: new Date(), voidedByMembershipId: who(req), amountDue: 0, updatedByMembershipId: who(req), version: { increment: 1 } } });
      if (updated.count !== 1) throw new LedgerError("This invoice was changed by someone else.", { status: 409, code: "FINANCE_VERSION_CONFLICT" });
    });
  } catch (err) {
    if (err instanceof LedgerError) return sendLedgerError(res, err);
    throw err;
  }
  await audit(req, "finance.invoice.voided", "Invoice", existing.id, { reason });
  await saved(res, existing.id);
}

// Writes off what's still owed: Dr the chosen expense account (bad debt) /
// Cr Accounts Receivable. A person chooses; nothing is written off
// automatically.
export async function writeOff(req, res) {
  const existing = await loadInvoice(req, res);
  if (!existing) return;
  if (![...UNPAID, "Disputed"].includes(existing.status) || !existing.journalEntryId) return badTransition(res, "Only a posted invoice with an amount due can be written off.");
  const reason = text(req.body.reason, 500);
  if (!reason) return invalid(res, "A write-off needs a reason.");
  const account = await prisma.ledgerAccount.findFirst({ where: { id: req.body.expenseAccountId, organizationId: req.organizationId, type: "Expense", postingAllowed: true, archivedAt: null } });
  if (!account) return invalid(res, "expenseAccountId must be an active expense account (for example Bad Debts).");
  const settings = await getSettings(prisma, req.organizationId);
  const amount = toMoney(existing.amountDue);
  try {
    await prisma.$transaction(async (tx) => {
      await postSystemJournal(tx, {
        organizationId: req.organizationId, settings, entryDate: parseDay(req.body.date || new Date()), description: `Write-off of ${existing.invoiceNumber}: ${reason}`.slice(0, 500),
        sourceType: "Adjustment", sourceId: existing.id, reference: existing.invoiceNumber, currency: existing.currency, membershipId: who(req), canPostSoftClosed: canPostSoftClosed(req),
        lines: [{ accountId: account.id, debit: amount.toFixed(2), companyId: existing.companyId }, { accountId: settings.receivableAccountId, credit: amount.toFixed(2), companyId: existing.companyId }],
      });
      const updated = await tx.invoice.updateMany({ where: { id: existing.id, version: existing.version }, data: { status: "Written Off", writtenOffAt: new Date(), amountDue: 0, version: { increment: 1 } } });
      if (updated.count !== 1) throw new LedgerError("This invoice was changed by someone else.", { status: 409, code: "FINANCE_VERSION_CONFLICT" });
    });
  } catch (err) {
    if (err instanceof LedgerError) return sendLedgerError(res, err);
    throw err;
  }
  await audit(req, "finance.invoice.written_off", "Invoice", existing.id, { reason, after: { amount: amount.toFixed(2) } });
  await saved(res, existing.id);
}

export { PAYMENT_LABEL };

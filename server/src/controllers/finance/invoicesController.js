import prisma from "../../lib/prisma.js";
import { toApi } from "../../utils/serialize.js";
import { recordAuditEvent, requestContext } from "../../services/auditService.js";
import { broadestScope } from "../../services/crm/scopeService.js";
import { nextDocumentNumber } from "../../services/sales/documentNumberService.js";
import { toMoney, round, add } from "../../services/sales/moneyService.js";
import { createDraftInvoice } from "../../services/finance/invoiceService.js";
import {
  computeInvoice, amountDueFor, settledStatus, displayStatus, APPROVAL_THRESHOLD, PAYABLE_STATUSES,
} from "../../services/finance/financeRulesService.js";

const MAX_PAGE_SIZE = 100;
const invalid = (res, message) => res.status(400).json({ code: "FINANCE_VALIDATION_FAILED", message });
const badTransition = (res, message) => res.status(400).json({ code: "FINANCE_INVALID_TRANSITION", message });

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

const scopeWhere = (req) => financeScopeWhere(req, "invoices", "createdByMembership", "createdByMembershipId");

const INCLUDE = {
  company: { select: { id: true, name: true } },
  payments: { orderBy: { date: "asc" } },
  creditNotes: { orderBy: { createdAt: "asc" } },
};

export const serializeInvoice = (invoice) => ({ ...toApi(invoice), status: displayStatus(invoice) });

async function loadInvoice(req, res, id = req.params.invoiceId) {
  const invoice = await prisma.invoice.findFirst({ where: { id, organizationId: req.organizationId, ...scopeWhere(req) }, include: INCLUDE });
  if (!invoice) res.status(404).json({ code: "FINANCE_RECORD_NOT_FOUND", message: "Invoice not found." });
  return invoice;
}

async function audit(req, action, invoiceId, extra = {}) {
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action, targetType: "Invoice", targetId: invoiceId, result: "Success", ...extra });
}

async function saved(res, invoiceId, status = 200) {
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId }, include: INCLUDE });
  res.status(status).json({ invoice: serializeInvoice(invoice) });
}

function parseDate(value, field) {
  if (value === undefined || value === null || value === "") return { value: null };
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? { error: `${field} must be a valid date.` } : { value: d };
}

async function validateRefs(organizationId, { companyId, dealId }) {
  if (companyId && !(await prisma.company.findFirst({ where: { id: companyId, organizationId } }))) return "companyId";
  if (dealId) {
    const deal = await prisma.deal.findFirst({ where: { id: dealId, organizationId } });
    if (!deal) return "dealId";
    if (companyId && deal.companyId && deal.companyId !== companyId) return "dealId (belongs to a different company)";
  }
  return null;
}

export async function list(req, res) {
  const q = req.query;
  const page = Math.max(1, Number(q.page) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(q.pageSize) || 25));
  const where = { organizationId: req.organizationId, ...scopeWhere(req) };
  if (q.companyId) where.companyId = q.companyId;
  if (q.orderId) where.orderId = q.orderId;
  if (q.status === "Overdue") Object.assign(where, { status: { in: PAYABLE_STATUSES }, dueDate: { lt: new Date() } });
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
  const { companyId = null, dealId = null, items, currency = "USD" } = req.body;
  const due = parseDate(req.body.dueDate, "dueDate");
  if (due.error) return invalid(res, due.error);
  const refError = await validateRefs(req.organizationId, { companyId, dealId });
  if (refError) return res.status(400).json({ code: "FINANCE_REFERENCE_INVALID", message: `${refError} must reference a record in this organization.` });
  let invoice;
  try {
    invoice = await prisma.$transaction((tx) => createDraftInvoice(tx, {
      organizationId: req.organizationId, membershipId: req.membership?.id, companyId, dealId, lines: items, currency, dueDate: due.value,
    }));
  } catch (err) {
    if (err instanceof RangeError) return invalid(res, err.message);
    throw err;
  }
  await audit(req, "finance.invoice.created", invoice.id);
  await saved(res, invoice.id, 201);
}

// Only a Draft can be edited; totals are recomputed from the lines.
export async function update(req, res) {
  const existing = await loadInvoice(req, res);
  if (!existing) return;
  if (existing.status !== "Draft") return badTransition(res, "Only a draft invoice can be edited.");
  if (req.body.version !== undefined && Number(req.body.version) !== existing.version) {
    return res.status(409).json({ code: "FINANCE_VERSION_CONFLICT", message: "This invoice was updated by someone else. Refresh and try again." });
  }
  const data = {};
  if ("companyId" in req.body) data.companyId = req.body.companyId || null;
  if ("dueDate" in req.body) {
    const due = parseDate(req.body.dueDate, "dueDate");
    if (due.error) return invalid(res, due.error);
    data.dueDate = due.value;
  }
  const refError = await validateRefs(req.organizationId, { companyId: "companyId" in data ? data.companyId : existing.companyId, dealId: existing.dealId });
  if (refError) return res.status(400).json({ code: "FINANCE_REFERENCE_INVALID", message: `${refError} must reference a record in this organization.` });
  if ("items" in req.body) {
    try {
      const totals = computeInvoice(req.body.items, existing.currency);
      Object.assign(data, totals, { amountDue: totals.total });
    } catch (err) {
      if (err instanceof RangeError) return invalid(res, err.message);
      throw err;
    }
  }
  await prisma.invoice.update({ where: { id: existing.id }, data: { ...data, updatedByMembershipId: req.membership?.id || null, version: { increment: 1 } } });
  await audit(req, "finance.invoice.updated", existing.id);
  await saved(res, existing.id);
}

// Draft → Approved. At or above APPROVAL_THRESHOLD the approver must not be
// the invoice's creator (separation of duties).
export async function approve(req, res) {
  const existing = await loadInvoice(req, res);
  if (!existing) return;
  if (existing.status !== "Draft") return badTransition(res, "Only a draft invoice can be approved.");
  if (toMoney(existing.total).greaterThanOrEqualTo(APPROVAL_THRESHOLD) && req.membership?.id && existing.createdByMembershipId === req.membership.id) {
    return res.status(403).json({ code: "FINANCE_SEPARATION_OF_DUTIES", message: `Invoices of ${APPROVAL_THRESHOLD.toLocaleString()} or more must be approved by someone other than their creator.` });
  }
  await prisma.invoice.update({
    where: { id: existing.id },
    data: { status: "Approved", approvedAt: new Date(), approvedByMembershipId: req.membership?.id || null, updatedByMembershipId: req.membership?.id || null, version: { increment: 1 } },
  });
  await audit(req, "finance.invoice.approved", existing.id);
  await saved(res, existing.id);
}

export async function send(req, res) {
  const existing = await loadInvoice(req, res);
  if (!existing) return;
  if (existing.status !== "Approved") return badTransition(res, "Only an approved invoice can be sent.");
  await prisma.invoice.update({ where: { id: existing.id }, data: { status: "Sent", sentAt: new Date(), updatedByMembershipId: req.membership?.id || null, version: { increment: 1 } } });
  await audit(req, "finance.invoice.sent", existing.id);
  await saved(res, existing.id);
}

// Voiding cancels an invoice outright — not possible once money has been
// received (a credit note is the way to reduce a paid invoice).
export async function voidInvoice(req, res) {
  const reason = req.body.reason?.trim();
  if (!reason) return invalid(res, "A reason is required to void an invoice.");
  const existing = await loadInvoice(req, res);
  if (!existing) return;
  if (existing.status === "Void") return badTransition(res, "This invoice is already void.");
  if (toMoney(existing.amountPaid).greaterThan(0)) return badTransition(res, "An invoice with payments can't be voided — issue a credit note instead.");
  await prisma.invoice.update({
    where: { id: existing.id },
    data: { status: "Void", voidReason: reason, voidedAt: new Date(), voidedByMembershipId: req.membership?.id || null, amountDue: 0, updatedByMembershipId: req.membership?.id || null, version: { increment: 1 } },
  });
  await audit(req, "finance.invoice.voided", existing.id, { reason });
  await saved(res, existing.id);
}

export async function recordPayment(req, res) {
  const existing = await loadInvoice(req, res);
  if (!existing) return;
  if (!PAYABLE_STATUSES.includes(existing.status)) return badTransition(res, "Payments can only be recorded against a sent invoice that isn't fully paid.");
  const amount = Number(req.body.amount);
  if (!Number.isFinite(amount) || amount <= 0) return invalid(res, "Enter a payment amount greater than 0.");
  const money = round(amount, existing.currency);
  if (money.greaterThan(toMoney(existing.amountDue))) return invalid(res, `The payment is more than the ${toMoney(existing.amountDue).toFixed(2)} still due.`);
  const method = typeof req.body.method === "string" && req.body.method.trim() ? req.body.method.trim().slice(0, 50) : "Bank Transfer";
  const paidOn = parseDate(req.body.date, "date");
  if (paidOn.error) return invalid(res, paidOn.error);
  if (paidOn.value && paidOn.value > new Date()) return invalid(res, "A payment date can't be in the future.");

  const amountPaid = round(add(existing.amountPaid, money), existing.currency);
  const amountDue = amountDueFor({ total: existing.total, amountPaid, amountCredited: existing.amountCredited }, existing.currency);
  const status = settledStatus(existing, { amountPaid, amountDue });
  await prisma.$transaction([
    prisma.payment.create({
      data: {
        invoiceId: existing.id, organizationId: req.organizationId, amount: money, method, date: paidOn.value || new Date(),
        reference: req.body.reference?.trim() || null, note: req.body.note?.trim() || null, recordedByMembershipId: req.membership?.id || null,
      },
    }),
    prisma.invoice.update({
      where: { id: existing.id },
      data: { amountPaid, amountDue, status, ...(status === "Paid" && { paidAt: new Date() }), updatedByMembershipId: req.membership?.id || null, version: { increment: 1 } },
    }),
  ]);
  await audit(req, "finance.invoice.payment_recorded", existing.id, { after: { amount: Number(money), method, status } });
  await saved(res, existing.id);
}

// POST /finance/credit-notes { invoiceId, amount, reason } → { creditNote, invoice }
export async function issueCreditNote(req, res) {
  const reason = req.body.reason?.trim();
  if (!reason) return invalid(res, "A reason is required for a credit note.");
  const existing = await loadInvoice(req, res, req.body.invoiceId);
  if (!existing) return;
  if (!["Sent", "Partially Paid", "Paid"].includes(existing.status)) return badTransition(res, "Credit notes can only be issued against a sent invoice.");
  const amount = Number(req.body.amount);
  if (!Number.isFinite(amount) || amount <= 0) return invalid(res, "Enter a credit amount greater than 0.");
  const money = round(amount, existing.currency);
  const creditable = toMoney(existing.total).minus(toMoney(existing.amountCredited));
  if (money.greaterThan(creditable)) return invalid(res, `The credit is more than the ${creditable.toFixed(2)} left to credit on this invoice.`);

  const amountCredited = round(add(existing.amountCredited, money), existing.currency);
  const amountDue = amountDueFor({ total: existing.total, amountPaid: existing.amountPaid, amountCredited }, existing.currency);
  const status = settledStatus(existing, { amountPaid: existing.amountPaid, amountDue });
  const creditNote = await prisma.$transaction(async (tx) => {
    const creditNoteNumber = await nextDocumentNumber(tx, req.organizationId, "CreditNote");
    const note = await tx.creditNote.create({
      data: {
        organizationId: req.organizationId, creditNoteNumber, invoiceId: existing.id, companyName: existing.company?.name || null,
        amount: money, currency: existing.currency, reason, issuedByMembershipId: req.membership?.id || null,
      },
    });
    await tx.invoice.update({
      where: { id: existing.id },
      data: { amountCredited, amountDue, status, ...(status === "Paid" && !existing.paidAt && { paidAt: new Date() }), updatedByMembershipId: req.membership?.id || null, version: { increment: 1 } },
    });
    return note;
  });
  await audit(req, "finance.invoice.credit_note_issued", existing.id, { reason, after: { creditNoteId: creditNote.id, amount: Number(money) } });
  const invoice = await prisma.invoice.findUnique({ where: { id: existing.id }, include: INCLUDE });
  res.status(201).json({ creditNote: toApi(creditNote), invoice: serializeInvoice(invoice) });
}

export async function listCreditNotes(req, res) {
  const creditNotes = await prisma.creditNote.findMany({
    where: { organizationId: req.organizationId, invoice: scopeWhere(req) },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  res.json({ creditNotes: toApi(creditNotes) });
}

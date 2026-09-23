import prisma from "../../lib/prisma.js";
import { toApi } from "../../utils/serialize.js";
import { recordAuditEvent, requestContext } from "../../services/auditService.js";
import { createDraftInvoice } from "../../services/finance/invoiceService.js";
import { computeInvoice, RECURRING_INTERVALS, DEFAULT_DUE_DAYS } from "../../services/finance/financeRulesService.js";
import { financeScopeWhere, serializeInvoice } from "./invoicesController.js";

const invalid = (res, message) => res.status(400).json({ code: "FINANCE_VALIDATION_FAILED", message });
const scopeWhere = (req) => financeScopeWhere(req, "recurring_invoices", "createdByMembership", "createdByMembershipId");

const INCLUDE = { company: { select: { id: true, name: true } } };
const serialize = (r) => ({ ...toApi(r), companyName: r.company?.name || "" });

async function audit(req, action, id, extra = {}) {
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action, targetType: "RecurringInvoice", targetId: id, result: "Success", ...extra });
}

// The template's lines are validated (and normalized) exactly as an
// invoice's would be, so generating from it can't fail later.
function validLines(items, currency, res) {
  try {
    return computeInvoice(items, currency).items.map(({ name, qty, unitPrice, taxCategory }) => ({ name, qty, unitPrice, taxCategory }));
  } catch (err) {
    if (err instanceof RangeError) { invalid(res, err.message); return null; }
    throw err;
  }
}

async function load(req, res) {
  const r = await prisma.recurringInvoice.findFirst({ where: { id: req.params.recurringId, organizationId: req.organizationId, ...scopeWhere(req) }, include: INCLUDE });
  if (!r) res.status(404).json({ code: "FINANCE_RECORD_NOT_FOUND", message: "Recurring invoice not found." });
  return r;
}

export async function list(req, res) {
  const recurringInvoices = await prisma.recurringInvoice.findMany({ where: { organizationId: req.organizationId, ...scopeWhere(req) }, include: INCLUDE, orderBy: { createdAt: "desc" }, take: 500 });
  res.json({ recurringInvoices: recurringInvoices.map(serialize) });
}

export async function create(req, res) {
  const { companyId, interval = "Monthly", currency = "USD" } = req.body;
  if (!companyId) return invalid(res, "A company is required.");
  if (!(await prisma.company.findFirst({ where: { id: companyId, organizationId: req.organizationId } }))) {
    return res.status(400).json({ code: "FINANCE_REFERENCE_INVALID", message: "companyId must reference a company in this organization." });
  }
  if (!RECURRING_INTERVALS.includes(interval)) return invalid(res, `interval must be one of ${RECURRING_INTERVALS.join(", ")}.`);
  const dueDays = req.body.dueDays === undefined ? DEFAULT_DUE_DAYS : Number(req.body.dueDays);
  if (!Number.isInteger(dueDays) || dueDays < 0 || dueDays > 365) return invalid(res, "dueDays must be a whole number from 0 to 365.");
  const items = validLines(req.body.items, currency, res);
  if (!items) return;
  const r = await prisma.recurringInvoice.create({
    data: { organizationId: req.organizationId, companyId, interval, currency, dueDays, items, active: true, createdByMembershipId: req.membership?.id || null, updatedByMembershipId: req.membership?.id || null },
    include: INCLUDE,
  });
  await audit(req, "finance.recurring_invoice.created", r.id);
  res.status(201).json({ recurringInvoice: serialize(r) });
}

// Pause/resume (`active`), or change the interval, lines or payment terms.
export async function update(req, res) {
  const existing = await load(req, res);
  if (!existing) return;
  const data = {};
  if ("active" in req.body) data.active = Boolean(req.body.active);
  if ("interval" in req.body) {
    if (!RECURRING_INTERVALS.includes(req.body.interval)) return invalid(res, `interval must be one of ${RECURRING_INTERVALS.join(", ")}.`);
    data.interval = req.body.interval;
  }
  if ("dueDays" in req.body) {
    const dueDays = Number(req.body.dueDays);
    if (!Number.isInteger(dueDays) || dueDays < 0 || dueDays > 365) return invalid(res, "dueDays must be a whole number from 0 to 365.");
    data.dueDays = dueDays;
  }
  if ("items" in req.body) {
    const items = validLines(req.body.items, existing.currency, res);
    if (!items) return;
    data.items = items;
  }
  const r = await prisma.recurringInvoice.update({ where: { id: existing.id }, data: { ...data, updatedByMembershipId: req.membership?.id || null, version: { increment: 1 } }, include: INCLUDE });
  await audit(req, "active" in data ? (data.active ? "finance.recurring_invoice.resumed" : "finance.recurring_invoice.paused") : "finance.recurring_invoice.updated", existing.id);
  res.json({ recurringInvoice: serialize(r) });
}

// Creates the next Draft invoice from an active template.
export async function generate(req, res) {
  const existing = await load(req, res);
  if (!existing) return;
  if (!existing.active) return res.status(400).json({ code: "FINANCE_INVALID_TRANSITION", message: "This recurring invoice is paused — resume it first." });
  const invoice = await prisma.$transaction(async (tx) => {
    const created = await createDraftInvoice(tx, {
      organizationId: req.organizationId, membershipId: req.membership?.id, companyId: existing.companyId, recurringInvoiceId: existing.id,
      source: "Recurring", lines: existing.items, currency: existing.currency, dueDays: existing.dueDays,
    });
    await tx.recurringInvoice.update({ where: { id: existing.id }, data: { lastGeneratedAt: new Date(), invoicesGenerated: { increment: 1 }, version: { increment: 1 } } });
    return created;
  });
  await audit(req, "finance.recurring_invoice.generated", existing.id, { after: { invoiceId: invoice.id } });
  const [recurringInvoice, full] = await Promise.all([
    prisma.recurringInvoice.findUnique({ where: { id: existing.id }, include: INCLUDE }),
    prisma.invoice.findUnique({ where: { id: invoice.id }, include: { company: { select: { id: true, name: true } }, payments: true, creditNotes: true } }),
  ]);
  res.status(201).json({ recurringInvoice: serialize(recurringInvoice), invoice: serializeInvoice(full) });
}

// Backend Phase 6 (full spec) — Vendors (a profile on a Phase 2 Company,
// not a copy) and vendor bills.
//
// Bills: Draft → Submitted → Approved → Posted → Partially Paid → Paid;
// Disputed; Void. "Overdue" is derived (posted, unpaid, past due). The
// creator can't approve their own bill. Posting creates a balanced journal
// (expense/asset lines and recoverable tax against Accounts Payable). The
// same vendor reference can't be entered twice for a vendor.
import prisma from "../../lib/prisma.js";
import { toApi } from "../../utils/serialize.js";
import { nextDocumentNumber } from "../../services/sales/documentNumberService.js";
import { toMoney } from "../../services/sales/moneyService.js";
import {
  invalid, notFound, badTransition, versionConflict, staleVersion, audit, isCurrency, parseDay, text, getSettings, checkSeparation,
} from "../../services/finance/financeCommon.js";
import { computeDocument, loadTaxRates } from "../../services/finance/documentMath.js";
import { LedgerError, sendLedgerError, postSystemJournal, reverseJournal, resolveRate } from "../../services/finance/ledgerService.js";
import { canPostSoftClosed } from "./ledgerSetupController.js";

const who = (req) => req.membership?.id || null;
const MAX_PAGE_SIZE = 100;
const BILL_INCLUDE = { lines: { orderBy: { lineNumber: "asc" } }, vendor: { include: { company: { select: { id: true, name: true } } } } };
export const BILL_STATUSES = ["Draft", "Submitted", "Approved", "Posted", "Partially Paid", "Paid", "Disputed", "Void"];
const PAYABLE = ["Posted", "Partially Paid"];

export function billDisplayStatus(bill, now = new Date()) {
  if (PAYABLE.includes(bill.status) && bill.dueDate && new Date(bill.dueDate) < now) return "Overdue";
  return bill.status;
}
const serializeBill = (bill) => ({ ...toApi(bill), displayStatus: billDisplayStatus(bill) });

// ---- Vendors --------------------------------------------------------------

export async function listVendors(req, res) {
  const where = { organizationId: req.organizationId, ...(req.query.includeArchived === "true" ? {} : { archivedAt: null }) };
  const vendors = await prisma.vendor.findMany({ where, include: { company: { select: { id: true, name: true } } }, orderBy: { vendorCode: "asc" }, take: 500 });
  res.json({ vendors: toApi(vendors) });
}

async function vendorFields(req, existing = null) {
  const b = req.body;
  const data = {};
  if (!existing) {
    const company = await prisma.company.findFirst({ where: { id: b.companyId, organizationId: req.organizationId } });
    if (!company) throw new RangeError("companyId must be a company in this organization.");
    data.companyId = company.id;
    data.vendorCode = text(b.vendorCode, 20);
    if (!/^[A-Za-z0-9][A-Za-z0-9.-]{0,19}$/.test(data.vendorCode)) throw new RangeError("vendorCode must be 1–20 letters, digits, dots or dashes.");
  }
  if ("paymentTermsDays" in b) {
    const days = Number(b.paymentTermsDays);
    if (!Number.isInteger(days) || days < 0 || days > 365) throw new RangeError("paymentTermsDays must be 0–365.");
    data.paymentTermsDays = days;
  }
  if ("currency" in b) { if (!isCurrency(b.currency)) throw new RangeError("currency must be an ISO 4217 code."); data.currency = b.currency; }
  if ("notes" in b) data.notes = text(b.notes, 2000) || null;
  if ("active" in b) data.active = b.active === true;
  for (const [field, model] of [["taxRateId", "taxRate"], ["defaultPayableAccountId", "ledgerAccount"], ["defaultExpenseAccountId", "ledgerAccount"]]) {
    if (!(field in b)) continue;
    if (b[field] && !(await prisma[model].findFirst({ where: { id: b[field], organizationId: req.organizationId } }))) throw new RangeError(`${field} must reference a record in this organization.`);
    data[field] = b[field] || null;
  }
  return data;
}

export async function createVendor(req, res) {
  let data;
  try { data = await vendorFields(req); } catch (err) { return invalid(res, err.message); }
  const clash = await prisma.vendor.findFirst({ where: { organizationId: req.organizationId, OR: [{ vendorCode: data.vendorCode }, { companyId: data.companyId }] } });
  if (clash) return invalid(res, clash.companyId === data.companyId ? "This company already has a vendor profile." : `Vendor code ${data.vendorCode} is already used.`);
  const vendor = await prisma.vendor.create({ data: { organizationId: req.organizationId, ...data }, include: { company: { select: { id: true, name: true } } } });
  await audit(req, "finance.vendor.created", "Vendor", vendor.id, { after: { vendorCode: vendor.vendorCode, companyId: vendor.companyId } });
  res.status(201).json({ vendor: toApi(vendor) });
}

export async function updateVendor(req, res) {
  const existing = await prisma.vendor.findFirst({ where: { id: req.params.vendorId, organizationId: req.organizationId } });
  if (!existing) return notFound(res, "Vendor");
  if (staleVersion(req.body, existing)) return versionConflict(res, "vendor");
  let data;
  try { data = await vendorFields(req, existing); } catch (err) { return invalid(res, err.message); }
  const vendor = await prisma.vendor.update({ where: { id: existing.id }, data: { ...data, version: { increment: 1 } }, include: { company: { select: { id: true, name: true } } } });
  await audit(req, "finance.vendor.updated", "Vendor", existing.id, { after: data });
  res.json({ vendor: toApi(vendor) });
}

// ---- Bills ----------------------------------------------------------------

async function loadBill(req, res) {
  const bill = await prisma.vendorBill.findFirst({ where: { id: req.params.billId, organizationId: req.organizationId }, include: BILL_INCLUDE });
  if (!bill) notFound(res, "Bill");
  return bill;
}

export async function listBills(req, res) {
  const q = req.query;
  const page = Math.max(1, Number(q.page) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(q.pageSize) || 25));
  const where = { organizationId: req.organizationId, archivedAt: null };
  if (q.status === "Overdue") Object.assign(where, { status: { in: PAYABLE }, dueDate: { lt: new Date() } });
  else if (q.status) where.status = q.status;
  if (q.vendorId) where.vendorId = q.vendorId;
  if (q.search) where.OR = [{ billNumber: { contains: q.search, mode: "insensitive" } }, { vendorReference: { contains: q.search, mode: "insensitive" } }];
  const [bills, total] = await Promise.all([
    prisma.vendorBill.findMany({ where, include: BILL_INCLUDE, orderBy: { billDate: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.vendorBill.count({ where }),
  ]);
  res.json({ bills: bills.map(serializeBill), total, page, pageSize });
}

export async function getBill(req, res) {
  const bill = await loadBill(req, res);
  if (bill) res.json({ bill: serializeBill(bill) });
}

// Validates a bill body and computes every amount server-side.
async function billInput(req, settings, existing = null) {
  const b = req.body;
  const vendor = await prisma.vendor.findFirst({ where: { id: b.vendorId ?? existing?.vendorId, organizationId: req.organizationId, archivedAt: null } });
  if (!vendor || !vendor.active) throw new RangeError("vendorId must be an active vendor in this organization.");
  const vendorReference = text(b.vendorReference ?? existing?.vendorReference, 80);
  if (!vendorReference) throw new RangeError("vendorReference (the vendor's own invoice number) is required.");
  const billDate = parseDay(b.billDate ?? existing?.billDate, "billDate");
  const dueDate = b.dueDate ? parseDay(b.dueDate, "dueDate") : existing?.dueDate && !("billDate" in b) ? existing.dueDate : new Date(billDate.getTime() + vendor.paymentTermsDays * 86400000);
  if (dueDate < billDate) throw new RangeError("dueDate can't be before billDate.");
  const currency = b.currency ?? existing?.currency ?? vendor.currency;
  if (!isCurrency(currency)) throw new RangeError("currency must be an ISO 4217 code.");
  const rawLines = b.lines ?? existing?.lines;
  const taxRatesById = await loadTaxRates(prisma, req.organizationId, (rawLines || []).map((l) => l?.taxRateId));
  const doc = computeDocument((rawLines || []).map((l) => ({ ...l, accountId: l.accountId || vendor.defaultExpenseAccountId })), { currency, taxRatesById, kind: "Purchase" });
  for (const line of doc.lines) {
    if (!line.accountId) throw new RangeError(`Line ${line.lineNumber} needs an accountId.`);
    const account = await prisma.ledgerAccount.findFirst({ where: { id: line.accountId, organizationId: req.organizationId, archivedAt: null, postingAllowed: true } });
    if (!account || !["Expense", "Asset"].includes(account.type)) throw new RangeError(`Line ${line.lineNumber}: the account must be an active, postable expense or asset account.`);
  }
  const { rate } = await resolveRate(prisma, req.organizationId, currency, settings.baseCurrency, billDate);
  return {
    vendor, vendorReference, billDate, dueDate, currency, doc, exchangeRate: rate, taxRatesById,
    payableAccountId: b.payableAccountId || existing?.payableAccountId || vendor.defaultPayableAccountId || settings.payableAccountId || null,
    description: text(b.description ?? existing?.description, 1000) || null,
    costCenterId: b.costCenterId ?? existing?.costCenterId ?? null, projectId: b.projectId ?? existing?.projectId ?? null,
  };
}

const lineData = (organizationId, doc) => doc.lines.map((l) => ({
  organizationId, lineNumber: l.lineNumber, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, accountId: l.accountId,
  costCenterId: l.costCenterId, projectId: l.projectId, taxRateId: l.taxRateId, taxSnapshot: l.taxSnapshot ?? undefined,
  lineSubtotal: l.lineSubtotal, taxAmount: l.taxAmount, lineTotal: l.lineTotal,
}));

const isDuplicate = (err) => err?.code === "P2002";
const duplicate = (res) => res.status(409).json({ code: "FINANCE_DUPLICATE_BILL", message: "This vendor already has a bill with that vendor reference." });

export async function createBill(req, res) {
  const settings = await getSettings(prisma, req.organizationId);
  let input;
  try { input = await billInput(req, settings); } catch (err) { return err instanceof RangeError || err instanceof LedgerError ? invalid(res, err.message) : Promise.reject(err); }
  let bill;
  try {
    bill = await prisma.$transaction(async (tx) => {
      const billNumber = await nextDocumentNumber(tx, req.organizationId, "VendorBill");
      return tx.vendorBill.create({
        data: {
          organizationId: req.organizationId, billNumber, vendorId: input.vendor.id, vendorReference: input.vendorReference, billDate: input.billDate, dueDate: input.dueDate,
          currency: input.currency, exchangeRate: input.exchangeRate, paymentTermsDays: input.vendor.paymentTermsDays, subtotal: input.doc.subtotal, tax: input.doc.tax,
          total: input.doc.total, amountDue: input.doc.total, payableAccountId: input.payableAccountId, description: input.description, costCenterId: input.costCenterId,
          projectId: input.projectId, createdByMembershipId: who(req), lines: { create: lineData(req.organizationId, input.doc) },
        },
      });
    });
  } catch (err) {
    if (isDuplicate(err)) return duplicate(res);
    throw err;
  }
  await audit(req, "finance.bill.created", "VendorBill", bill.id, { after: { billNumber: bill.billNumber, total: input.doc.total.toFixed(2), currency: input.currency } });
  res.status(201).json({ bill: serializeBill(await prisma.vendorBill.findUnique({ where: { id: bill.id }, include: BILL_INCLUDE })) });
}

export async function updateBill(req, res) {
  const bill = await loadBill(req, res);
  if (!bill) return;
  if (bill.status !== "Draft") return badTransition(res, "Only a draft bill can be edited.");
  if (staleVersion(req.body, bill)) return versionConflict(res, "bill");
  const settings = await getSettings(prisma, req.organizationId);
  let input;
  try { input = await billInput(req, settings, { ...bill, lines: bill.lines.map((l) => ({ ...l, quantity: String(l.quantity), unitPrice: String(l.unitPrice) })) }); } catch (err) { return err instanceof RangeError || err instanceof LedgerError ? invalid(res, err.message) : Promise.reject(err); }
  let ok;
  try {
    ok = await prisma.$transaction(async (tx) => {
      const updated = await tx.vendorBill.updateMany({
        where: { id: bill.id, version: bill.version, status: "Draft" },
        data: {
          vendorId: input.vendor.id, vendorReference: input.vendorReference, billDate: input.billDate, dueDate: input.dueDate, currency: input.currency, exchangeRate: input.exchangeRate,
          subtotal: input.doc.subtotal, tax: input.doc.tax, total: input.doc.total, amountDue: input.doc.total, payableAccountId: input.payableAccountId,
          description: input.description, costCenterId: input.costCenterId, projectId: input.projectId, version: { increment: 1 },
        },
      });
      if (updated.count !== 1) return false;
      await tx.vendorBillLine.deleteMany({ where: { billId: bill.id } });
      await tx.vendorBillLine.createMany({ data: lineData(req.organizationId, input.doc).map((l) => ({ ...l, billId: bill.id })) });
      return true;
    });
  } catch (err) {
    if (isDuplicate(err)) return duplicate(res);
    throw err;
  }
  if (!ok) return versionConflict(res, "bill");
  await audit(req, "finance.bill.updated", "VendorBill", bill.id);
  res.json({ bill: serializeBill(await prisma.vendorBill.findUnique({ where: { id: bill.id }, include: BILL_INCLUDE })) });
}

async function move(req, res, bill, from, data, action, extra = {}) {
  const updated = await prisma.vendorBill.updateMany({ where: { id: bill.id, version: bill.version, status: { in: from } }, data: { ...data, version: { increment: 1 } } });
  if (updated.count !== 1) return versionConflict(res, "bill");
  await audit(req, action, "VendorBill", bill.id, { before: { status: bill.status }, after: { status: data.status }, ...extra });
  res.json({ bill: serializeBill(await prisma.vendorBill.findUnique({ where: { id: bill.id }, include: BILL_INCLUDE })) });
}

export async function submitBill(req, res) {
  const bill = await loadBill(req, res);
  if (!bill) return;
  if (bill.status !== "Draft") return badTransition(res, `A ${bill.status.toLowerCase()} bill can't be submitted.`);
  return move(req, res, bill, ["Draft"], { status: "Submitted", submittedByMembershipId: who(req), submittedAt: new Date() }, "finance.bill.submitted");
}

export async function approveBill(req, res) {
  const bill = await loadBill(req, res);
  if (!bill) return;
  if (staleVersion(req.body, bill)) return versionConflict(res, "bill");
  if (bill.status !== "Submitted") return badTransition(res, "Only a submitted bill can be approved.");
  const settings = await getSettings(prisma, req.organizationId);
  if (!(await checkSeparation(req, res, { settings, sameActor: bill.createdByMembershipId === who(req), rule: "The person who entered a bill can't approve it.", action: "bill.approve", targetType: "VendorBill", targetId: bill.id }))) return;
  return move(req, res, bill, ["Submitted"], { status: "Approved", approvedByMembershipId: who(req), approvedAt: new Date() }, "finance.bill.approved");
}

// Dr each line's account (plus non-recoverable tax), Dr recoverable tax,
// Cr Accounts Payable for the total.
export async function billJournalLines(db, bill, settings) {
  const payable = bill.payableAccountId || settings.payableAccountId;
  if (!payable) throw new LedgerError("No Accounts Payable account is configured in Finance settings.");
  const taxRatesById = await loadTaxRates(db, bill.organizationId, bill.lines.map((l) => l.taxRateId));
  const lines = [];
  const taxByAccount = new Map();
  for (const l of bill.lines) {
    const recoverable = l.taxSnapshot?.recoverable && toMoney(l.taxAmount).greaterThan(0);
    const amount = recoverable ? toMoney(l.lineSubtotal) : toMoney(l.lineTotal);
    lines.push({ accountId: l.accountId, debit: amount.toFixed(2), costCenterId: l.costCenterId || bill.costCenterId, projectId: l.projectId || bill.projectId, description: l.description, companyId: bill.vendor?.companyId || null });
    if (recoverable) {
      const account = taxRatesById.get(l.taxRateId)?.purchaseAccountId || settings.taxRecoverableAccountId;
      if (!account) throw new LedgerError(`No Tax Recoverable account is configured for ${l.taxSnapshot.code}.`);
      taxByAccount.set(account, (taxByAccount.get(account) || toMoney(0)).plus(toMoney(l.taxAmount)));
    }
  }
  for (const [accountId, amount] of taxByAccount) lines.push({ accountId, debit: amount.toFixed(2), description: "Recoverable tax" });
  lines.push({ accountId: payable, credit: toMoney(bill.total).toFixed(2), companyId: bill.vendor?.companyId || null, description: `${bill.billNumber} ${bill.vendorReference}` });
  return lines;
}

export async function postBill(req, res) {
  const bill = await loadBill(req, res);
  if (!bill) return;
  if (staleVersion(req.body, bill)) return versionConflict(res, "bill");
  if (bill.status !== "Approved") return badTransition(res, "Only an approved bill can be posted.");
  const settings = await getSettings(prisma, req.organizationId);
  let journal;
  try {
    journal = await prisma.$transaction(async (tx) => {
      const entry = await postSystemJournal(tx, {
        organizationId: req.organizationId, settings, entryDate: bill.billDate, description: `Bill ${bill.billNumber} from ${bill.vendor.company?.name || bill.vendor.vendorCode} (${bill.vendorReference})`.slice(0, 500),
        sourceType: "Bill", sourceId: bill.id, reference: bill.billNumber, currency: bill.currency, lines: await billJournalLines(tx, bill, settings), membershipId: who(req), canPostSoftClosed: canPostSoftClosed(req),
      });
      const updated = await tx.vendorBill.updateMany({ where: { id: bill.id, version: bill.version, status: "Approved" }, data: { status: "Posted", postedByMembershipId: who(req), postedAt: new Date(), journalEntryId: entry.id, version: { increment: 1 } } });
      if (updated.count !== 1) throw new LedgerError("This bill was changed by someone else. Refresh and try again.", { status: 409, code: "FINANCE_VERSION_CONFLICT" });
      return entry;
    });
  } catch (err) {
    if (err instanceof LedgerError) return sendLedgerError(res, err);
    throw err;
  }
  await audit(req, "finance.bill.posted", "VendorBill", bill.id, { after: { journalEntryId: journal.id, entryNumber: journal.entryNumber } });
  res.json({ bill: serializeBill(await prisma.vendorBill.findUnique({ where: { id: bill.id }, include: BILL_INCLUDE })), journalEntryNumber: journal.entryNumber });
}

export async function disputeBill(req, res) {
  const bill = await loadBill(req, res);
  if (!bill) return;
  if (!PAYABLE.includes(bill.status)) return badTransition(res, "Only a posted, unpaid bill can be disputed.");
  const reason = text(req.body.reason, 500);
  if (!reason) return invalid(res, "A dispute needs a reason.");
  return move(req, res, bill, PAYABLE, { status: "Disputed", disputeReason: reason }, "finance.bill.disputed", { reason });
}

export async function resolveDispute(req, res) {
  const bill = await loadBill(req, res);
  if (!bill) return;
  if (bill.status !== "Disputed") return badTransition(res, "This bill isn't disputed.");
  const status = toMoney(bill.amountPaid).greaterThan(0) ? "Partially Paid" : "Posted";
  return move(req, res, bill, ["Disputed"], { status, disputeReason: null }, "finance.bill.dispute_resolved", { reason: text(req.body.reason, 500) || null });
}

// Before posting: just Void. After posting (no payments allocated): the
// journal is reversed in the same transaction, then Void.
export async function voidBill(req, res) {
  const bill = await loadBill(req, res);
  if (!bill) return;
  if (staleVersion(req.body, bill)) return versionConflict(res, "bill");
  const reason = text(req.body.reason, 500);
  if (!reason) return invalid(res, "Voiding a bill needs a reason.");
  if (["Void", "Paid", "Partially Paid"].includes(bill.status)) return badTransition(res, bill.status === "Void" ? "This bill is already void." : "A bill with payments can't be voided; reverse the payments first.");
  const activeAllocations = await prisma.paymentAllocation.count({ where: { billId: bill.id, status: "Active" } });
  if (activeAllocations) return badTransition(res, "Reverse the payments allocated to this bill first.");
  try {
    await prisma.$transaction(async (tx) => {
      if (bill.journalEntryId) {
        const entry = await tx.journalEntry.findUnique({ where: { id: bill.journalEntryId }, include: { lines: true } });
        if (entry?.status === "Posted") await reverseJournal(tx, entry, { membershipId: who(req), reason: `Bill ${bill.billNumber} voided: ${reason}`, canPostSoftClosed: canPostSoftClosed(req) });
      }
      const updated = await tx.vendorBill.updateMany({ where: { id: bill.id, version: bill.version }, data: { status: "Void", voidReason: reason, voidedAt: new Date(), amountDue: 0, version: { increment: 1 } } });
      if (updated.count !== 1) throw new LedgerError("This bill was changed by someone else.", { status: 409, code: "FINANCE_VERSION_CONFLICT" });
    });
  } catch (err) {
    if (err instanceof LedgerError) return sendLedgerError(res, err);
    throw err;
  }
  await audit(req, "finance.bill.voided", "VendorBill", bill.id, { reason });
  res.json({ bill: serializeBill(await prisma.vendorBill.findUnique({ where: { id: bill.id }, include: BILL_INCLUDE })) });
}

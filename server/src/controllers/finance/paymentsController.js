// Backend Phase 6 (full spec) — payments and allocations, and the financial
// accounts they're recorded against.
//
// A Payment is a RECORD: "Recorded payment — no bank or payment-provider
// transfer was performed." Nothing here moves money, stores card numbers or
// talks to a bank.
//
// Draft → Submitted → Approved → Posted → Reversed; or Cancelled. The
// creator can't approve their own payment. Posting (idempotent) creates the
// journal — incoming: Dr the financial account's ledger account / Cr
// Accounts Receivable; outgoing: Dr Accounts Payable / Cr the financial
// account — and applies its allocations to invoices or bills in the same
// transaction. An allocation never exceeds what the payment has left or
// what the document still owes, and uses the same currency. Reversing a
// payment reverses its journal and every allocation.
import prisma from "../../lib/prisma.js";
import { toApi } from "../../utils/serialize.js";
import { hasGrant } from "../../utils/grants.js";
import { nextDocumentNumber } from "../../services/sales/documentNumberService.js";
import { toMoney } from "../../services/sales/moneyService.js";
import {
  invalid, notFound, badTransition, versionConflict, staleVersion, audit, isCurrency, parseAmount, parseDay, text, getSettings, checkSeparation, PAYMENT_LABEL,
} from "../../services/finance/financeCommon.js";
import { LedgerError, sendLedgerError, postSystemJournal, reverseJournal } from "../../services/finance/ledgerService.js";
import { settleInvoice, settleBill, INVOICE_OPEN, BILL_OPEN } from "../../services/finance/settlementService.js";
import { canPostSoftClosed } from "./ledgerSetupController.js";

const who = (req) => req.membership?.id || null;
const MAX_PAGE_SIZE = 100;
export const PAYMENT_METHODS = ["Bank Transfer", "Credit Card", "Cash", "Check", "Other"];
const INCLUDE = { allocations: { orderBy: { createdAt: "asc" } } };

export function serializePayment(payment, { showReference = true } = {}) {
  const out = { ...toApi(payment), label: PAYMENT_LABEL };
  if (!showReference) out.reference = payment.reference ? "••••" : null;
  const active = (payment.allocations || []).filter((a) => a.status !== "Reversed");
  out.allocatedAmount = Number(active.reduce((s, a) => s.plus(toMoney(a.amount)), toMoney(0)));
  out.unallocatedAmount = Number(toMoney(payment.amount).minus(toMoney(out.allocatedAmount)));
  return out;
}
// Payment references are sensitive: shown in full only with payments:view
// plus financial_accounts:view_sensitive_fields.
const showRef = (req) => hasGrant(req, "financial_accounts", "view_sensitive_fields");

async function loadPayment(req, res) {
  const payment = await prisma.payment.findFirst({ where: { id: req.params.paymentId, organizationId: req.organizationId }, include: INCLUDE });
  if (!payment) notFound(res, "Payment");
  return payment;
}

export async function listPayments(req, res) {
  const q = req.query;
  const page = Math.max(1, Number(q.page) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(q.pageSize) || 50));
  const where = { organizationId: req.organizationId };
  if (q.status) where.status = q.status;
  if (q.direction) where.direction = q.direction;
  if (q.companyId) where.companyId = q.companyId;
  if (q.invoiceId) where.allocations = { some: { invoiceId: q.invoiceId } };
  const [payments, total] = await Promise.all([
    prisma.payment.findMany({ where, include: INCLUDE, orderBy: { date: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.payment.count({ where }),
  ]);
  res.json({ payments: payments.map((p) => serializePayment(p, { showReference: showRef(req) })), total, page, pageSize, label: PAYMENT_LABEL });
}

export async function getPayment(req, res) {
  const payment = await loadPayment(req, res);
  if (payment) res.json({ payment: serializePayment(payment, { showReference: showRef(req) }) });
}

// Checks requested allocations against the payment and each document
// (existence, organization, currency, direction, what's still owed).
async function validateAllocations(db, organizationId, payment, requested, alreadyAllocated = toMoney(0)) {
  if (!Array.isArray(requested) || !requested.length) return [];
  let running = alreadyAllocated;
  const out = [];
  for (const [i, a] of requested.entries()) {
    const amount = parseAmount(a?.amount, { field: `Allocation ${i + 1} amount`, currency: payment.currency });
    if (a.invoiceId) {
      if (payment.direction !== "Incoming") throw new RangeError("An outgoing payment can only be allocated to bills.");
      const invoice = await db.invoice.findFirst({ where: { id: a.invoiceId, organizationId } });
      if (!invoice) throw new RangeError(`Allocation ${i + 1}: invoice not found.`);
      if (invoice.currency !== payment.currency) throw new RangeError(`Allocation ${i + 1}: ${invoice.invoiceNumber} is in ${invoice.currency}; the payment is in ${payment.currency}.`);
      if (!INVOICE_OPEN.includes(invoice.status) || !invoice.journalEntryId) throw new RangeError(`Allocation ${i + 1}: ${invoice.invoiceNumber} isn't a posted, open invoice.`);
      if (amount.greaterThan(toMoney(invoice.amountDue))) throw new RangeError(`Allocation ${i + 1}: more than the ${toMoney(invoice.amountDue).toFixed(2)} still due on ${invoice.invoiceNumber}.`);
      if (payment.companyId && invoice.companyId && invoice.companyId !== payment.companyId) throw new RangeError(`Allocation ${i + 1}: ${invoice.invoiceNumber} belongs to another customer.`);
      out.push({ invoiceId: invoice.id, amount });
    } else if (a.billId) {
      if (payment.direction !== "Outgoing") throw new RangeError("An incoming payment can only be allocated to invoices.");
      const bill = await db.vendorBill.findFirst({ where: { id: a.billId, organizationId } });
      if (!bill) throw new RangeError(`Allocation ${i + 1}: bill not found.`);
      if (bill.currency !== payment.currency) throw new RangeError(`Allocation ${i + 1}: ${bill.billNumber} is in ${bill.currency}; the payment is in ${payment.currency}.`);
      if (!BILL_OPEN.includes(bill.status)) throw new RangeError(`Allocation ${i + 1}: ${bill.billNumber} isn't a posted, open bill.`);
      if (amount.greaterThan(toMoney(bill.amountDue))) throw new RangeError(`Allocation ${i + 1}: more than the ${toMoney(bill.amountDue).toFixed(2)} still due on ${bill.billNumber}.`);
      if (payment.vendorId && bill.vendorId !== payment.vendorId) throw new RangeError(`Allocation ${i + 1}: ${bill.billNumber} belongs to another vendor.`);
      out.push({ billId: bill.id, amount });
    } else throw new RangeError(`Allocation ${i + 1} needs an invoiceId or a billId.`);
    running = running.plus(amount);
  }
  if (running.greaterThan(toMoney(payment.amount))) throw new RangeError(`Allocations (${running.toFixed(2)}) exceed the payment (${toMoney(payment.amount).toFixed(2)}).`);
  return out;
}

async function paymentFields(req, settings) {
  const b = req.body;
  const direction = b.direction || "Incoming";
  if (!["Incoming", "Outgoing"].includes(direction)) throw new RangeError("direction must be Incoming or Outgoing.");
  const account = await prisma.financialAccount.findFirst({ where: { id: b.financialAccountId, organizationId: req.organizationId, archivedAt: null, active: true } });
  if (!account) throw new RangeError("financialAccountId must be an active financial account in this organization.");
  const currency = b.currency || account.currency;
  if (!isCurrency(currency)) throw new RangeError("currency must be an ISO 4217 code.");
  if (currency !== account.currency) throw new RangeError(`${account.name} holds ${account.currency}; record the payment in ${account.currency}.`);
  const amount = parseAmount(b.amount, { field: "amount", currency });
  const date = parseDay(b.date || new Date(), "date");
  if (date > new Date()) throw new RangeError("A payment date can't be in the future.");
  const method = b.method || "Bank Transfer";
  if (!PAYMENT_METHODS.includes(method)) throw new RangeError(`method must be one of ${PAYMENT_METHODS.join(", ")}.`);
  let companyId = null;
  let vendorId = null;
  if (b.companyId) {
    if (!(await prisma.company.findFirst({ where: { id: b.companyId, organizationId: req.organizationId } }))) throw new RangeError("companyId must be a company in this organization.");
    companyId = b.companyId;
  }
  if (b.vendorId) {
    const vendor = await prisma.vendor.findFirst({ where: { id: b.vendorId, organizationId: req.organizationId } });
    if (!vendor) throw new RangeError("vendorId must be a vendor in this organization.");
    vendorId = vendor.id;
    companyId = companyId || vendor.companyId;
  }
  return { direction, financialAccountId: account.id, currency, amount, date, method, companyId, vendorId, reference: text(b.reference, 120) || null, note: text(b.note, 1000) || null, account, settings };
}

export async function createPaymentRecord(req, input, requestedAllocations) {
  return prisma.$transaction(async (tx) => {
    const allocations = await validateAllocations(tx, req.organizationId, input, requestedAllocations);
    const paymentNumber = await nextDocumentNumber(tx, req.organizationId, "Payment");
    return tx.payment.create({
      data: {
        organizationId: req.organizationId, paymentNumber, direction: input.direction, financialAccountId: input.financialAccountId, companyId: input.companyId, vendorId: input.vendorId,
        currency: input.currency, amount: input.amount, date: input.date, method: input.method, reference: input.reference, note: input.note, status: "Draft",
        createdByMembershipId: who(req), recordedByMembershipId: who(req), invoiceId: allocations.length === 1 && allocations[0].invoiceId ? allocations[0].invoiceId : null,
        allocations: { create: allocations.map((a) => ({ organizationId: req.organizationId, invoiceId: a.invoiceId || null, billId: a.billId || null, amount: a.amount, createdByMembershipId: who(req), status: "Pending" })) },
      },
      include: INCLUDE,
    });
  });
}

export async function createPayment(req, res) {
  const settings = await getSettings(prisma, req.organizationId);
  let payment;
  try {
    const input = await paymentFields(req, settings);
    payment = await createPaymentRecord(req, input, req.body.allocations);
  } catch (err) {
    return err instanceof RangeError || err instanceof LedgerError ? invalid(res, err.message) : Promise.reject(err);
  }
  await audit(req, "finance.payment.created", "Payment", payment.id, { after: { paymentNumber: payment.paymentNumber, direction: payment.direction, amount: toMoney(payment.amount).toFixed(2), currency: payment.currency } });
  res.status(201).json({ payment: serializePayment(payment, { showReference: showRef(req) }) });
}

async function move(req, res, payment, from, data, action, extra = {}) {
  const updated = await prisma.payment.updateMany({ where: { id: payment.id, version: payment.version, status: { in: from } }, data: { ...data, version: { increment: 1 } } });
  if (updated.count !== 1) return versionConflict(res, "payment");
  await audit(req, action, "Payment", payment.id, { before: { status: payment.status }, after: { status: data.status }, ...extra });
  res.json({ payment: serializePayment(await prisma.payment.findUnique({ where: { id: payment.id }, include: INCLUDE }), { showReference: showRef(req) }) });
}

export async function submitPayment(req, res) {
  const payment = await loadPayment(req, res);
  if (!payment) return;
  if (payment.status !== "Draft") return badTransition(res, `A ${payment.status.toLowerCase()} payment can't be submitted.`);
  return move(req, res, payment, ["Draft"], { status: "Submitted" }, "finance.payment.submitted");
}

export async function approvePayment(req, res) {
  const payment = await loadPayment(req, res);
  if (!payment) return;
  if (staleVersion(req.body, payment)) return versionConflict(res, "payment");
  if (!["Draft", "Submitted"].includes(payment.status)) return badTransition(res, "Only a draft or submitted payment can be approved.");
  const settings = await getSettings(prisma, req.organizationId);
  if (!(await checkSeparation(req, res, { settings, sameActor: payment.createdByMembershipId === who(req), rule: "The person who recorded a payment can't approve it.", action: "payment.approve", targetType: "Payment", targetId: payment.id }))) return;
  return move(req, res, payment, ["Draft", "Submitted"], { status: "Approved", approvedByMembershipId: who(req), approvedAt: new Date() }, "finance.payment.approved");
}

// Applies allocations (already validated) to their documents.
async function applyAllocations(tx, allocations, sign) {
  for (const a of allocations) {
    if (a.invoiceId) await settleInvoice(tx, a.invoiceId, a.amount, sign);
    else if (a.billId) await settleBill(tx, a.billId, a.amount, sign);
  }
}

function paymentJournalLines(payment, account, settings) {
  const amount = toMoney(payment.amount).toFixed(2);
  if (payment.direction === "Incoming") {
    if (!settings.receivableAccountId) throw new LedgerError("No Accounts Receivable account is configured in Finance settings.");
    return [{ accountId: account.ledgerAccountId, debit: amount, companyId: payment.companyId }, { accountId: settings.receivableAccountId, credit: amount, companyId: payment.companyId }];
  }
  if (!settings.payableAccountId) throw new LedgerError("No Accounts Payable account is configured in Finance settings.");
  return [{ accountId: settings.payableAccountId, debit: amount, companyId: payment.companyId }, { accountId: account.ledgerAccountId, credit: amount, companyId: payment.companyId }];
}

export async function postPayment(req, res) {
  const payment = await loadPayment(req, res);
  if (!payment) return;
  if (staleVersion(req.body, payment)) return versionConflict(res, "payment");
  if (payment.status !== "Approved") return badTransition(res, "Only an approved payment can be posted.");
  const settings = await getSettings(prisma, req.organizationId);
  let journal;
  try {
    journal = await prisma.$transaction(async (tx) => {
      const account = await tx.financialAccount.findFirst({ where: { id: payment.financialAccountId, organizationId: req.organizationId } });
      if (!account) throw new LedgerError("The payment's financial account no longer exists.");
      const pending = payment.allocations.filter((a) => a.status === "Pending");
      // Re-validate now: balances may have changed since the payment was recorded.
      await validateAllocations(tx, req.organizationId, payment, pending.map((a) => ({ invoiceId: a.invoiceId, billId: a.billId, amount: toMoney(a.amount).toFixed(2) })));
      const entry = await postSystemJournal(tx, {
        organizationId: req.organizationId, settings, entryDate: payment.date, description: `${payment.direction} payment ${payment.paymentNumber} (recorded, no transfer performed)`,
        sourceType: "Payment", sourceId: payment.id, reference: payment.paymentNumber, currency: payment.currency, lines: paymentJournalLines(payment, account, settings),
        membershipId: who(req), canPostSoftClosed: canPostSoftClosed(req),
      });
      const updated = await tx.payment.updateMany({ where: { id: payment.id, version: payment.version, status: "Approved" }, data: { status: "Posted", postedByMembershipId: who(req), postedAt: new Date(), journalEntryId: entry.id, exchangeRate: entry.exchangeRate, version: { increment: 1 } } });
      if (updated.count !== 1) throw new LedgerError("This payment was changed by someone else. Refresh and try again.", { status: 409, code: "FINANCE_VERSION_CONFLICT" });
      await applyAllocations(tx, pending, 1);
      await tx.paymentAllocation.updateMany({ where: { paymentId: payment.id, status: "Pending" }, data: { status: "Active", allocationDate: new Date() } });
      return entry;
    });
  } catch (err) {
    if (err instanceof LedgerError) return sendLedgerError(res, err);
    if (err instanceof RangeError) return invalid(res, err.message);
    throw err;
  }
  await audit(req, "finance.payment.posted", "Payment", payment.id, { after: { journalEntryId: journal.id, entryNumber: journal.entryNumber } });
  res.json({ payment: serializePayment(await prisma.payment.findUnique({ where: { id: payment.id }, include: INCLUDE }), { showReference: showRef(req) }), journalEntryNumber: journal.entryNumber });
}

// Allocates what's left of a posted payment.
export async function allocatePayment(req, res) {
  const payment = await loadPayment(req, res);
  if (!payment) return;
  if (staleVersion(req.body, payment)) return versionConflict(res, "payment");
  if (payment.status !== "Posted") return badTransition(res, "Only a posted payment can be allocated; allocations on a draft are applied when it's posted.");
  const already = payment.allocations.filter((a) => a.status === "Active").reduce((s, a) => s.plus(toMoney(a.amount)), toMoney(0));
  try {
    await prisma.$transaction(async (tx) => {
      const allocations = await validateAllocations(tx, req.organizationId, payment, req.body.allocations, already);
      if (!allocations.length) throw new RangeError("Give at least one allocation.");
      const touched = await tx.payment.updateMany({ where: { id: payment.id, version: payment.version, status: "Posted" }, data: { version: { increment: 1 } } });
      if (touched.count !== 1) throw new LedgerError("This payment was changed by someone else. Refresh and try again.", { status: 409, code: "FINANCE_VERSION_CONFLICT" });
      await applyAllocations(tx, allocations, 1);
      await tx.paymentAllocation.createMany({ data: allocations.map((a) => ({ organizationId: req.organizationId, paymentId: payment.id, invoiceId: a.invoiceId || null, billId: a.billId || null, amount: a.amount, createdByMembershipId: who(req), status: "Active" })) });
    });
  } catch (err) {
    if (err instanceof LedgerError) return sendLedgerError(res, err);
    if (err instanceof RangeError) return invalid(res, err.message);
    throw err;
  }
  await audit(req, "finance.payment.allocated", "Payment", payment.id, { after: { allocations: req.body.allocations?.length || 0 } });
  res.json({ payment: serializePayment(await prisma.payment.findUnique({ where: { id: payment.id }, include: INCLUDE }), { showReference: showRef(req) }) });
}

export async function reversePayment(req, res) {
  const payment = await loadPayment(req, res);
  if (!payment) return;
  if (staleVersion(req.body, payment)) return versionConflict(res, "payment");
  if (payment.status !== "Posted") return badTransition(res, "Only a posted payment can be reversed.");
  const reason = text(req.body.reason, 500);
  if (!reason) return invalid(res, "Reversing a payment needs a reason.");
  try {
    await prisma.$transaction(async (tx) => {
      const entry = await tx.journalEntry.findUnique({ where: { id: payment.journalEntryId }, include: { lines: true } });
      const reversal = await reverseJournal(tx, entry, { membershipId: who(req), reason: `Payment ${payment.paymentNumber} reversed: ${reason}`, canPostSoftClosed: canPostSoftClosed(req) });
      const updated = await tx.payment.updateMany({ where: { id: payment.id, version: payment.version, status: "Posted" }, data: { status: "Reversed", reversedAt: new Date(), reversalReason: reason, reversalJournalId: reversal.id, version: { increment: 1 } } });
      if (updated.count !== 1) throw new LedgerError("This payment was changed by someone else.", { status: 409, code: "FINANCE_VERSION_CONFLICT" });
      const active = payment.allocations.filter((a) => a.status === "Active");
      await applyAllocations(tx, active, -1);
      await tx.paymentAllocation.updateMany({ where: { paymentId: payment.id, status: "Active" }, data: { status: "Reversed", reversedAt: new Date() } });
    });
  } catch (err) {
    if (err instanceof LedgerError) return sendLedgerError(res, err);
    throw err;
  }
  await audit(req, "finance.payment.reversed", "Payment", payment.id, { reason });
  res.json({ payment: serializePayment(await prisma.payment.findUnique({ where: { id: payment.id }, include: INCLUDE }), { showReference: showRef(req) }) });
}

export async function cancelPayment(req, res) {
  const payment = await loadPayment(req, res);
  if (!payment) return;
  if (!["Draft", "Submitted", "Approved"].includes(payment.status)) return badTransition(res, "A posted payment can't be cancelled; reverse it instead.");
  const reason = text(req.body.reason, 500);
  if (!reason) return invalid(res, "Cancelling a payment needs a reason.");
  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.payment.updateMany({ where: { id: payment.id, version: payment.version }, data: { status: "Cancelled", cancelledReason: reason, version: { increment: 1 } } });
    if (u.count === 1) await tx.paymentAllocation.updateMany({ where: { paymentId: payment.id, status: "Pending" }, data: { status: "Reversed", reversedAt: new Date() } });
    return u.count;
  });
  if (updated !== 1) return versionConflict(res, "payment");
  await audit(req, "finance.payment.cancelled", "Payment", payment.id, { reason });
  res.json({ payment: serializePayment(await prisma.payment.findUnique({ where: { id: payment.id }, include: INCLUDE }), { showReference: showRef(req) }) });
}

// The Invoice page's "Record payment": a Draft incoming payment allocated to
// this invoice, which reaches the invoice only once approved and posted.
export async function recordInvoicePayment(req, res) {
  const invoice = await prisma.invoice.findFirst({ where: { id: req.params.invoiceId, organizationId: req.organizationId } });
  if (!invoice) return notFound(res, "Invoice");
  let financialAccountId = req.body.financialAccountId;
  if (!financialAccountId) {
    const fallback = await prisma.financialAccount.findFirst({ where: { organizationId: req.organizationId, currency: invoice.currency, active: true, archivedAt: null }, orderBy: { createdAt: "asc" } });
    if (!fallback) return invalid(res, `No ${invoice.currency} financial account exists yet. Add one under Finance → Financial accounts.`);
    financialAccountId = fallback.id;
  }
  req.body = { ...req.body, direction: "Incoming", financialAccountId, currency: invoice.currency, companyId: invoice.companyId };
  const settings = await getSettings(prisma, req.organizationId);
  let payment;
  try {
    const input = await paymentFields(req, settings);
    payment = await createPaymentRecord(req, input, [{ invoiceId: invoice.id, amount: req.body.amount }]);
  } catch (err) {
    return err instanceof RangeError || err instanceof LedgerError ? invalid(res, err.message) : Promise.reject(err);
  }
  await audit(req, "finance.payment.created", "Payment", payment.id, { after: { invoiceId: invoice.id, amount: toMoney(payment.amount).toFixed(2) } });
  const { serializeInvoice } = await import("./invoicesController.js");
  const fresh = await prisma.invoice.findUnique({ where: { id: invoice.id }, include: { company: { select: { id: true, name: true } }, payments: true, creditNotes: true, lines: true, allocations: { include: { payment: { select: { id: true, paymentNumber: true, status: true, method: true, date: true, reference: true } } } } } });
  res.status(201).json({ invoice: serializeInvoice(fresh), payment: serializePayment(payment, { showReference: showRef(req) }), note: "Recorded as a draft payment. It updates the invoice once it's approved and posted." });
}

// ---- Financial accounts ---------------------------------------------------

const FA_TYPES = ["Cash", "Bank", "Clearing", "Card", "Other"];
const serializeAccount = (req, account) => ({ ...toApi(account), maskedReference: hasGrant(req, "financial_accounts", "view_sensitive_fields") ? account.maskedReference : account.maskedReference ? "••••" : null });

export async function listFinancialAccounts(req, res) {
  const accounts = await prisma.financialAccount.findMany({ where: { organizationId: req.organizationId, ...(req.query.includeArchived === "true" ? {} : { archivedAt: null }) }, orderBy: { name: "asc" } });
  res.json({ financialAccounts: accounts.map((a) => serializeAccount(req, a)) });
}

// Only the last 4 digits are ever accepted — never a full account or card number.
function maskReference(value) {
  if (value === undefined || value === null || value === "") return null;
  const digits = String(value).replace(/\s/g, "");
  if (!/^\d{1,4}$/.test(digits)) throw new RangeError("Give at most the last 4 digits (lastDigits); full account or card numbers are never stored.");
  return `•••• ${digits}`;
}

export async function createFinancialAccount(req, res) {
  const name = text(req.body.name, 120);
  if (!name) return invalid(res, "name is required.");
  if (!FA_TYPES.includes(req.body.type)) return invalid(res, `type must be one of ${FA_TYPES.join(", ")}.`);
  if (!isCurrency(req.body.currency)) return invalid(res, "currency must be an ISO 4217 code.");
  let maskedReference;
  try { maskedReference = maskReference(req.body.lastDigits); } catch (err) { return invalid(res, err.message); }
  const ledger = await prisma.ledgerAccount.findFirst({ where: { id: req.body.ledgerAccountId, organizationId: req.organizationId, type: "Asset", postingAllowed: true, archivedAt: null } });
  if (!ledger) return invalid(res, "ledgerAccountId must be an active, postable asset account (for example 1020 Bank Accounts).");
  if (ledger.currency && ledger.currency !== req.body.currency) return invalid(res, `That ledger account only accepts ${ledger.currency}.`);
  if (await prisma.financialAccount.findFirst({ where: { organizationId: req.organizationId, name } })) return invalid(res, `A financial account named ${name} already exists.`);
  const account = await prisma.financialAccount.create({ data: { organizationId: req.organizationId, name, type: req.body.type, currency: req.body.currency, maskedReference, ledgerAccountId: ledger.id, createdByMembershipId: who(req) } });
  await audit(req, "finance.financial_account.created", "FinancialAccount", account.id, { after: { name, type: account.type, currency: account.currency } });
  res.status(201).json({ financialAccount: serializeAccount(req, account) });
}

export async function updateFinancialAccount(req, res) {
  const account = await prisma.financialAccount.findFirst({ where: { id: req.params.accountId, organizationId: req.organizationId } });
  if (!account) return notFound(res, "Financial account");
  if (staleVersion(req.body, account)) return versionConflict(res, "financial account");
  const data = {};
  if ("name" in req.body) { data.name = text(req.body.name, 120); if (!data.name) return invalid(res, "name can't be empty."); }
  if ("active" in req.body) data.active = req.body.active === true;
  if ("lastDigits" in req.body) { try { data.maskedReference = maskReference(req.body.lastDigits); } catch (err) { return invalid(res, err.message); } }
  if (req.body.archive === true) Object.assign(data, { archivedAt: new Date(), active: false });
  const updated = await prisma.financialAccount.update({ where: { id: account.id }, data: { ...data, version: { increment: 1 } } });
  await audit(req, "finance.financial_account.updated", "FinancialAccount", account.id, { after: { ...data, maskedReference: data.maskedReference ? "[changed]" : undefined } });
  res.json({ financialAccount: serializeAccount(req, updated) });
}

// An opening balance is a journal, never a stored number: this drafts a
// "Opening Balance" journal (Dr the account / Cr Opening Balance Equity)
// that goes through the normal approve-and-post steps.
export async function draftOpeningBalance(req, res) {
  const account = await prisma.financialAccount.findFirst({ where: { id: req.params.accountId, organizationId: req.organizationId } });
  if (!account) return notFound(res, "Financial account");
  if (account.openingJournalId) {
    const existing = await prisma.journalEntry.findUnique({ where: { id: account.openingJournalId } });
    if (existing && !["Cancelled", "Reversed"].includes(existing.status)) return badTransition(res, `This account already has an opening balance journal (${existing.entryNumber}).`);
  }
  const equity = req.body.equityAccountId
    ? await prisma.ledgerAccount.findFirst({ where: { id: req.body.equityAccountId, organizationId: req.organizationId, type: "Equity", postingAllowed: true } })
    : await prisma.ledgerAccount.findFirst({ where: { organizationId: req.organizationId, code: "3900", postingAllowed: true } });
  if (!equity) return invalid(res, "No Opening Balance Equity account; pass equityAccountId.");
  let amount;
  let date;
  try {
    amount = parseAmount(req.body.amount, { field: "amount", currency: account.currency });
    date = parseDay(req.body.date, "date");
  } catch (err) {
    return invalid(res, err.message);
  }
  const { createJournal, buildJournalLines, loadAccounts, resolveRate } = await import("../../services/finance/ledgerService.js");
  const settings = await getSettings(prisma, req.organizationId);
  let entry;
  try {
    const { rate, exchangeRateId } = await resolveRate(prisma, req.organizationId, account.currency, settings.baseCurrency, date);
    const accountsById = await loadAccounts(prisma, req.organizationId, [account.ledgerAccountId, equity.id]);
    const built = buildJournalLines([{ accountId: account.ledgerAccountId, debit: amount.toFixed(2) }, { accountId: equity.id, credit: amount.toFixed(2) }], { currency: account.currency, baseCurrency: settings.baseCurrency, exchangeRate: rate, accountsById });
    entry = await prisma.$transaction(async (tx) => {
      const created = await createJournal(tx, { organizationId: req.organizationId, entryDate: date, description: `Opening balance — ${account.name}`, sourceType: "Opening Balance", sourceId: account.id, currency: account.currency, exchangeRate: rate, exchangeRateId, built, createdByMembershipId: who(req) });
      await tx.financialAccount.update({ where: { id: account.id }, data: { openingJournalId: created.id, version: { increment: 1 } } });
      return created;
    });
  } catch (err) {
    if (err instanceof LedgerError) return sendLedgerError(res, err);
    throw err;
  }
  await audit(req, "finance.financial_account.opening_balance_drafted", "FinancialAccount", account.id, { after: { journalEntryId: entry.id } });
  res.status(201).json({ journal: toApi(entry), note: "Drafted. Submit, approve and post it like any journal." });
}

// Backend Phase 6 (full spec) — credit notes against posted invoices.
//
// Draft → Approved → Posted; or Cancelled. A credit can't exceed what's
// still creditable on the invoice (total − credits) unless an emergency
// override is used. The creator can't approve their own credit note.
// Posting (idempotent) creates the reversing journal — Dr revenue and tax,
// Cr Accounts Receivable — and reduces what the invoice owes. No money
// moves: a refund, if any, is a separate recorded outgoing payment.
import prisma from "../../lib/prisma.js";
import { toApi } from "../../utils/serialize.js";
import { hasGrant } from "../../utils/grants.js";
import { nextDocumentNumber } from "../../services/sales/documentNumberService.js";
import { toMoney, round } from "../../services/sales/moneyService.js";
import {
  invalid, notFound, badTransition, versionConflict, staleVersion, audit, parseAmount, text, getSettings, checkSeparation,
} from "../../services/finance/financeCommon.js";
import { LedgerError, sendLedgerError, postSystemJournal } from "../../services/finance/ledgerService.js";
import { creditInvoice } from "../../services/finance/settlementService.js";
import { scopeWhere as invoiceScope, serializeInvoice } from "./invoicesController.js";
import { canPostSoftClosed } from "./ledgerSetupController.js";

const who = (req) => req.membership?.id || null;
const CREDITABLE = ["Posted", "Sent", "Partially Paid", "Paid", "Disputed"];

async function loadCreditNote(req, res) {
  const note = await prisma.creditNote.findFirst({ where: { id: req.params.creditNoteId, organizationId: req.organizationId }, include: { invoice: true } });
  if (!note) notFound(res, "Credit note");
  return note;
}

export async function listCreditNotes(req, res) {
  const where = { organizationId: req.organizationId, invoice: invoiceScope(req) };
  if (req.query.invoiceId) where.invoiceId = req.query.invoiceId;
  if (req.query.status) where.status = req.query.status;
  const creditNotes = await prisma.creditNote.findMany({ where, orderBy: { createdAt: "desc" }, take: 500 });
  res.json({ creditNotes: toApi(creditNotes) });
}

// Splits a credit amount into revenue and tax in the invoice's proportion.
export function splitCredit(invoice, amount) {
  const total = toMoney(invoice.total);
  if (total.isZero()) return { subtotal: toMoney(amount), taxAdjustment: toMoney(0) };
  const taxAdjustment = round(toMoney(amount).times(toMoney(invoice.tax)).dividedBy(total), invoice.currency);
  return { subtotal: toMoney(amount).minus(taxAdjustment), taxAdjustment };
}

// POST /finance/credit-notes { invoiceId, amount, reason } → { creditNote, invoice }
export async function createCreditNote(req, res) {
  const reason = text(req.body.reason, 500);
  if (!reason) return invalid(res, "A reason is required for a credit note.");
  const invoice = await prisma.invoice.findFirst({ where: { id: req.body.invoiceId, organizationId: req.organizationId, ...invoiceScope(req) } });
  if (!invoice) return notFound(res, "Invoice");
  if (!CREDITABLE.includes(invoice.status) || !invoice.journalEntryId) return badTransition(res, "Credit notes can only be issued against an invoice that has been posted to the ledger.");
  let amount;
  try { amount = parseAmount(req.body.amount, { field: "amount", currency: invoice.currency }); } catch (err) { return invalid(res, err.message); }
  const open = await prisma.creditNote.findMany({ where: { invoiceId: invoice.id, status: { in: ["Draft", "Submitted", "Approved"] } } });
  const pending = open.reduce((s, n) => s.plus(toMoney(n.amount)), toMoney(0));
  const creditable = toMoney(invoice.total).minus(toMoney(invoice.amountCredited)).minus(pending);
  let exceptionReason = null;
  if (amount.greaterThan(creditable)) {
    exceptionReason = text(req.body.overrideReason, 500);
    if (!exceptionReason || !hasGrant(req, "finance_overrides", "override_controls")) return invalid(res, `The credit is more than the ${creditable.toFixed(2)} left to credit on this invoice (including drafts).`);
  }
  const { subtotal, taxAdjustment } = splitCredit(invoice, amount);
  const creditNote = await prisma.$transaction(async (tx) => {
    const creditNoteNumber = await nextDocumentNumber(tx, req.organizationId, "CreditNote");
    return tx.creditNote.create({
      data: {
        organizationId: req.organizationId, creditNoteNumber, invoiceId: invoice.id, companyId: invoice.companyId, companyName: null, amount, currency: invoice.currency, reason,
        subtotal, taxAdjustment, remainingAmount: amount, exceptionReason, status: "Draft", createdByMembershipId: who(req), issuedByMembershipId: who(req),
        lines: [{ description: `Credit against ${invoice.invoiceNumber}`, subtotal: subtotal.toFixed(2), tax: taxAdjustment.toFixed(2), total: amount.toFixed(2) }],
      },
    });
  });
  if (exceptionReason) await prisma.financeOverride.create({ data: { organizationId: req.organizationId, action: "credit_note.create", targetType: "CreditNote", targetId: creditNote.id, rule: "Credit above the creditable amount", reason: exceptionReason, actorMembershipId: who(req) } });
  await audit(req, "finance.credit_note.created", "CreditNote", creditNote.id, { reason, after: { invoiceId: invoice.id, amount: amount.toFixed(2), exception: !!exceptionReason } });
  const fresh = await prisma.invoice.findUnique({ where: { id: invoice.id }, include: { company: { select: { id: true, name: true } }, payments: true, creditNotes: true, lines: true, allocations: { include: { payment: { select: { id: true, paymentNumber: true, status: true, method: true, date: true, reference: true } } } } } });
  res.status(201).json({ creditNote: toApi(creditNote), invoice: serializeInvoice(fresh), note: "Draft credit note. It reduces the invoice once approved and posted." });
}

export async function approveCreditNote(req, res) {
  const note = await loadCreditNote(req, res);
  if (!note) return;
  if (staleVersion(req.body, note)) return versionConflict(res, "credit note");
  if (!["Draft", "Submitted"].includes(note.status)) return badTransition(res, "Only a draft credit note can be approved.");
  const settings = await getSettings(prisma, req.organizationId);
  if (!(await checkSeparation(req, res, { settings, sameActor: note.createdByMembershipId === who(req), rule: "The person who raised a credit note can't approve it.", action: "credit_note.approve", targetType: "CreditNote", targetId: note.id }))) return;
  const updated = await prisma.creditNote.updateMany({ where: { id: note.id, version: note.version }, data: { status: "Approved", approvedByMembershipId: who(req), approvedAt: new Date(), version: { increment: 1 } } });
  if (updated.count !== 1) return versionConflict(res, "credit note");
  await audit(req, "finance.credit_note.approved", "CreditNote", note.id);
  res.json({ creditNote: toApi(await prisma.creditNote.findUnique({ where: { id: note.id } })) });
}

export async function postCreditNote(req, res) {
  const note = await loadCreditNote(req, res);
  if (!note) return;
  if (staleVersion(req.body, note)) return versionConflict(res, "credit note");
  if (note.status !== "Approved") return badTransition(res, "Only an approved credit note can be posted.");
  const settings = await getSettings(prisma, req.organizationId);
  const invoice = note.invoice;
  let journal;
  try {
    journal = await prisma.$transaction(async (tx) => {
      if (!settings.receivableAccountId || !settings.revenueAccountId) throw new LedgerError("Accounts Receivable and revenue accounts must be configured in Finance settings.");
      const lines = [{ accountId: settings.revenueAccountId, debit: toMoney(note.subtotal).toFixed(2), companyId: invoice.companyId, projectId: invoice.projectId }];
      if (toMoney(note.taxAdjustment).greaterThan(0)) {
        if (!settings.taxPayableAccountId) throw new LedgerError("No Tax Payable account is configured.");
        lines.push({ accountId: settings.taxPayableAccountId, debit: toMoney(note.taxAdjustment).toFixed(2) });
      }
      lines.push({ accountId: settings.receivableAccountId, credit: toMoney(note.amount).toFixed(2), companyId: invoice.companyId });
      const entry = await postSystemJournal(tx, {
        organizationId: req.organizationId, settings, entryDate: note.creditDate, description: `Credit note ${note.creditNoteNumber} against ${invoice.invoiceNumber}: ${note.reason || ""}`.slice(0, 500),
        sourceType: "Credit Note", sourceId: note.id, reference: note.creditNoteNumber, currency: note.currency, lines, membershipId: who(req), canPostSoftClosed: canPostSoftClosed(req),
      });
      const updated = await tx.creditNote.updateMany({ where: { id: note.id, version: note.version, status: "Approved" }, data: { status: "Posted", postedByMembershipId: who(req), postedAt: new Date(), journalEntryId: entry.id, appliedAmount: note.amount, remainingAmount: 0, version: { increment: 1 } } });
      if (updated.count !== 1) throw new LedgerError("This credit note was changed by someone else.", { status: 409, code: "FINANCE_VERSION_CONFLICT" });
      await creditInvoice(tx, invoice.id, note.amount, 1);
      return entry;
    });
  } catch (err) {
    if (err instanceof LedgerError) return sendLedgerError(res, err);
    throw err;
  }
  await audit(req, "finance.credit_note.posted", "CreditNote", note.id, { after: { journalEntryId: journal.id, entryNumber: journal.entryNumber } });
  res.json({ creditNote: toApi(await prisma.creditNote.findUnique({ where: { id: note.id } })), journalEntryNumber: journal.entryNumber });
}

export async function cancelCreditNote(req, res) {
  const note = await loadCreditNote(req, res);
  if (!note) return;
  if (!["Draft", "Submitted", "Approved"].includes(note.status)) return badTransition(res, "A posted credit note can't be cancelled.");
  const reason = text(req.body.reason, 500);
  if (!reason) return invalid(res, "Cancelling a credit note needs a reason.");
  const updated = await prisma.creditNote.updateMany({ where: { id: note.id, version: note.version }, data: { status: "Cancelled", remainingAmount: 0, version: { increment: 1 } } });
  if (updated.count !== 1) return versionConflict(res, "credit note");
  await audit(req, "finance.credit_note.cancelled", "CreditNote", note.id, { reason });
  res.json({ creditNote: toApi(await prisma.creditNote.findUnique({ where: { id: note.id } })) });
}

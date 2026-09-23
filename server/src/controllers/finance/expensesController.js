// Backend Phase 6 (full spec) — Expenses.
//
// Statuses: Draft → Pending (submitted; the frontend's label) → Approved
// or Rejected → Posted → Reimbursed Record; or Cancelled. "Reimbursed
// Record" means a reimbursement was RECORDED — no money moves here.
//
// Nobody approves their own expense. Rejection needs a reason. An expense
// over the organization's policy limit is a policy exception: it needs a
// reason from the submitter and expenses:approve_exception to approve.
// Editing an amount, date, currency, category or tax after review sends
// the expense back to Pending. Approved expenses stay unposted until a
// person posts them; posting creates a balanced journal (expense and
// recoverable tax against Employee Reimbursements Payable).
// Receipts: metadata only — no file is stored.
import prisma from "../../lib/prisma.js";
import { toApi } from "../../utils/serialize.js";
import { hasGrant } from "../../utils/grants.js";
import { nextDocumentNumber } from "../../services/sales/documentNumberService.js";
import { round, toMoney } from "../../services/sales/moneyService.js";
import { EXPENSE_CATEGORIES } from "../../services/finance/financeRulesService.js";
import {
  invalid, notFound, badTransition, versionConflict, staleVersion, audit, isCurrency, parseAmount, parseDay, text, getSettings, checkSeparation,
} from "../../services/finance/financeCommon.js";
import { lineAmounts, taxSnapshot } from "../../services/finance/documentMath.js";
import { LedgerError, sendLedgerError, postSystemJournal, resolveRate } from "../../services/finance/ledgerService.js";
import { financeScopeWhere } from "./invoicesController.js";
import { canPostSoftClosed } from "./ledgerSetupController.js";

const MAX_PAGE_SIZE = 200;
const who = (req) => req.membership?.id || null;
export const EXPENSE_STATUSES = ["Draft", "Pending", "Approved", "Rejected", "Posted", "Reimbursed Record", "Cancelled"];
// The starter chart's account per category (see ledgerSetupController.STARTER_CHART).
export const CATEGORY_ACCOUNT_CODES = { Travel: "6100", Software: "6200", "Office Supplies": "6300", Meals: "6400", Other: "6900" };
const MATERIAL_FIELDS = ["amount", "amountBeforeTax", "taxRateId", "currency", "date", "category"];

// Department/Team scope: expenses submitted by members of the caller's
// department (so a manager can review them); narrower: the caller's own.
export const scopeWhere = (req) => financeScopeWhere(req, "expenses", "submittedByMembership", "submittedByMembershipId");

async function loadExpense(req, res) {
  const expense = await prisma.expense.findFirst({ where: { id: req.params.expenseId, organizationId: req.organizationId, ...scopeWhere(req) } });
  if (!expense) notFound(res, "Expense");
  return expense;
}

export async function list(req, res) {
  const q = req.query;
  const page = Math.max(1, Number(q.page) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(q.pageSize) || 50));
  const where = { organizationId: req.organizationId, archivedAt: null, ...scopeWhere(req) };
  if (q.status) where.status = q.status;
  if (q.category) where.category = q.category;
  if (q.submittedByMembershipId) where.submittedByMembershipId = q.submittedByMembershipId;
  if (q.expenseReportId) where.expenseReportId = q.expenseReportId;
  if (q.projectId) where.projectId = q.projectId;
  const [expenses, total] = await Promise.all([
    prisma.expense.findMany({ where, orderBy: { date: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.expense.count({ where }),
  ]);
  res.json({ expenses: toApi(expenses), total, page, pageSize });
}

export async function getOne(req, res) {
  const expense = await loadExpense(req, res);
  if (expense) res.json({ expense: toApi(expense) });
}

// Validates and computes the money fields. `amount` alone = a total with
// no tax; `amountBeforeTax` + `taxRateId` = the tax is computed here.
async function expenseFields(req, settings, existing = null) {
  const b = req.body;
  const data = {};
  if (!existing || "description" in b) { data.description = text(b.description, 1000); if (!data.description) throw new RangeError("A description is required."); }
  if (!existing || "category" in b) {
    data.category = b.category || existing?.category || "Other";
    if (!EXPENSE_CATEGORIES.includes(data.category)) throw new RangeError(`category must be one of ${EXPENSE_CATEGORIES.join(", ")}.`);
  }
  const currency = b.currency || existing?.currency || settings.baseCurrency || "USD";
  if (!isCurrency(currency)) throw new RangeError("currency must be an ISO 4217 code.");
  data.currency = currency;
  if (!existing || "date" in b) {
    data.date = b.date ? parseDay(b.date, "date") : parseDay(new Date());
    if (data.date > new Date()) throw new RangeError("An expense date can't be in the future.");
  }
  if (!existing || "amount" in b || "amountBeforeTax" in b || "taxRateId" in b || "currency" in b) {
    let snapshot = null;
    const taxRateId = "taxRateId" in b ? b.taxRateId : existing?.taxRateId;
    if (taxRateId) {
      const rate = await prisma.taxRate.findFirst({ where: { id: taxRateId, organizationId: req.organizationId, active: true } });
      if (!rate || rate.type === "Sales") throw new RangeError("taxRateId must be an active purchase tax rate.");
      snapshot = taxSnapshot(rate);
    }
    if (snapshot) {
      const before = parseAmount(b.amountBeforeTax ?? b.amount ?? existing?.amountBeforeTax, { field: "amountBeforeTax", currency });
      const amounts = lineAmounts({ quantity: 1, unitPrice: before, snapshot, currency });
      Object.assign(data, { amountBeforeTax: amounts.lineSubtotal, taxAmount: amounts.taxAmount, amount: amounts.lineTotal, taxRateId, taxSnapshot: snapshot });
    } else {
      const total = parseAmount(b.amount ?? existing?.amount, { field: "amount", currency });
      Object.assign(data, { amountBeforeTax: total, taxAmount: 0, amount: total, taxRateId: null, taxSnapshot: null });
    }
    const { rate } = await resolveRate(prisma, req.organizationId, currency, settings.baseCurrency || "USD", data.date || existing?.date || new Date());
    data.exchangeRate = rate;
    data.baseAmount = round(toMoney(data.amount).times(rate), settings.baseCurrency || "USD");
  }
  if ("merchant" in b) data.merchant = text(b.merchant, 200) || null;
  if ("paymentMethod" in b) data.paymentMethod = text(b.paymentMethod, 80) || null;
  if ("billable" in b) data.billable = b.billable === true;
  if ("receiptMetadata" in b) {
    const m = b.receiptMetadata;
    // Metadata only; never a file or a URL to one.
    data.receiptMetadata = m && typeof m === "object" ? { fileName: text(m.fileName, 200) || null, receiptDate: text(m.receiptDate, 40) || null, note: text(m.note, 500) || null, stored: false } : null;
  }
  const refs = [["vendorId", "vendor"], ["costCenterId", "costCenter"], ["projectId", "project"], ["customerCompanyId", "company"], ["expenseAccountId", "ledgerAccount"]];
  for (const [field, model] of refs) {
    if (!(field in b)) continue;
    if (b[field] && !(await prisma[model].findFirst({ where: { id: b[field], organizationId: req.organizationId } }))) throw new RangeError(`${field} must reference a record in this organization.`);
    data[field] = b[field] || null;
  }
  // Policy: over the limit is an exception that needs a reason.
  if (settings.expensePolicyLimit && data.baseAmount !== undefined) {
    const over = toMoney(data.baseAmount).greaterThan(toMoney(settings.expensePolicyLimit));
    data.policyException = over;
    const reason = text(b.policyExceptionReason ?? existing?.policyExceptionReason, 500);
    if (over && !reason) throw new RangeError(`This expense is over the policy limit (${toMoney(settings.expensePolicyLimit).toFixed(2)} ${settings.baseCurrency}); give a policyExceptionReason.`);
    data.policyExceptionReason = over ? reason : null;
  }
  return data;
}

// Submitted (Pending) by the caller, unless `draft: true`.
export async function create(req, res) {
  const settings = await getSettings(prisma, req.organizationId);
  let data;
  try { data = await expenseFields(req, settings); } catch (err) { return err instanceof RangeError || err instanceof LedgerError ? invalid(res, err.message) : Promise.reject(err); }
  const status = req.body.draft === true ? "Draft" : "Pending";
  const expense = await prisma.$transaction(async (tx) => {
    const expenseNumber = await nextDocumentNumber(tx, req.organizationId, "Expense");
    return tx.expense.create({
      data: { organizationId: req.organizationId, expenseNumber, ...data, status, submittedByMembershipId: who(req), submittedAt: status === "Pending" ? new Date() : null },
    });
  });
  await audit(req, status === "Pending" ? "finance.expense.submitted" : "finance.expense.drafted", "Expense", expense.id, { after: { amount: toMoney(expense.amount).toFixed(2), currency: expense.currency, policyException: expense.policyException } });
  res.status(201).json({ expense: toApi(expense) });
}

// The submitter edits their own unposted expense. A material change after
// review sends it back to Pending.
export async function update(req, res) {
  const expense = await loadExpense(req, res);
  if (!expense) return;
  if (expense.submittedByMembershipId !== who(req)) return res.status(403).json({ code: "RBAC_FORBIDDEN", message: "Only the submitter can edit an expense." });
  if (!["Draft", "Pending", "Rejected", "Approved"].includes(expense.status)) return badTransition(res, `A ${expense.status.toLowerCase()} expense can't be edited.`);
  if (expense.expenseReportId && expense.status === "Approved") return badTransition(res, "This expense is part of an approved report.");
  if (staleVersion(req.body, expense)) return versionConflict(res, "expense");
  const settings = await getSettings(prisma, req.organizationId);
  let data;
  try { data = await expenseFields(req, settings, expense); } catch (err) { return err instanceof RangeError || err instanceof LedgerError ? invalid(res, err.message) : Promise.reject(err); }
  const material = MATERIAL_FIELDS.some((f) => f in req.body);
  if (material && ["Approved", "Rejected"].includes(expense.status)) Object.assign(data, { status: "Pending", reviewedByMembershipId: null, reviewedAt: null, reviewNote: null, rejectionReason: null, submittedAt: new Date() });
  const updated = await prisma.expense.updateMany({ where: { id: expense.id, version: expense.version }, data: { ...data, version: { increment: 1 } } });
  if (updated.count !== 1) return versionConflict(res, "expense");
  await audit(req, "finance.expense.updated", "Expense", expense.id, { before: { status: expense.status, amount: toMoney(expense.amount).toFixed(2) }, after: { status: data.status || expense.status, resetApproval: material && ["Approved", "Rejected"].includes(expense.status) } });
  res.json({ expense: toApi(await prisma.expense.findUnique({ where: { id: expense.id } })) });
}

export async function submit(req, res) {
  const expense = await loadExpense(req, res);
  if (!expense) return;
  if (expense.submittedByMembershipId !== who(req)) return res.status(403).json({ code: "RBAC_FORBIDDEN", message: "Only the submitter can submit an expense." });
  if (!["Draft", "Rejected"].includes(expense.status)) return badTransition(res, `A ${expense.status.toLowerCase()} expense can't be submitted.`);
  const updated = await prisma.expense.updateMany({ where: { id: expense.id, version: expense.version }, data: { status: "Pending", submittedAt: new Date(), rejectionReason: null, version: { increment: 1 } } });
  if (updated.count !== 1) return versionConflict(res, "expense");
  await audit(req, "finance.expense.submitted", "Expense", expense.id);
  res.json({ expense: toApi(await prisma.expense.findUnique({ where: { id: expense.id } })) });
}

// POST /:id/review { status: "Approved" | "Rejected", note? } — needs the
// matching grant, only for a Pending expense, never your own. Rejecting
// needs a reason; a policy exception needs expenses:approve_exception.
export async function review(req, res) {
  const { status } = req.body;
  if (!["Approved", "Rejected"].includes(status)) return invalid(res, 'status must be "Approved" or "Rejected".');
  const action = status === "Approved" ? "approve" : "reject";
  if (!hasGrant(req, "expenses", action)) return res.status(403).json({ code: "RBAC_FORBIDDEN", message: `You don't have permission to ${action} expenses.` });
  const existing = await loadExpense(req, res);
  if (!existing) return;
  if (existing.status !== "Pending") return badTransition(res, `This expense has already been ${existing.status.toLowerCase()}.`);
  if (existing.expenseReportId) return badTransition(res, "This expense is reviewed as part of its expense report.");
  const settings = await getSettings(prisma, req.organizationId);
  if (!(await checkSeparation(req, res, { settings, sameActor: !!who(req) && existing.submittedByMembershipId === who(req), rule: "You can't approve or reject your own expense.", action: `expense.${action}`, targetType: "Expense", targetId: existing.id }))) return;
  const note = text(req.body.note ?? req.body.reason, 500) || null;
  if (status === "Rejected" && !note) return invalid(res, "Rejecting an expense needs a reason.");
  if (status === "Approved" && existing.policyException && !hasGrant(req, "expenses", "approve_exception")) {
    return res.status(403).json({ code: "RBAC_FORBIDDEN", message: "This expense is a policy exception; approving it needs expenses:approve_exception." });
  }
  const updated = await prisma.expense.updateMany({
    where: { id: existing.id, version: existing.version, status: "Pending" },
    data: { status, reviewNote: note, rejectionReason: status === "Rejected" ? note : null, reviewedAt: new Date(), reviewedByMembershipId: who(req), version: { increment: 1 } },
  });
  if (updated.count !== 1) return versionConflict(res, "expense");
  await audit(req, status === "Approved" ? "finance.expense.approved" : "finance.expense.rejected", "Expense", existing.id, { reason: note });
  res.json({ expense: toApi(await prisma.expense.findUnique({ where: { id: existing.id } })) });
}

// Resolves the expense account: explicit, the category's starter account,
// then the organization's default expense account.
export async function expenseAccountFor(db, organizationId, expense, settings) {
  if (expense.expenseAccountId) return expense.expenseAccountId;
  const code = CATEGORY_ACCOUNT_CODES[expense.category];
  if (code) {
    const account = await db.ledgerAccount.findFirst({ where: { organizationId, code, archivedAt: null, postingAllowed: true } });
    if (account) return account.id;
  }
  if (settings.expenseAccountId) return settings.expenseAccountId;
  throw new LedgerError("No expense account is configured. Set up the chart of accounts under Finance → Settings first.");
}

// Journal lines for expenses: Dr expense (+ non-recoverable tax), Dr
// recoverable tax, Cr Employee Reimbursements Payable.
export async function expenseJournalLines(db, organizationId, expenses, settings) {
  if (!settings.employeePayableAccountId) throw new LedgerError("No Employee Reimbursements Payable account is configured in Finance settings.");
  const lines = [];
  let total = toMoney(0);
  for (const e of expenses) {
    const recoverable = e.taxSnapshot?.recoverable && toMoney(e.taxAmount).greaterThan(0);
    const expenseAmount = recoverable ? toMoney(e.amountBeforeTax) : toMoney(e.amount);
    lines.push({ accountId: await expenseAccountFor(db, organizationId, e, settings), debit: expenseAmount.toFixed(2), costCenterId: e.costCenterId, projectId: e.projectId, description: `${e.expenseNumber} ${e.description}`.slice(0, 500) });
    if (recoverable) {
      const taxAccount = (await db.taxRate.findFirst({ where: { id: e.taxRateId } }))?.purchaseAccountId || settings.taxRecoverableAccountId;
      if (!taxAccount) throw new LedgerError("No Tax Recoverable account is configured.");
      lines.push({ accountId: taxAccount, debit: toMoney(e.taxAmount).toFixed(2), taxRateId: e.taxRateId, taxSnapshot: e.taxSnapshot, description: `${e.expenseNumber} tax` });
    }
    total = total.plus(toMoney(e.amount));
  }
  lines.push({ accountId: settings.employeePayableAccountId, credit: total.toFixed(2), description: "Reimbursement owed to the submitter" });
  return lines;
}

// Posts a standalone approved expense (expenses in a report are posted
// with the report).
export async function post(req, res) {
  const expense = await loadExpense(req, res);
  if (!expense) return;
  if (expense.status !== "Approved") return badTransition(res, "Only an approved expense can be posted.");
  if (expense.expenseReportId) return badTransition(res, "Post this expense's report instead.");
  if (staleVersion(req.body, expense)) return versionConflict(res, "expense");
  const settings = await getSettings(prisma, req.organizationId);
  let journal;
  try {
    journal = await prisma.$transaction(async (tx) => {
      const lines = await expenseJournalLines(tx, req.organizationId, [expense], settings);
      const entry = await postSystemJournal(tx, {
        organizationId: req.organizationId, settings, entryDate: expense.date, description: `Expense ${expense.expenseNumber}: ${expense.description}`.slice(0, 500),
        sourceType: "Expense", sourceId: expense.id, reference: expense.expenseNumber, currency: expense.currency, lines, membershipId: who(req), canPostSoftClosed: canPostSoftClosed(req),
      });
      const updated = await tx.expense.updateMany({ where: { id: expense.id, version: expense.version, status: "Approved" }, data: { status: "Posted", journalEntryId: entry.id, version: { increment: 1 } } });
      if (updated.count !== 1) throw new LedgerError("This expense was changed by someone else. Refresh and try again.", { status: 409, code: "FINANCE_VERSION_CONFLICT" });
      return entry;
    });
  } catch (err) {
    if (err instanceof LedgerError) return sendLedgerError(res, err);
    throw err;
  }
  await audit(req, "finance.expense.posted", "Expense", expense.id, { after: { journalEntryId: journal.id, entryNumber: journal.entryNumber } });
  res.json({ expense: toApi(await prisma.expense.findUnique({ where: { id: expense.id } })), journalEntryNumber: journal.entryNumber });
}

// Records that the submitter was reimbursed (paid outside the CRM) and
// posts it: Dr Employee Reimbursements Payable, Cr the financial account.
export async function recordReimbursement(db, req, { sourceType, sourceId, reference, currency, amount, date, financialAccountId, settings }) {
  const account = await db.financialAccount.findFirst({ where: { id: financialAccountId, organizationId: req.organizationId, archivedAt: null } });
  if (!account) throw new LedgerError("financialAccountId must be an active financial account in this organization.");
  if (account.currency !== currency) throw new LedgerError(`That financial account holds ${account.currency}; this is in ${currency}.`);
  if (!settings.employeePayableAccountId) throw new LedgerError("No Employee Reimbursements Payable account is configured.");
  return postSystemJournal(db, {
    organizationId: req.organizationId, settings, entryDate: date, description: `Reimbursement recorded for ${reference} — no transfer was performed by the CRM`,
    sourceType, sourceId, reference, currency, membershipId: who(req), canPostSoftClosed: canPostSoftClosed(req),
    lines: [{ accountId: settings.employeePayableAccountId, debit: toMoney(amount).toFixed(2) }, { accountId: account.ledgerAccountId, credit: toMoney(amount).toFixed(2) }],
  });
}

export async function reimburse(req, res) {
  const expense = await loadExpense(req, res);
  if (!expense) return;
  if (expense.status !== "Posted") return badTransition(res, "Only a posted expense can be marked as reimbursed.");
  if (expense.expenseReportId) return badTransition(res, "Record the reimbursement on this expense's report.");
  let date;
  try { date = parseDay(req.body.date || new Date(), "date"); } catch (err) { return invalid(res, err.message); }
  const settings = await getSettings(prisma, req.organizationId);
  try {
    await prisma.$transaction(async (tx) => {
      const entry = await recordReimbursement(tx, req, { sourceType: "Expense", sourceId: expense.id, reference: expense.expenseNumber, currency: expense.currency, amount: expense.amount, date, financialAccountId: req.body.financialAccountId, settings });
      const updated = await tx.expense.updateMany({ where: { id: expense.id, version: expense.version, status: "Posted" }, data: { status: "Reimbursed Record", version: { increment: 1 } } });
      if (updated.count !== 1) throw new LedgerError("This expense was changed by someone else.", { status: 409, code: "FINANCE_VERSION_CONFLICT" });
      return entry;
    });
  } catch (err) {
    if (err instanceof LedgerError) return sendLedgerError(res, err);
    throw err;
  }
  await audit(req, "finance.expense.reimbursement_recorded", "Expense", expense.id, { reason: text(req.body.reference, 120) || null });
  res.json({ expense: toApi(await prisma.expense.findUnique({ where: { id: expense.id } })), note: "Recorded only — no bank or payment-provider transfer was performed." });
}

export async function cancel(req, res) {
  const expense = await loadExpense(req, res);
  if (!expense) return;
  if (expense.submittedByMembershipId !== who(req) && !hasGrant(req, "expenses", "approve")) return res.status(403).json({ code: "RBAC_FORBIDDEN", message: "Only the submitter or an approver can cancel an expense." });
  if (!["Draft", "Pending", "Rejected"].includes(expense.status)) return badTransition(res, `A ${expense.status.toLowerCase()} expense can't be cancelled.`);
  const reason = text(req.body.reason, 500);
  if (!reason) return invalid(res, "Cancelling an expense needs a reason.");
  const updated = await prisma.expense.updateMany({ where: { id: expense.id, version: expense.version }, data: { status: "Cancelled", rejectionReason: reason, expenseReportId: null, version: { increment: 1 } } });
  if (updated.count !== 1) return versionConflict(res, "expense");
  await audit(req, "finance.expense.cancelled", "Expense", expense.id, { reason });
  res.json({ expense: toApi(await prisma.expense.findUnique({ where: { id: expense.id } })) });
}

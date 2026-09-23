// Backend Phase 6 (full spec) — Expense reports: a submitter's expenses
// reviewed and posted together.
//
// Draft → Submitted → (Under Review) → Approved or Rejected → Posted →
// Reimbursed Record; or Cancelled. One currency per report (no mixed
// totals). The submitter can't approve their own report. Approval changes
// no ledger; posting is a separate step that creates one balanced journal.
import prisma from "../../lib/prisma.js";
import { toApi } from "../../utils/serialize.js";
import { hasGrant } from "../../utils/grants.js";
import { nextDocumentNumber } from "../../services/sales/documentNumberService.js";
import { toMoney } from "../../services/sales/moneyService.js";
import {
  invalid, notFound, badTransition, versionConflict, staleVersion, audit, parseDay, text, getSettings, checkSeparation,
} from "../../services/finance/financeCommon.js";
import { LedgerError, sendLedgerError, postSystemJournal } from "../../services/finance/ledgerService.js";
import { financeScopeWhere } from "./invoicesController.js";
import { expenseJournalLines, recordReimbursement } from "./expensesController.js";
import { canPostSoftClosed } from "./ledgerSetupController.js";

const who = (req) => req.membership?.id || null;
const INCLUDE = { expenses: { where: { archivedAt: null }, orderBy: { date: "asc" } } };

// Same scope as expenses: own, or the department's for managers.
const scopeWhere = (req) => {
  const where = financeScopeWhere(req, "expenses", "submittedByMembership", "submittedByMembershipId");
  if (where.submittedByMembershipId) return { submitterMembershipId: where.submittedByMembershipId };
  if (where.submittedByMembership) return { expenses: { some: where } };
  return {};
};

async function loadReport(req, res) {
  const report = await prisma.expenseReport.findFirst({ where: { id: req.params.reportId, organizationId: req.organizationId, ...scopeWhere(req) }, include: INCLUDE });
  if (!report) notFound(res, "Expense report");
  return report;
}

// Per-currency totals, recalculated from the included expenses.
export function reportTotals(expenses) {
  const totals = {};
  for (const e of expenses) totals[e.currency] = toMoney(totals[e.currency] || 0).plus(toMoney(e.amount)).toFixed(2);
  return totals;
}

const serialize = (report) => ({ ...toApi(report), currency: Object.keys(report.totals || {})[0] || null });

export async function listReports(req, res) {
  const where = { organizationId: req.organizationId, archivedAt: null, ...scopeWhere(req) };
  if (req.query.status) where.status = req.query.status;
  const reports = await prisma.expenseReport.findMany({ where, include: INCLUDE, orderBy: { createdAt: "desc" }, take: 200 });
  res.json({ expenseReports: reports.map(serialize) });
}

export async function getReport(req, res) {
  const report = await loadReport(req, res);
  if (report) res.json({ expenseReport: serialize(report) });
}

// Attaches the caller's own Draft/Pending/Rejected expenses, all in one currency.
async function attachable(req, expenseIds, reportId = null, existing = []) {
  if (!Array.isArray(expenseIds)) return [];
  const expenses = await prisma.expense.findMany({ where: { id: { in: expenseIds }, organizationId: req.organizationId, archivedAt: null } });
  if (expenses.length !== new Set(expenseIds).size) throw new RangeError("Some expenses weren't found.");
  for (const e of expenses) {
    if (e.submittedByMembershipId !== who(req)) throw new RangeError(`${e.expenseNumber} isn't yours.`);
    if (!["Draft", "Pending", "Rejected"].includes(e.status)) throw new RangeError(`${e.expenseNumber} is ${e.status.toLowerCase()} and can't be added.`);
    if (e.expenseReportId && e.expenseReportId !== reportId) throw new RangeError(`${e.expenseNumber} is already in another report.`);
  }
  const currencies = new Set([...existing, ...expenses].map((e) => e.currency));
  if (currencies.size > 1) throw new RangeError("A report holds one currency; put expenses in other currencies in a separate report.");
  return expenses;
}

export async function createReport(req, res) {
  const title = text(req.body.title, 200);
  if (!title) return invalid(res, "title is required.");
  let periodStart;
  let periodEnd;
  let expenses;
  try {
    periodStart = parseDay(req.body.periodStart, "periodStart", { required: false });
    periodEnd = parseDay(req.body.periodEnd, "periodEnd", { required: false });
    if (periodStart && periodEnd && periodEnd < periodStart) throw new RangeError("periodEnd must be on or after periodStart.");
    expenses = await attachable(req, req.body.expenseIds || []);
  } catch (err) {
    return invalid(res, err.message);
  }
  const report = await prisma.$transaction(async (tx) => {
    const reportNumber = await nextDocumentNumber(tx, req.organizationId, "ExpenseReport");
    const created = await tx.expenseReport.create({ data: { organizationId: req.organizationId, reportNumber, submitterMembershipId: who(req), title, description: text(req.body.description, 2000) || null, periodStart, periodEnd, totals: reportTotals(expenses) } });
    if (expenses.length) await tx.expense.updateMany({ where: { id: { in: expenses.map((e) => e.id) } }, data: { expenseReportId: created.id, status: "Draft", version: { increment: 1 } } });
    return created;
  });
  await audit(req, "finance.expense_report.created", "ExpenseReport", report.id, { after: { expenses: expenses.length } });
  res.status(201).json({ expenseReport: serialize(await prisma.expenseReport.findUnique({ where: { id: report.id }, include: INCLUDE })) });
}

// Replaces the report's expense list (Draft or Rejected reports only).
export async function setReportExpenses(req, res) {
  const report = await loadReport(req, res);
  if (!report) return;
  if (report.submitterMembershipId !== who(req)) return res.status(403).json({ code: "RBAC_FORBIDDEN", message: "Only the submitter can change a report." });
  if (!["Draft", "Rejected"].includes(report.status)) return badTransition(res, "Only a draft or rejected report can change.");
  if (staleVersion(req.body, report)) return versionConflict(res, "expense report");
  let expenses;
  try { expenses = await attachable(req, req.body.expenseIds || [], report.id); } catch (err) { return invalid(res, err.message); }
  const ok = await prisma.$transaction(async (tx) => {
    const updated = await tx.expenseReport.updateMany({ where: { id: report.id, version: report.version }, data: { totals: reportTotals(expenses), status: "Draft", version: { increment: 1 } } });
    if (updated.count !== 1) return false;
    await tx.expense.updateMany({ where: { expenseReportId: report.id, id: { notIn: expenses.map((e) => e.id) } }, data: { expenseReportId: null, version: { increment: 1 } } });
    await tx.expense.updateMany({ where: { id: { in: expenses.map((e) => e.id) } }, data: { expenseReportId: report.id, status: "Draft", version: { increment: 1 } } });
    return true;
  });
  if (!ok) return versionConflict(res, "expense report");
  await audit(req, "finance.expense_report.updated", "ExpenseReport", report.id, { after: { expenses: expenses.length } });
  res.json({ expenseReport: serialize(await prisma.expenseReport.findUnique({ where: { id: report.id }, include: INCLUDE })) });
}

async function move(req, res, report, from, data, expenseData, action, extra = {}) {
  const ok = await prisma.$transaction(async (tx) => {
    const updated = await tx.expenseReport.updateMany({ where: { id: report.id, version: report.version, status: { in: from } }, data: { ...data, version: { increment: 1 } } });
    if (updated.count !== 1) return false;
    if (expenseData) await tx.expense.updateMany({ where: { expenseReportId: report.id }, data: { ...expenseData, version: { increment: 1 } } });
    return true;
  });
  if (!ok) return versionConflict(res, "expense report");
  await audit(req, action, "ExpenseReport", report.id, { before: { status: report.status }, after: { status: data.status }, ...extra });
  res.json({ expenseReport: serialize(await prisma.expenseReport.findUnique({ where: { id: report.id }, include: INCLUDE })) });
}

export async function submitReport(req, res) {
  const report = await loadReport(req, res);
  if (!report) return;
  if (report.submitterMembershipId !== who(req)) return res.status(403).json({ code: "RBAC_FORBIDDEN", message: "Only the submitter can submit a report." });
  if (!["Draft", "Rejected"].includes(report.status)) return badTransition(res, `A ${report.status.toLowerCase()} report can't be submitted.`);
  if (!report.expenses.length) return invalid(res, "Add at least one expense first.");
  if (staleVersion(req.body, report)) return versionConflict(res, "expense report");
  return move(req, res, report, ["Draft", "Rejected"], { status: "Submitted", submittedAt: new Date(), rejectionReason: null, totals: reportTotals(report.expenses) }, { status: "Pending", submittedAt: new Date() }, "finance.expense_report.submitted");
}

export async function startReview(req, res) {
  const report = await loadReport(req, res);
  if (!report) return;
  if (report.status !== "Submitted") return badTransition(res, "Only a submitted report can be put under review.");
  return move(req, res, report, ["Submitted"], { status: "Under Review" }, null, "finance.expense_report.under_review");
}

export async function approveReport(req, res) {
  const report = await loadReport(req, res);
  if (!report) return;
  if (!["Submitted", "Under Review"].includes(report.status)) return badTransition(res, "Only a submitted report can be approved.");
  if (staleVersion(req.body, report)) return versionConflict(res, "expense report");
  const settings = await getSettings(prisma, req.organizationId);
  if (!(await checkSeparation(req, res, { settings, sameActor: report.submitterMembershipId === who(req), rule: "You can't approve your own expense report.", action: "expense_report.approve", targetType: "ExpenseReport", targetId: report.id }))) return;
  if (report.expenses.some((e) => e.policyException) && !hasGrant(req, "expenses", "approve_exception")) {
    return res.status(403).json({ code: "RBAC_FORBIDDEN", message: "This report has policy exceptions; approving it needs expenses:approve_exception." });
  }
  return move(req, res, report, ["Submitted", "Under Review"], { status: "Approved", approvedByMembershipId: who(req), approvedAt: new Date() }, { status: "Approved", reviewedByMembershipId: who(req), reviewedAt: new Date() }, "finance.expense_report.approved");
}

export async function rejectReport(req, res) {
  const report = await loadReport(req, res);
  if (!report) return;
  if (!["Submitted", "Under Review"].includes(report.status)) return badTransition(res, "Only a submitted report can be rejected.");
  const reason = text(req.body.reason, 500);
  if (!reason) return invalid(res, "Rejecting a report needs a reason.");
  const settings = await getSettings(prisma, req.organizationId);
  if (!(await checkSeparation(req, res, { settings, sameActor: report.submitterMembershipId === who(req), rule: "You can't reject your own expense report.", action: "expense_report.reject", targetType: "ExpenseReport", targetId: report.id }))) return;
  return move(req, res, report, ["Submitted", "Under Review"], { status: "Rejected", rejectedByMembershipId: who(req), rejectedAt: new Date(), rejectionReason: reason }, { status: "Rejected", rejectionReason: reason }, "finance.expense_report.rejected", { reason });
}

export async function postReport(req, res) {
  const report = await loadReport(req, res);
  if (!report) return;
  if (report.status !== "Approved") return badTransition(res, "Only an approved report can be posted.");
  if (staleVersion(req.body, report)) return versionConflict(res, "expense report");
  const settings = await getSettings(prisma, req.organizationId);
  const currency = report.expenses[0]?.currency;
  let journal;
  try {
    journal = await prisma.$transaction(async (tx) => {
      const lines = await expenseJournalLines(tx, req.organizationId, report.expenses, settings);
      const latest = report.expenses.reduce((d, e) => (e.date > d ? e.date : d), report.expenses[0].date);
      const entry = await postSystemJournal(tx, {
        organizationId: req.organizationId, settings, entryDate: latest, description: `Expense report ${report.reportNumber}: ${report.title}`.slice(0, 500),
        sourceType: "Expense Report", sourceId: report.id, reference: report.reportNumber, currency, lines, membershipId: who(req), canPostSoftClosed: canPostSoftClosed(req),
      });
      const updated = await tx.expenseReport.updateMany({ where: { id: report.id, version: report.version, status: "Approved" }, data: { status: "Posted", postedByMembershipId: who(req), postedAt: new Date(), journalEntryId: entry.id, version: { increment: 1 } } });
      if (updated.count !== 1) throw new LedgerError("This report was changed by someone else. Refresh and try again.", { status: 409, code: "FINANCE_VERSION_CONFLICT" });
      await tx.expense.updateMany({ where: { expenseReportId: report.id }, data: { status: "Posted", journalEntryId: entry.id, version: { increment: 1 } } });
      return entry;
    });
  } catch (err) {
    if (err instanceof LedgerError) return sendLedgerError(res, err);
    throw err;
  }
  await audit(req, "finance.expense_report.posted", "ExpenseReport", report.id, { after: { journalEntryId: journal.id, entryNumber: journal.entryNumber } });
  res.json({ expenseReport: serialize(await prisma.expenseReport.findUnique({ where: { id: report.id }, include: INCLUDE })), journalEntryNumber: journal.entryNumber });
}

export async function reimburseReport(req, res) {
  const report = await loadReport(req, res);
  if (!report) return;
  if (report.status !== "Posted") return badTransition(res, "Only a posted report can be marked as reimbursed.");
  let date;
  try { date = parseDay(req.body.date || new Date(), "date"); } catch (err) { return invalid(res, err.message); }
  const settings = await getSettings(prisma, req.organizationId);
  const currency = report.expenses[0]?.currency;
  const amount = report.expenses.reduce((s, e) => s.plus(toMoney(e.amount)), toMoney(0));
  const reference = text(req.body.reference, 120) || null;
  try {
    await prisma.$transaction(async (tx) => {
      await recordReimbursement(tx, req, { sourceType: "Expense Report", sourceId: report.id, reference: report.reportNumber, currency, amount, date, financialAccountId: req.body.financialAccountId, settings });
      const updated = await tx.expenseReport.updateMany({ where: { id: report.id, version: report.version, status: "Posted" }, data: { status: "Reimbursed Record", reimbursedByMembershipId: who(req), reimbursedAt: new Date(), reimbursementReference: reference, version: { increment: 1 } } });
      if (updated.count !== 1) throw new LedgerError("This report was changed by someone else.", { status: 409, code: "FINANCE_VERSION_CONFLICT" });
      await tx.expense.updateMany({ where: { expenseReportId: report.id }, data: { status: "Reimbursed Record", version: { increment: 1 } } });
    });
  } catch (err) {
    if (err instanceof LedgerError) return sendLedgerError(res, err);
    throw err;
  }
  await audit(req, "finance.expense_report.reimbursement_recorded", "ExpenseReport", report.id, { reason: reference });
  res.json({ expenseReport: serialize(await prisma.expenseReport.findUnique({ where: { id: report.id }, include: INCLUDE })), note: "Recorded only — no bank or payment-provider transfer was performed." });
}

export async function cancelReport(req, res) {
  const report = await loadReport(req, res);
  if (!report) return;
  if (report.submitterMembershipId !== who(req)) return res.status(403).json({ code: "RBAC_FORBIDDEN", message: "Only the submitter can cancel a report." });
  if (!["Draft", "Submitted", "Rejected"].includes(report.status)) return badTransition(res, `A ${report.status.toLowerCase()} report can't be cancelled.`);
  const reason = text(req.body.reason, 500);
  if (!reason) return invalid(res, "Cancelling a report needs a reason.");
  const ok = await prisma.$transaction(async (tx) => {
    const updated = await tx.expenseReport.updateMany({ where: { id: report.id, version: report.version }, data: { status: "Cancelled", cancelledReason: reason, version: { increment: 1 } } });
    if (updated.count !== 1) return false;
    // The expenses go back to the submitter as drafts.
    await tx.expense.updateMany({ where: { expenseReportId: report.id }, data: { expenseReportId: null, status: "Draft", version: { increment: 1 } } });
    return true;
  });
  if (!ok) return versionConflict(res, "expense report");
  await audit(req, "finance.expense_report.cancelled", "ExpenseReport", report.id, { reason });
  res.json({ expenseReport: serialize(await prisma.expenseReport.findUnique({ where: { id: report.id }, include: INCLUDE })) });
}

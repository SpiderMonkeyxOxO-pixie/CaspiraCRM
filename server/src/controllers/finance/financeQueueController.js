// Backend Phase 6 — the Finance work queue: everything waiting for a
// person to approve, post or reject, in one request. Each section appears
// only when the caller can view that kind of record; the actions listed
// are the ones their grants allow. Separation of duties is still enforced
// when they act — `ownRecord` just lets the screen say so up front.
import prisma from "../../lib/prisma.js";
import { hasGrant } from "../../utils/grants.js";
import { toMoney } from "../../services/sales/moneyService.js";
import { financeScopeWhere } from "./invoicesController.js";

const n = (d) => Number(toMoney(d).toFixed(2));
const TAKE = 100;

export async function workQueue(req, res) {
  const me = req.membership?.id || null;
  const can = (m, a) => hasGrant(req, m, a);
  const org = req.organizationId;
  const out = {};
  const tasks = [];
  const item = (kind, r, { number, title, amount, currency, status, createdBy, date, actions }) => ({
    kind, id: r.id, number, title, amount: amount === null || amount === undefined ? null : n(amount), currency, status, date,
    ownRecord: !!me && createdBy === me, actions: actions.filter(Boolean),
  });

  if (can("journals", "view")) tasks.push((async () => {
    const rows = await prisma.journalEntry.findMany({ where: { organizationId: org, status: { in: ["Draft", "Submitted", "Approved"] }, sourceType: { in: ["Manual", "Opening Balance", "Adjustment"] } }, orderBy: { entryDate: "asc" }, take: TAKE });
    out.journals = rows.map((r) => item("journal", r, {
      number: r.entryNumber, title: r.description, amount: r.totalDebit, currency: r.currency, status: r.status, createdBy: r.createdByMembershipId, date: r.entryDate,
      actions: [r.status === "Draft" && can("journals", "create") && "submit", r.status === "Submitted" && can("journals", "approve") && "approve", r.status === "Approved" && can("journals", "post") && "post", can("journals", "create") && "cancel"],
    }));
  })());
  if (can("invoices", "view")) tasks.push((async () => {
    const rows = await prisma.invoice.findMany({ where: { organizationId: org, archivedAt: null, status: { in: ["Draft", "Submitted", "Approved"] }, ...financeScopeWhere(req, "invoices", "createdByMembership", "createdByMembershipId") }, include: { company: { select: { name: true } } }, orderBy: { issueDate: "asc" }, take: TAKE });
    out.invoices = rows.map((r) => item("invoice", r, {
      number: r.invoiceNumber, title: r.company?.name || "No company", amount: r.total, currency: r.currency, status: r.status, createdBy: r.createdByMembershipId, date: r.issueDate,
      actions: [r.status !== "Approved" && can("invoices", "approve") && "approve", r.status === "Approved" && can("invoices", "post") && "post"],
    }));
  })());
  if (can("bills", "view")) tasks.push((async () => {
    const rows = await prisma.vendorBill.findMany({ where: { organizationId: org, archivedAt: null, status: { in: ["Draft", "Submitted", "Approved"] } }, include: { vendor: { include: { company: { select: { name: true } } } } }, orderBy: { billDate: "asc" }, take: TAKE });
    out.bills = rows.map((r) => item("bill", r, {
      number: r.billNumber, title: `${r.vendor?.company?.name || r.vendor?.vendorCode || "Vendor"} — ${r.vendorReference}`, amount: r.total, currency: r.currency, status: r.status, createdBy: r.createdByMembershipId, date: r.billDate,
      actions: [r.status === "Draft" && can("bills", "submit") && "submit", r.status === "Submitted" && can("bills", "approve") && "approve", r.status === "Approved" && can("bills", "post") && "post"],
    }));
  })());
  if (can("payments", "view")) tasks.push((async () => {
    const rows = await prisma.payment.findMany({ where: { organizationId: org, status: { in: ["Draft", "Submitted", "Approved"] } }, orderBy: { date: "asc" }, take: TAKE });
    out.payments = rows.map((r) => item("payment", r, {
      number: r.paymentNumber, title: `${r.direction} · ${r.method}`, amount: r.amount, currency: r.currency, status: r.status, createdBy: r.createdByMembershipId, date: r.date,
      actions: [r.status !== "Approved" && can("payments", "approve") && "approve", r.status === "Approved" && can("payments", "post") && "post", can("payments", "create") && "cancel"],
    }));
  })());
  if (can("invoices", "view") || can("credit_notes", "view")) tasks.push((async () => {
    const rows = await prisma.creditNote.findMany({ where: { organizationId: org, status: { in: ["Draft", "Submitted", "Approved"] } }, include: { invoice: { select: { invoiceNumber: true } } }, orderBy: { createdAt: "asc" }, take: TAKE });
    out.creditNotes = rows.map((r) => item("creditNote", r, {
      number: r.creditNoteNumber, title: `Against ${r.invoice?.invoiceNumber || "invoice"} — ${r.reason || ""}`, amount: r.amount, currency: r.currency, status: r.status, createdBy: r.createdByMembershipId, date: r.creditDate,
      actions: [r.status !== "Approved" && can("credit_notes", "approve") && "approve", r.status === "Approved" && can("credit_notes", "post") && "post", can("credit_notes", "create") && "cancel"],
    }));
  })());
  if (can("expenses", "view")) tasks.push((async () => {
    const scope = financeScopeWhere(req, "expenses", "submittedByMembership", "submittedByMembershipId");
    const expenses = await prisma.expense.findMany({ where: { organizationId: org, archivedAt: null, expenseReportId: null, status: { in: ["Pending", "Approved", "Posted"] }, ...scope }, orderBy: { date: "asc" }, take: TAKE });
    out.expenses = expenses.map((r) => item("expense", r, {
      number: r.expenseNumber, title: `${r.category} — ${r.description || ""}${r.policyException ? " (policy exception)" : ""}`, amount: r.amount, currency: r.currency, status: r.status, createdBy: r.submittedByMembershipId, date: r.date,
      actions: [r.status === "Pending" && can("expenses", "approve") && "approve", r.status === "Pending" && can("expenses", "reject") && "reject", r.status === "Approved" && can("expenses", "post") && "post", r.status === "Posted" && can("expenses", "reimburse") && "reimburse"],
    }));
    const reportScope = scope.submittedByMembershipId ? { submitterMembershipId: scope.submittedByMembershipId } : {};
    const reports = await prisma.expenseReport.findMany({ where: { organizationId: org, archivedAt: null, status: { in: ["Submitted", "Under Review", "Approved", "Posted"] }, ...reportScope }, orderBy: { createdAt: "asc" }, take: TAKE });
    out.expenseReports = reports.map((r) => {
      const [currency, amount] = Object.entries(r.totals || {})[0] || [null, null];
      return item("expenseReport", r, {
        number: r.reportNumber, title: r.title, amount, currency, status: r.status, createdBy: r.submitterMembershipId, date: r.submittedAt || r.createdAt,
        actions: [["Submitted", "Under Review"].includes(r.status) && can("expenses", "approve") && "approve", ["Submitted", "Under Review"].includes(r.status) && can("expenses", "reject") && "reject", r.status === "Approved" && can("expenses", "post") && "post", r.status === "Posted" && can("expenses", "reimburse") && "reimburse"],
      });
    });
  })());
  if (can("budgets", "view")) tasks.push((async () => {
    const versions = await prisma.budgetVersion.findMany({ where: { organizationId: org, status: { in: ["Submitted", "Approved"] } }, include: { budget: { select: { id: true, name: true, currency: true } } }, orderBy: { createdAt: "asc" }, take: TAKE });
    out.budgets = versions.map((v) => ({
      ...item("budgetVersion", v, { number: `v${v.versionNumber}`, title: v.budget.name, amount: v.total, currency: v.budget.currency, status: v.status, createdBy: v.createdByMembershipId, date: v.submittedAt || v.createdAt, actions: [v.status === "Submitted" && can("budgets", "approve") && "approve", v.status === "Submitted" && can("budgets", "approve") && "reject", v.status === "Approved" && can("budgets", "activate") && "activate"] }),
      budgetId: v.budget.id,
    }));
  })());
  if (can("reconciliation", "view")) tasks.push((async () => {
    const rows = await prisma.reconciliationSession.findMany({ where: { organizationId: org, status: "Submitted" }, take: TAKE });
    out.reconciliations = rows.map((r) => item("reconciliation", r, { number: r.periodEnd.toISOString().slice(0, 10), title: "Reconciliation awaiting approval", amount: r.difference, currency: null, status: r.status, createdBy: r.preparedByMembershipId, date: r.submittedAt, actions: [can("reconciliation", "approve") && "complete"] }));
  })());
  await Promise.all(tasks);
  res.json({ queue: out });
}

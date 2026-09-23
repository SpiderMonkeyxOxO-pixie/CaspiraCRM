import prisma from "../../lib/prisma.js";
import { toApi } from "../../utils/serialize.js";
import { recordAuditEvent, requestContext } from "../../services/auditService.js";
import { nextDocumentNumber } from "../../services/sales/documentNumberService.js";
import { round } from "../../services/sales/moneyService.js";
import { EXPENSE_CATEGORIES } from "../../services/finance/financeRulesService.js";
import { hasGrant } from "../../services/projects/projectRulesService.js";
import { financeScopeWhere } from "./invoicesController.js";

const MAX_PAGE_SIZE = 200;
const MAX_AMOUNT = 1_000_000;
const invalid = (res, message) => res.status(400).json({ code: "FINANCE_VALIDATION_FAILED", message });

// Department/Team scope: expenses submitted by members of the caller's
// department (so a manager can review them); narrower: the caller's own.
const scopeWhere = (req) => financeScopeWhere(req, "expenses", "submittedByMembership", "submittedByMembershipId");

async function audit(req, action, expenseId, extra = {}) {
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action, targetType: "Expense", targetId: expenseId, result: "Success", ...extra });
}

export async function list(req, res) {
  const q = req.query;
  const page = Math.max(1, Number(q.page) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(q.pageSize) || 50));
  const where = { organizationId: req.organizationId, ...scopeWhere(req) };
  if (q.status) where.status = q.status;
  if (q.category) where.category = q.category;
  if (q.submittedByMembershipId) where.submittedByMembershipId = q.submittedByMembershipId;
  const [expenses, total] = await Promise.all([
    prisma.expense.findMany({ where, orderBy: { date: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.expense.count({ where }),
  ]);
  res.json({ expenses: toApi(expenses), total, page, pageSize });
}

// Always Pending, always submitted by the caller.
export async function create(req, res) {
  const description = typeof req.body.description === "string" ? req.body.description.trim() : "";
  if (!description) return invalid(res, "A description is required.");
  const category = req.body.category || "Other";
  if (!EXPENSE_CATEGORIES.includes(category)) return invalid(res, `category must be one of ${EXPENSE_CATEGORIES.join(", ")}.`);
  const amount = Number(req.body.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) return invalid(res, "Enter an amount greater than 0.");
  const date = req.body.date ? new Date(req.body.date) : new Date();
  if (Number.isNaN(date.getTime())) return invalid(res, "date must be a valid date.");
  if (date > new Date()) return invalid(res, "An expense date can't be in the future.");
  const currency = req.body.currency || "USD";

  const expense = await prisma.$transaction(async (tx) => {
    const expenseNumber = await nextDocumentNumber(tx, req.organizationId, "Expense");
    return tx.expense.create({
      data: { organizationId: req.organizationId, expenseNumber, description, category, amount: round(amount, currency), currency, date, status: "Pending", submittedByMembershipId: req.membership?.id || null },
    });
  });
  await audit(req, "finance.expense.submitted", expense.id);
  res.status(201).json({ expense: toApi(expense) });
}

// POST /:id/review { status: "Approved" | "Rejected", note? } — needs the
// matching grant, only for a Pending expense, never your own.
export async function review(req, res) {
  const { status } = req.body;
  if (!["Approved", "Rejected"].includes(status)) return invalid(res, 'status must be "Approved" or "Rejected".');
  const action = status === "Approved" ? "approve" : "reject";
  if (!hasGrant(req, "expenses", action)) return res.status(403).json({ code: "RBAC_FORBIDDEN", message: `You don't have permission to ${action} expenses.` });
  const existing = await prisma.expense.findFirst({ where: { id: req.params.expenseId, organizationId: req.organizationId, ...scopeWhere(req) } });
  if (!existing) return res.status(404).json({ code: "FINANCE_RECORD_NOT_FOUND", message: "Expense not found." });
  if (existing.status !== "Pending") return res.status(400).json({ code: "FINANCE_INVALID_TRANSITION", message: `This expense has already been ${existing.status.toLowerCase()}.` });
  if (req.membership?.id && existing.submittedByMembershipId === req.membership.id) {
    return res.status(403).json({ code: "FINANCE_SEPARATION_OF_DUTIES", message: "You can't approve or reject your own expense." });
  }
  const note = typeof req.body.note === "string" && req.body.note.trim() ? req.body.note.trim() : null;
  const expense = await prisma.expense.update({
    where: { id: existing.id },
    data: { status, reviewNote: note, reviewedAt: new Date(), reviewedByMembershipId: req.membership?.id || null, version: { increment: 1 } },
  });
  await audit(req, status === "Approved" ? "finance.expense.approved" : "finance.expense.rejected", existing.id, { reason: note });
  res.json({ expense: toApi(expense) });
}

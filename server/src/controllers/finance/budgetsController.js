// Backend Phase 6 (full spec) — budgets with immutable versions.
//
// A budget belongs to a fiscal year and currency. Each version is Draft →
// Submitted → Approved (or Rejected) → Active → Superseded. Only a Draft
// version's lines change; a change after approval is a new version. The
// creator can't approve their own version. Activating a version supersedes
// the previously active one. Nothing is deleted, and activation creates no
// journals — a budget is a plan, not a transaction.
import prisma from "../../lib/prisma.js";
import { toApi } from "../../utils/serialize.js";
import { toMoney } from "../../services/sales/moneyService.js";
import {
  invalid, notFound, badTransition, versionConflict, staleVersion, audit, isCurrency, parseAmount, text, getSettings, checkSeparation,
} from "../../services/finance/financeCommon.js";

const who = (req) => req.membership?.id || null;
const INCLUDE = { versions: { orderBy: { versionNumber: "desc" }, include: { lines: true } }, fiscalYear: { select: { id: true, name: true, startDate: true, endDate: true } } };
const MAX_LINES = 2000;

async function loadBudget(req, res) {
  const budget = await prisma.budget.findFirst({ where: { id: req.params.budgetId, organizationId: req.organizationId }, include: INCLUDE });
  if (!budget) notFound(res, "Budget");
  return budget;
}

const serialize = (b) => toApi(b);

export async function listBudgets(req, res) {
  const where = { organizationId: req.organizationId, archivedAt: null };
  if (req.query.fiscalYearId) where.fiscalYearId = req.query.fiscalYearId;
  const budgets = await prisma.budget.findMany({ where, include: { fiscalYear: INCLUDE.fiscalYear }, orderBy: { createdAt: "desc" }, take: 200 });
  res.json({ budgets: budgets.map(serialize) });
}

export async function getBudget(req, res) {
  const budget = await loadBudget(req, res);
  if (budget) res.json({ budget: serialize(budget) });
}

// Validates budget lines against the organization and fiscal year.
async function budgetLines(req, rawLines, { currency, fiscalYearId }) {
  if (!Array.isArray(rawLines) || !rawLines.length) throw new RangeError("A budget version needs at least one line.");
  if (rawLines.length > MAX_LINES) throw new RangeError(`At most ${MAX_LINES} lines.`);
  const accountIds = [...new Set(rawLines.map((l) => l?.accountId))];
  const accounts = new Map((await prisma.ledgerAccount.findMany({ where: { organizationId: req.organizationId, id: { in: accountIds } } })).map((a) => [a.id, a]));
  const periods = new Set((await prisma.fiscalPeriod.findMany({ where: { fiscalYearId }, select: { id: true } })).map((p) => p.id));
  const ccIds = [...new Set(rawLines.map((l) => l?.costCenterId).filter(Boolean))];
  const costCenters = new Set((await prisma.costCenter.findMany({ where: { organizationId: req.organizationId, id: { in: ccIds } }, select: { id: true } })).map((c) => c.id));
  const projectIds = [...new Set(rawLines.map((l) => l?.projectId).filter(Boolean))];
  const projects = new Set((await prisma.project.findMany({ where: { organizationId: req.organizationId, id: { in: projectIds } }, select: { id: true } })).map((p) => p.id));
  return rawLines.map((l, i) => {
    const n = i + 1;
    const account = accounts.get(l.accountId);
    if (!account || !account.postingAllowed) throw new RangeError(`Line ${n}: accountId must be a postable account in this organization.`);
    if (!["Revenue", "Expense"].includes(account.type)) throw new RangeError(`Line ${n}: budgets plan revenue and expense accounts (${account.code} is ${account.type}).`);
    if (l.periodId && !periods.has(l.periodId)) throw new RangeError(`Line ${n}: periodId isn't a period of this budget's fiscal year.`);
    if (l.costCenterId && !costCenters.has(l.costCenterId)) throw new RangeError(`Line ${n}: costCenterId isn't in this organization.`);
    if (l.projectId && !projects.has(l.projectId)) throw new RangeError(`Line ${n}: projectId isn't in this organization.`);
    return {
      organizationId: req.organizationId, accountId: account.id, costCenterId: l.costCenterId || null, projectId: l.projectId || null, periodId: l.periodId || null,
      department: text(l.department, 80) || null, notes: text(l.notes, 500) || null,
      plannedAmount: parseAmount(l.plannedAmount, { field: `Line ${n} plannedAmount`, currency, allowZero: true }),
    };
  });
}

const total = (lines) => lines.reduce((s, l) => s.plus(toMoney(l.plannedAmount)), toMoney(0));

export async function createBudget(req, res) {
  const name = text(req.body.name, 120);
  if (!name) return invalid(res, "name is required.");
  const fiscalYear = await prisma.fiscalYear.findFirst({ where: { id: req.body.fiscalYearId, organizationId: req.organizationId } });
  if (!fiscalYear) return invalid(res, "fiscalYearId must be a fiscal year in this organization.");
  const settings = await getSettings(prisma, req.organizationId);
  const currency = req.body.currency || settings.baseCurrency;
  if (!isCurrency(currency)) return invalid(res, "currency must be an ISO 4217 code.");
  if (await prisma.budget.findFirst({ where: { organizationId: req.organizationId, name, fiscalYearId: fiscalYear.id } })) return invalid(res, `A budget named ${name} already exists for ${fiscalYear.name}.`);
  let lines;
  try { lines = await budgetLines(req, req.body.lines, { currency, fiscalYearId: fiscalYear.id }); } catch (err) { return invalid(res, err.message); }
  const budget = await prisma.$transaction(async (tx) => {
    const created = await tx.budget.create({ data: { organizationId: req.organizationId, name, fiscalYearId: fiscalYear.id, currency, department: text(req.body.department, 80) || null, ownerMembershipId: req.body.ownerMembershipId || who(req), createdByMembershipId: who(req) } });
    const version = await tx.budgetVersion.create({ data: { organizationId: req.organizationId, budgetId: created.id, versionNumber: 1, notes: text(req.body.notes, 1000) || null, total: total(lines), createdByMembershipId: who(req), lines: { create: lines.map(({ organizationId, ...l }) => ({ organizationId, ...l })) } } });
    return tx.budget.update({ where: { id: created.id }, data: { currentVersionId: version.id } });
  });
  await audit(req, "finance.budget.created", "Budget", budget.id, { after: { name, lines: lines.length } });
  res.status(201).json({ budget: serialize(await prisma.budget.findUnique({ where: { id: budget.id }, include: INCLUDE })) });
}

// A new version — a copy of the latest unless lines are given. Only one
// version can be in progress (Draft or Submitted) at a time.
export async function createVersion(req, res) {
  const budget = await loadBudget(req, res);
  if (!budget) return;
  if (budget.versions.some((v) => ["Draft", "Submitted"].includes(v.status))) return badTransition(res, "Finish or reject the version in progress first.");
  const latest = budget.versions[0];
  let lines;
  try {
    lines = req.body.lines
      ? await budgetLines(req, req.body.lines, { currency: budget.currency, fiscalYearId: budget.fiscalYearId })
      : latest.lines.map(({ id, budgetVersionId, ...l }) => l);
  } catch (err) {
    return invalid(res, err.message);
  }
  const version = await prisma.$transaction(async (tx) => {
    const v = await tx.budgetVersion.create({ data: { organizationId: req.organizationId, budgetId: budget.id, versionNumber: latest.versionNumber + 1, notes: text(req.body.notes, 1000) || null, total: total(lines), createdByMembershipId: who(req), lines: { create: lines } } });
    await tx.budget.update({ where: { id: budget.id }, data: { currentVersionId: v.id, status: "Draft", version: { increment: 1 } } });
    return v;
  });
  await audit(req, "finance.budget.version_created", "Budget", budget.id, { after: { versionNumber: version.versionNumber } });
  res.status(201).json({ budget: serialize(await prisma.budget.findUnique({ where: { id: budget.id }, include: INCLUDE })) });
}

async function loadVersion(req, res, budget) {
  const version = budget.versions.find((v) => v.id === req.params.versionId);
  if (!version) notFound(res, "Budget version");
  return version;
}

// Only a Draft version's lines can change; approved versions are immutable.
export async function updateVersion(req, res) {
  const budget = await loadBudget(req, res);
  if (!budget) return;
  const version = await loadVersion(req, res, budget);
  if (!version) return;
  if (version.status !== "Draft") return badTransition(res, "Only a draft version can change; create a new version instead.");
  if (staleVersion(req.body, budget)) return versionConflict(res, "budget");
  let lines;
  try { lines = await budgetLines(req, req.body.lines, { currency: budget.currency, fiscalYearId: budget.fiscalYearId }); } catch (err) { return invalid(res, err.message); }
  const ok = await prisma.$transaction(async (tx) => {
    const touched = await tx.budget.updateMany({ where: { id: budget.id, version: budget.version }, data: { version: { increment: 1 } } });
    if (touched.count !== 1) return false;
    await tx.budgetLine.deleteMany({ where: { budgetVersionId: version.id } });
    await tx.budgetLine.createMany({ data: lines.map((l) => ({ ...l, budgetVersionId: version.id })) });
    await tx.budgetVersion.update({ where: { id: version.id }, data: { total: total(lines), notes: "notes" in req.body ? text(req.body.notes, 1000) || null : version.notes } });
    return true;
  });
  if (!ok) return versionConflict(res, "budget");
  await audit(req, "finance.budget.version_updated", "Budget", budget.id, { after: { versionNumber: version.versionNumber, lines: lines.length } });
  res.json({ budget: serialize(await prisma.budget.findUnique({ where: { id: budget.id }, include: INCLUDE })) });
}

async function moveVersion(req, res, budget, version, from, data, budgetStatus, action, extra = {}) {
  const ok = await prisma.$transaction(async (tx) => {
    const updated = await tx.budgetVersion.updateMany({ where: { id: version.id, status: { in: from } }, data });
    if (updated.count !== 1) return false;
    const touched = await tx.budget.updateMany({ where: { id: budget.id, version: budget.version }, data: { status: budgetStatus, version: { increment: 1 } } });
    return touched.count === 1;
  });
  if (!ok) return versionConflict(res, "budget");
  await audit(req, action, "Budget", budget.id, { before: { versionStatus: version.status }, after: { versionNumber: version.versionNumber, versionStatus: data.status }, ...extra });
  res.json({ budget: serialize(await prisma.budget.findUnique({ where: { id: budget.id }, include: INCLUDE })) });
}

export async function submitVersion(req, res) {
  const budget = await loadBudget(req, res);
  if (!budget) return;
  const version = await loadVersion(req, res, budget);
  if (!version) return;
  if (version.status !== "Draft") return badTransition(res, "Only a draft version can be submitted.");
  return moveVersion(req, res, budget, version, ["Draft"], { status: "Submitted", submittedAt: new Date() }, "Submitted", "finance.budget.submitted");
}

export async function approveVersion(req, res) {
  const budget = await loadBudget(req, res);
  if (!budget) return;
  const version = await loadVersion(req, res, budget);
  if (!version) return;
  if (staleVersion(req.body, budget)) return versionConflict(res, "budget");
  if (version.status !== "Submitted") return badTransition(res, "Only a submitted version can be approved.");
  const settings = await getSettings(prisma, req.organizationId);
  if (!(await checkSeparation(req, res, { settings, sameActor: version.createdByMembershipId === who(req), rule: "The person who prepared a budget version can't approve it.", action: "budget.approve", targetType: "Budget", targetId: budget.id }))) return;
  return moveVersion(req, res, budget, version, ["Submitted"], { status: "Approved", approvedByMembershipId: who(req), approvedAt: new Date() }, "Approved", "finance.budget.approved");
}

export async function rejectVersion(req, res) {
  const budget = await loadBudget(req, res);
  if (!budget) return;
  const version = await loadVersion(req, res, budget);
  if (!version) return;
  if (version.status !== "Submitted") return badTransition(res, "Only a submitted version can be rejected.");
  const reason = text(req.body.reason, 500);
  if (!reason) return invalid(res, "Rejecting a budget version needs a reason.");
  return moveVersion(req, res, budget, version, ["Submitted"], { status: "Rejected", rejectionReason: reason }, budget.activeVersionId ? "Active" : "Draft", "finance.budget.rejected", { reason });
}

// Approved → Active; the previously active version becomes Superseded.
export async function activateVersion(req, res) {
  const budget = await loadBudget(req, res);
  if (!budget) return;
  const version = await loadVersion(req, res, budget);
  if (!version) return;
  if (staleVersion(req.body, budget)) return versionConflict(res, "budget");
  if (version.status !== "Approved") return badTransition(res, "Only an approved version can be activated.");
  const ok = await prisma.$transaction(async (tx) => {
    const touched = await tx.budget.updateMany({ where: { id: budget.id, version: budget.version }, data: { status: "Active", activeVersionId: version.id, version: { increment: 1 } } });
    if (touched.count !== 1) return false;
    await tx.budgetVersion.updateMany({ where: { budgetId: budget.id, status: "Active" }, data: { status: "Superseded" } });
    await tx.budgetVersion.update({ where: { id: version.id }, data: { status: "Active", activatedByMembershipId: who(req), activatedAt: new Date() } });
    return true;
  });
  if (!ok) return versionConflict(res, "budget");
  await audit(req, "finance.budget.activated", "Budget", budget.id, { after: { versionNumber: version.versionNumber, superseded: budget.activeVersionId || null } });
  res.json({ budget: serialize(await prisma.budget.findUnique({ where: { id: budget.id }, include: INCLUDE })), note: "Activated. No journals were created." });
}

export async function archiveBudget(req, res) {
  const budget = await loadBudget(req, res);
  if (!budget) return;
  if (budget.archivedAt) return badTransition(res, "Already archived.");
  const reason = text(req.body.reason, 500);
  if (!reason) return invalid(res, "Archiving a budget needs a reason.");
  await prisma.budget.update({ where: { id: budget.id }, data: { status: "Archived", archivedAt: new Date(), version: { increment: 1 } } });
  await audit(req, "finance.budget.archived", "Budget", budget.id, { reason });
  res.json({ budget: serialize(await prisma.budget.findUnique({ where: { id: budget.id }, include: INCLUDE })) });
}

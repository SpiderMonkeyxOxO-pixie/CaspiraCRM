// Backend Phase 6 (full spec) — Finance setup: settings, the chart of
// accounts (and its optional starter template), fiscal years and periods,
// cost centers, tax rates and manual exchange rates.
//
// The organization is the finance entity: the frontend has no multiple
// legal entities, so one organization = one ledger, and ledgers never mix.
import prisma from "../../lib/prisma.js";
import { toApi } from "../../utils/serialize.js";
import { hasGrant } from "../../utils/grants.js";
import { toMoney } from "../../services/sales/moneyService.js";
import {
  invalid, notFound, badTransition, versionConflict, staleVersion, audit, isCurrency, parseDay, text, getSettings, checkSeparation,
} from "../../services/finance/financeCommon.js";
import { ACCOUNT_TYPES, NORMAL_BALANCE } from "../../services/finance/ledgerService.js";

const who = (req) => req.membership?.id || null;
const MAX_PAGE_SIZE = 200;

// ---- Settings -------------------------------------------------------------

const SETTINGS_ACCOUNT_FIELDS = ["receivableAccountId", "payableAccountId", "revenueAccountId", "expenseAccountId", "taxPayableAccountId", "taxRecoverableAccountId", "employeePayableAccountId"];

export async function getFinanceSettings(req, res) {
  const settings = await getSettings(prisma, req.organizationId);
  res.json({ settings: toApi(settings) });
}

export async function updateFinanceSettings(req, res) {
  const current = await getSettings(prisma, req.organizationId);
  if (current.persisted !== false && staleVersion(req.body, current)) return versionConflict(res, "finance configuration");
  const data = {};
  if ("baseCurrency" in req.body) {
    if (!isCurrency(req.body.baseCurrency)) return invalid(res, "baseCurrency must be an ISO 4217 code such as USD.");
    const posted = await prisma.journalEntry.count({ where: { organizationId: req.organizationId, status: { in: ["Posted", "Reversed"] } } });
    if (posted && req.body.baseCurrency !== current.baseCurrency) return badTransition(res, "The base currency can't change once journals are posted.");
    data.baseCurrency = req.body.baseCurrency;
  }
  for (const f of ["separationOfDuties", "journalApprovalRequired"]) if (f in req.body) data[f] = req.body[f] === true;
  for (const f of ["invoiceApprovalThreshold", "expensePolicyLimit"]) {
    if (!(f in req.body)) continue;
    if (req.body[f] === null && f === "expensePolicyLimit") { data[f] = null; continue; }
    const n = toMoney(Number(req.body[f]));
    if (!Number.isFinite(Number(req.body[f])) || n.isNegative()) return invalid(res, `${f} must be a positive amount.`);
    data[f] = n;
  }
  for (const f of SETTINGS_ACCOUNT_FIELDS) {
    if (!(f in req.body)) continue;
    if (req.body[f] === null) { data[f] = null; continue; }
    const account = await prisma.ledgerAccount.findFirst({ where: { id: req.body[f], organizationId: req.organizationId, archivedAt: null, postingAllowed: true } });
    if (!account) return invalid(res, `${f} must be an active, postable account in this organization.`);
    data[f] = account.id;
  }
  const settings = await prisma.financeSettings.upsert({
    where: { organizationId: req.organizationId },
    create: { organizationId: req.organizationId, ...data, updatedByMembershipId: who(req) },
    update: { ...data, updatedByMembershipId: who(req), version: { increment: 1 } },
  });
  // Relaxing separation of duties is itself a control change auditors see.
  await audit(req, "finance.settings.updated", "FinanceSettings", settings.id, { before: { separationOfDuties: current.separationOfDuties, journalApprovalRequired: current.journalApprovalRequired, baseCurrency: current.baseCurrency }, after: data });
  res.json({ settings: toApi(settings) });
}

// A starter chart of accounts — created only when a person asks for it, and
// only accounts whose code is still free (re-running adds nothing twice).
export const STARTER_CHART = [
  { code: "1000", name: "Assets", type: "Asset", header: true },
  { code: "1010", name: "Cash on Hand", type: "Asset", subtype: "Cash", parent: "1000" },
  { code: "1020", name: "Bank Accounts", type: "Asset", subtype: "Bank", parent: "1000" },
  { code: "1100", name: "Accounts Receivable", type: "Asset", subtype: "Receivable", parent: "1000", setting: "receivableAccountId" },
  { code: "1200", name: "Tax Recoverable", type: "Asset", subtype: "Tax Recoverable", parent: "1000", setting: "taxRecoverableAccountId" },
  { code: "2000", name: "Liabilities", type: "Liability", header: true },
  { code: "2100", name: "Accounts Payable", type: "Liability", subtype: "Payable", parent: "2000", setting: "payableAccountId" },
  { code: "2200", name: "Tax Payable", type: "Liability", subtype: "Tax Payable", parent: "2000", setting: "taxPayableAccountId" },
  { code: "2300", name: "Employee Reimbursements Payable", type: "Liability", subtype: "Employee Payable", parent: "2000", setting: "employeePayableAccountId" },
  { code: "3000", name: "Equity", type: "Equity", header: true },
  { code: "3100", name: "Owner's Equity", type: "Equity", parent: "3000" },
  { code: "3900", name: "Opening Balance Equity", type: "Equity", parent: "3000" },
  { code: "4000", name: "Revenue", type: "Revenue", header: true },
  { code: "4100", name: "Sales Revenue", type: "Revenue", parent: "4000", setting: "revenueAccountId" },
  { code: "4900", name: "Other Income", type: "Revenue", parent: "4000" },
  { code: "5000", name: "Cost of Sales", type: "Expense", header: true },
  { code: "5100", name: "Cost of Goods Sold", type: "Expense", parent: "5000" },
  { code: "6000", name: "Operating Expenses", type: "Expense", header: true },
  { code: "6100", name: "Travel", type: "Expense", parent: "6000" },
  { code: "6200", name: "Software", type: "Expense", parent: "6000" },
  { code: "6300", name: "Office Supplies", type: "Expense", parent: "6000" },
  { code: "6400", name: "Meals", type: "Expense", parent: "6000" },
  { code: "6900", name: "Other Expenses", type: "Expense", parent: "6000", setting: "expenseAccountId" },
];

export async function initializeChart(req, res) {
  if (req.body?.confirm !== true) {
    const existing = await prisma.ledgerAccount.findMany({ where: { organizationId: req.organizationId }, select: { code: true } });
    const taken = new Set(existing.map((a) => a.code));
    return res.json({ preview: STARTER_CHART.map((a) => ({ ...a, willCreate: !taken.has(a.code) })), note: "Send confirm: true to create the accounts marked willCreate." });
  }
  const result = await prisma.$transaction(async (tx) => {
    const byCode = new Map((await tx.ledgerAccount.findMany({ where: { organizationId: req.organizationId } })).map((a) => [a.code, a]));
    let created = 0;
    for (const def of STARTER_CHART) {
      if (byCode.has(def.code)) continue;
      const account = await tx.ledgerAccount.create({
        data: {
          organizationId: req.organizationId, code: def.code, name: def.name, type: def.type, subtype: def.subtype || null,
          normalBalance: NORMAL_BALANCE[def.type], postingAllowed: !def.header, parentId: def.parent ? byCode.get(def.parent)?.id || null : null,
          createdByMembershipId: who(req),
        },
      });
      byCode.set(def.code, account);
      created += 1;
    }
    const current = await tx.financeSettings.findUnique({ where: { organizationId: req.organizationId } });
    const defaults = {};
    for (const def of STARTER_CHART) if (def.setting && !current?.[def.setting]) defaults[def.setting] = byCode.get(def.code).id;
    await tx.financeSettings.upsert({
      where: { organizationId: req.organizationId },
      create: { organizationId: req.organizationId, ...defaults, updatedByMembershipId: who(req) },
      update: Object.keys(defaults).length ? { ...defaults, updatedByMembershipId: who(req), version: { increment: 1 } } : {},
    });
    return { created, defaults: Object.keys(defaults) };
  });
  await audit(req, "finance.chart.initialized", "FinanceSettings", req.organizationId, { after: result });
  res.status(201).json(result);
}

export async function listOverrides(req, res) {
  const overrides = await prisma.financeOverride.findMany({ where: { organizationId: req.organizationId }, orderBy: { createdAt: "desc" }, take: 200 });
  res.json({ overrides: toApi(overrides) });
}

// ---- Fiscal years and periods ---------------------------------------------

const addMonths = (d, n) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, d.getUTCDate()));
const dayBefore = (d) => new Date(d.getTime() - 86400000);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Monthly periods from start to end (inclusive). Pure.
export function monthlyPeriods(startDate, endDate) {
  const periods = [];
  let start = startDate;
  for (let n = 1; start <= endDate; n += 1) {
    const next = addMonths(startDate, n);
    const end = dayBefore(next) > endDate ? endDate : dayBefore(next);
    periods.push({ periodNumber: n, name: `${MONTHS[start.getUTCMonth()]} ${start.getUTCFullYear()}`, startDate: start, endDate: end });
    start = next;
  }
  return periods;
}

export async function listFiscalYears(req, res) {
  const years = await prisma.fiscalYear.findMany({ where: { organizationId: req.organizationId }, include: { periods: { orderBy: { periodNumber: "asc" } } }, orderBy: { startDate: "desc" } });
  res.json({ fiscalYears: toApi(years) });
}

export async function createFiscalYear(req, res) {
  let startDate;
  let endDate;
  try {
    startDate = parseDay(req.body.startDate, "startDate");
    endDate = req.body.endDate ? parseDay(req.body.endDate, "endDate") : dayBefore(addMonths(startDate, 12));
  } catch (err) {
    return invalid(res, err.message);
  }
  if (startDate.getUTCDate() !== 1) return invalid(res, "A fiscal year starts on the first day of a month (periods are monthly).");
  if (endDate <= startDate) return invalid(res, "endDate must be after startDate.");
  if (endDate > dayBefore(addMonths(startDate, 24))) return invalid(res, "A fiscal year can be at most 24 months long.");
  const name = text(req.body.name, 60) || `FY ${startDate.getUTCFullYear()}${endDate.getUTCFullYear() !== startDate.getUTCFullYear() ? `/${endDate.getUTCFullYear()}` : ""}`;
  const overlap = await prisma.fiscalYear.findFirst({ where: { organizationId: req.organizationId, startDate: { lte: endDate }, endDate: { gte: startDate } } });
  if (overlap) return invalid(res, `It overlaps fiscal year ${overlap.name}.`);
  if (await prisma.fiscalYear.findFirst({ where: { organizationId: req.organizationId, name } })) return invalid(res, `A fiscal year named ${name} already exists.`);
  const periods = monthlyPeriods(startDate, endDate);
  const year = await prisma.fiscalYear.create({
    data: {
      organizationId: req.organizationId, name, startDate, endDate, createdByMembershipId: who(req),
      periods: { create: periods.map((p) => ({ organizationId: req.organizationId, ...p })) },
    },
    include: { periods: { orderBy: { periodNumber: "asc" } } },
  });
  await audit(req, "finance.fiscal_year.created", "FiscalYear", year.id, { after: { name, startDate, endDate, periods: periods.length } });
  res.status(201).json({ fiscalYear: toApi(year) });
}

async function loadPeriod(req, res) {
  const period = await prisma.fiscalPeriod.findFirst({ where: { id: req.params.periodId, organizationId: req.organizationId } });
  if (!period) notFound(res, "Fiscal period");
  return period;
}

async function movePeriod(req, res, period, data, action) {
  const updated = await prisma.fiscalPeriod.updateMany({ where: { id: period.id, version: period.version, status: period.status }, data: { ...data, version: { increment: 1 } } });
  if (updated.count !== 1) return versionConflict(res, "fiscal period");
  const saved = await prisma.fiscalPeriod.findUnique({ where: { id: period.id } });
  await audit(req, action, "FiscalPeriod", period.id, { before: { status: period.status }, after: { status: saved.status }, reason: data.reopenReason || null });
  res.json({ period: toApi(saved) });
}

// Soft close: the preparer's step. Postings then need fiscal_periods:post.
export async function softClosePeriod(req, res) {
  const period = await loadPeriod(req, res);
  if (!period) return;
  if (staleVersion(req.body, period)) return versionConflict(res, "fiscal period");
  if (!["Open", "Reopened"].includes(period.status)) return badTransition(res, `A ${period.status.toLowerCase()} period can't be soft-closed.`);
  return movePeriod(req, res, period, { status: "Soft Closed", softClosedByMembershipId: who(req), softClosedAt: new Date() }, "finance.period.soft_closed");
}

// Close: a different person from the preparer; journals still waiting for
// approval or posting in the period must be dealt with first.
export async function closePeriod(req, res) {
  const period = await loadPeriod(req, res);
  if (!period) return;
  if (staleVersion(req.body, period)) return versionConflict(res, "fiscal period");
  if (period.status !== "Soft Closed") return badTransition(res, "Soft-close the period first; the close is a separate step.");
  const pending = await prisma.journalEntry.count({ where: { organizationId: req.organizationId, entryDate: { gte: period.startDate, lte: period.endDate }, status: { in: ["Submitted", "Approved"] } } });
  if (pending) return badTransition(res, `${pending} journal(s) dated in this period are still waiting for approval or posting. Post or cancel them first.`);
  const settings = await getSettings(prisma, req.organizationId);
  if (!(await checkSeparation(req, res, { settings, sameActor: period.softClosedByMembershipId === who(req), rule: "The person who soft-closed a period can't also close it.", action: "period.close", targetType: "FiscalPeriod", targetId: period.id }))) return;
  return movePeriod(req, res, period, { status: "Closed", closedByMembershipId: who(req), closedAt: new Date() }, "finance.period.closed");
}

export async function reopenPeriod(req, res) {
  const period = await loadPeriod(req, res);
  if (!period) return;
  if (staleVersion(req.body, period)) return versionConflict(res, "fiscal period");
  if (!["Closed", "Soft Closed"].includes(period.status)) return badTransition(res, "Only a closed or soft-closed period can be reopened.");
  const reason = text(req.body.reason, 500);
  if (!reason) return invalid(res, "Reopening a period needs a reason.");
  return movePeriod(req, res, period, { status: "Reopened", reopenedByMembershipId: who(req), reopenedAt: new Date(), reopenReason: reason }, "finance.period.reopened");
}

// ---- Chart of accounts ----------------------------------------------------

const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9.-]{0,19}$/;

async function hasActivity(accountId) {
  return (await prisma.journalLine.count({ where: { accountId } })) > 0;
}

// Would making `parentId` the parent of `id` create a loop?
async function createsCycle(model, id, parentId) {
  let cursor = parentId;
  for (let depth = 0; cursor && depth < 50; depth += 1) {
    if (cursor === id) return true;
    cursor = (await prisma[model].findUnique({ where: { id: cursor }, select: { parentId: true } }))?.parentId;
  }
  return false;
}

export async function listAccounts(req, res) {
  const where = { organizationId: req.organizationId };
  if (req.query.type) where.type = req.query.type;
  if (req.query.includeArchived !== "true") where.archivedAt = null;
  if (req.query.search) where.OR = [{ code: { contains: req.query.search, mode: "insensitive" } }, { name: { contains: req.query.search, mode: "insensitive" } }];
  const accounts = await prisma.ledgerAccount.findMany({ where, orderBy: { code: "asc" }, take: 1000 });
  res.json({ accounts: toApi(accounts) });
}

export async function createAccount(req, res) {
  const code = text(req.body.code, 20);
  const name = text(req.body.name, 120);
  const { type } = req.body;
  if (!CODE_RE.test(code)) return invalid(res, "code must be 1–20 letters, digits, dots or dashes.");
  if (!name) return invalid(res, "name is required.");
  if (!ACCOUNT_TYPES.includes(type)) return invalid(res, `type must be one of ${ACCOUNT_TYPES.join(", ")}.`);
  const normalBalance = req.body.normalBalance || NORMAL_BALANCE[type];
  if (!["Debit", "Credit"].includes(normalBalance)) return invalid(res, "normalBalance must be Debit or Credit.");
  if (req.body.currency && !isCurrency(req.body.currency)) return invalid(res, "currency must be an ISO 4217 code.");
  let parentId = null;
  if (req.body.parentId) {
    const parent = await prisma.ledgerAccount.findFirst({ where: { id: req.body.parentId, organizationId: req.organizationId } });
    if (!parent) return invalid(res, "parentId must be an account in this organization.");
    if (parent.type !== type) return invalid(res, "A sub-account must have the same type as its parent.");
    if (parent.postingAllowed) return invalid(res, "The parent must be a header account (postingAllowed: false).");
    parentId = parent.id;
  }
  if (await prisma.ledgerAccount.findFirst({ where: { organizationId: req.organizationId, code } })) return invalid(res, `Account code ${code} is already used.`);
  const account = await prisma.ledgerAccount.create({
    data: {
      organizationId: req.organizationId, code, name, description: text(req.body.description) || null, type, subtype: text(req.body.subtype, 40) || null,
      parentId, normalBalance, currency: req.body.currency || null, postingAllowed: req.body.postingAllowed !== false, createdByMembershipId: who(req),
    },
  });
  await audit(req, "finance.account.created", "LedgerAccount", account.id, { after: { code, name, type } });
  res.status(201).json({ account: toApi(account) });
}

export async function updateAccount(req, res) {
  const account = await prisma.ledgerAccount.findFirst({ where: { id: req.params.accountId, organizationId: req.organizationId } });
  if (!account) return notFound(res, "Account");
  if (staleVersion(req.body, account)) return versionConflict(res, "account");
  const active = await hasActivity(account.id);
  const data = {};
  if ("name" in req.body) { data.name = text(req.body.name, 120); if (!data.name) return invalid(res, "name can't be empty."); }
  if ("description" in req.body) data.description = text(req.body.description) || null;
  if ("subtype" in req.body) data.subtype = text(req.body.subtype, 40) || null;
  if ("active" in req.body) data.active = req.body.active === true;
  for (const locked of ["type", "normalBalance", "currency", "code"]) {
    if (locked in req.body && req.body[locked] !== account[locked]) {
      if (active || locked === "code") return badTransition(res, locked === "code" ? "An account's code can't change; create a new account instead." : `${locked} is locked once the account has journal lines.`);
      if (locked === "type") { if (!ACCOUNT_TYPES.includes(req.body.type)) return invalid(res, "Invalid type."); data.type = req.body.type; }
      if (locked === "normalBalance") { if (!["Debit", "Credit"].includes(req.body.normalBalance)) return invalid(res, "Invalid normalBalance."); data.normalBalance = req.body.normalBalance; }
      if (locked === "currency") { if (req.body.currency && !isCurrency(req.body.currency)) return invalid(res, "Invalid currency."); data.currency = req.body.currency || null; }
    }
  }
  if ("postingAllowed" in req.body && req.body.postingAllowed !== account.postingAllowed) {
    if (req.body.postingAllowed === false && active) return badTransition(res, "An account with journal lines can't become a header account.");
    if (req.body.postingAllowed === true && (await prisma.ledgerAccount.count({ where: { parentId: account.id } }))) return badTransition(res, "A header account with sub-accounts can't take postings.");
    data.postingAllowed = req.body.postingAllowed === true;
  }
  if ("parentId" in req.body) {
    if (req.body.parentId) {
      const parent = await prisma.ledgerAccount.findFirst({ where: { id: req.body.parentId, organizationId: req.organizationId } });
      if (!parent) return invalid(res, "parentId must be an account in this organization.");
      if (parent.postingAllowed) return invalid(res, "The parent must be a header account.");
      if (parent.type !== (data.type || account.type)) return invalid(res, "A sub-account must have the same type as its parent.");
      if (await createsCycle("ledgerAccount", account.id, parent.id)) return invalid(res, "That parent would create a loop.");
      data.parentId = parent.id;
    } else data.parentId = null;
  }
  const updated = await prisma.ledgerAccount.update({ where: { id: account.id }, data: { ...data, updatedByMembershipId: who(req), version: { increment: 1 } } });
  await audit(req, "finance.account.updated", "LedgerAccount", account.id, { before: { name: account.name, active: account.active }, after: data });
  res.json({ account: toApi(updated) });
}

// Archived accounts take no new lines but stay in every report.
export async function archiveAccount(req, res) {
  const account = await prisma.ledgerAccount.findFirst({ where: { id: req.params.accountId, organizationId: req.organizationId } });
  if (!account) return notFound(res, "Account");
  if (account.archivedAt) return badTransition(res, "This account is already archived.");
  const reason = text(req.body.reason, 500);
  if (!reason) return invalid(res, "Archiving an account needs a reason.");
  const settings = await prisma.financeSettings.findUnique({ where: { organizationId: req.organizationId } });
  const usedAs = SETTINGS_ACCOUNT_FIELDS.find((f) => settings?.[f] === account.id);
  if (usedAs) return badTransition(res, `This account is the default for ${usedAs}; choose another default first.`);
  const updated = await prisma.ledgerAccount.update({ where: { id: account.id }, data: { archivedAt: new Date(), archiveReason: reason, active: false, version: { increment: 1 } } });
  await audit(req, "finance.account.archived", "LedgerAccount", account.id, { reason });
  res.json({ account: toApi(updated) });
}

// ---- Cost centers ---------------------------------------------------------

export async function listCostCenters(req, res) {
  const where = { organizationId: req.organizationId, ...(req.query.includeArchived === "true" ? {} : { archivedAt: null }) };
  res.json({ costCenters: toApi(await prisma.costCenter.findMany({ where, orderBy: { code: "asc" }, take: 1000 })) });
}

async function costCenterFields(req, existing = null) {
  const data = {};
  if (!existing || "code" in req.body) {
    const code = text(req.body.code, 20);
    if (!CODE_RE.test(code)) throw new RangeError("code must be 1–20 letters, digits, dots or dashes.");
    if (existing && code !== existing.code) throw new RangeError("A cost center's code can't change.");
    data.code = code;
  }
  if (!existing || "name" in req.body) { data.name = text(req.body.name, 120); if (!data.name) throw new RangeError("name is required."); }
  if ("description" in req.body) data.description = text(req.body.description) || null;
  if ("department" in req.body) data.department = text(req.body.department, 80) || null;
  if ("active" in req.body) data.active = req.body.active === true;
  if ("projectId" in req.body) {
    if (req.body.projectId && !(await prisma.project.findFirst({ where: { id: req.body.projectId, organizationId: req.organizationId } }))) throw new RangeError("projectId must be a project in this organization.");
    data.projectId = req.body.projectId || null;
  }
  if ("ownerMembershipId" in req.body) {
    if (req.body.ownerMembershipId && !(await prisma.organizationMembership.findFirst({ where: { id: req.body.ownerMembershipId, organizationId: req.organizationId } }))) throw new RangeError("ownerMembershipId must be a member of this organization.");
    data.ownerMembershipId = req.body.ownerMembershipId || null;
  }
  for (const f of ["effectiveFrom", "effectiveTo"]) if (f in req.body) data[f] = parseDay(req.body[f], f, { required: false });
  const from = data.effectiveFrom ?? existing?.effectiveFrom;
  const to = data.effectiveTo ?? existing?.effectiveTo;
  if (from && to && to < from) throw new RangeError("effectiveTo must be on or after effectiveFrom.");
  if ("parentId" in req.body) {
    if (req.body.parentId) {
      if (!(await prisma.costCenter.findFirst({ where: { id: req.body.parentId, organizationId: req.organizationId } }))) throw new RangeError("parentId must be a cost center in this organization.");
      if (existing && (await createsCycle("costCenter", existing.id, req.body.parentId))) throw new RangeError("That parent would create a loop.");
    }
    data.parentId = req.body.parentId || null;
  }
  return data;
}

export async function createCostCenter(req, res) {
  let data;
  try { data = await costCenterFields(req); } catch (err) { return invalid(res, err.message); }
  if (await prisma.costCenter.findFirst({ where: { organizationId: req.organizationId, code: data.code } })) return invalid(res, `Cost center code ${data.code} is already used.`);
  const costCenter = await prisma.costCenter.create({ data: { organizationId: req.organizationId, ...data } });
  await audit(req, "finance.cost_center.created", "CostCenter", costCenter.id, { after: data });
  res.status(201).json({ costCenter: toApi(costCenter) });
}

export async function updateCostCenter(req, res) {
  const existing = await prisma.costCenter.findFirst({ where: { id: req.params.costCenterId, organizationId: req.organizationId } });
  if (!existing) return notFound(res, "Cost center");
  if (staleVersion(req.body, existing)) return versionConflict(res, "cost center");
  let data;
  try { data = await costCenterFields(req, existing); } catch (err) { return invalid(res, err.message); }
  delete data.code;
  const costCenter = await prisma.costCenter.update({ where: { id: existing.id }, data: { ...data, version: { increment: 1 } } });
  await audit(req, "finance.cost_center.updated", "CostCenter", existing.id, { after: data });
  res.json({ costCenter: toApi(costCenter) });
}

export async function archiveCostCenter(req, res) {
  const existing = await prisma.costCenter.findFirst({ where: { id: req.params.costCenterId, organizationId: req.organizationId } });
  if (!existing) return notFound(res, "Cost center");
  if (existing.archivedAt) return badTransition(res, "Already archived.");
  const costCenter = await prisma.costCenter.update({ where: { id: existing.id }, data: { archivedAt: new Date(), active: false, version: { increment: 1 } } });
  await audit(req, "finance.cost_center.archived", "CostCenter", existing.id, { reason: text(req.body.reason, 500) || null });
  res.json({ costCenter: toApi(costCenter) });
}

// ---- Tax rates ------------------------------------------------------------
// No compliance claim and no rate fetching: a tax rate is what a person
// enters. Documents keep a snapshot, so later edits never alter history.

export async function listTaxRates(req, res) {
  res.json({ taxRates: toApi(await prisma.taxRate.findMany({ where: { organizationId: req.organizationId }, orderBy: { code: "asc" } })) });
}

async function taxRateFields(req, existing = null) {
  const data = {};
  if (!existing) {
    data.code = text(req.body.code, 20);
    if (!CODE_RE.test(data.code)) throw new RangeError("code must be 1–20 letters, digits, dots or dashes.");
  }
  if (!existing || "name" in req.body) { data.name = text(req.body.name, 80); if (!data.name) throw new RangeError("name is required."); }
  if (!existing || "rateBasisPoints" in req.body) {
    const bp = Number(req.body.rateBasisPoints);
    if (!Number.isInteger(bp) || bp < 0 || bp > 10000) throw new RangeError("rateBasisPoints must be a whole number from 0 to 10000 (1200 = 12%).");
    data.rateBasisPoints = bp;
  }
  if ("type" in req.body) { if (!["Sales", "Purchase", "Both"].includes(req.body.type)) throw new RangeError("type must be Sales, Purchase or Both."); data.type = req.body.type; }
  for (const f of ["recoverable", "inclusive", "active"]) if (f in req.body) data[f] = req.body[f] === true;
  for (const f of ["effectiveFrom", "effectiveTo"]) if (f in req.body) data[f] = parseDay(req.body[f], f, { required: false });
  for (const f of ["salesAccountId", "purchaseAccountId"]) {
    if (!(f in req.body)) continue;
    if (req.body[f] && !(await prisma.ledgerAccount.findFirst({ where: { id: req.body[f], organizationId: req.organizationId, postingAllowed: true } }))) throw new RangeError(`${f} must be a postable account in this organization.`);
    data[f] = req.body[f] || null;
  }
  return data;
}

export async function createTaxRate(req, res) {
  let data;
  try { data = await taxRateFields(req); } catch (err) { return invalid(res, err.message); }
  if (await prisma.taxRate.findFirst({ where: { organizationId: req.organizationId, code: data.code } })) return invalid(res, `Tax code ${data.code} is already used.`);
  const taxRate = await prisma.taxRate.create({ data: { organizationId: req.organizationId, ...data } });
  await audit(req, "finance.tax_rate.created", "TaxRate", taxRate.id, { after: data });
  res.status(201).json({ taxRate: toApi(taxRate) });
}

export async function updateTaxRate(req, res) {
  const existing = await prisma.taxRate.findFirst({ where: { id: req.params.taxRateId, organizationId: req.organizationId } });
  if (!existing) return notFound(res, "Tax rate");
  if (staleVersion(req.body, existing)) return versionConflict(res, "tax rate");
  let data;
  try { data = await taxRateFields(req, existing); } catch (err) { return invalid(res, err.message); }
  const taxRate = await prisma.taxRate.update({ where: { id: existing.id }, data: { ...data, version: { increment: 1 } } });
  await audit(req, "finance.tax_rate.updated", "TaxRate", existing.id, { before: { rateBasisPoints: existing.rateBasisPoints }, after: data });
  res.json({ taxRate: toApi(taxRate) });
}

// ---- Exchange rates (manual) ----------------------------------------------

export async function listExchangeRates(req, res) {
  const where = { organizationId: req.organizationId };
  if (req.query.currency) where.OR = [{ baseCurrency: req.query.currency }, { quoteCurrency: req.query.currency }];
  const rates = await prisma.exchangeRate.findMany({ where, orderBy: { effectiveDate: "desc" }, take: MAX_PAGE_SIZE });
  res.json({ exchangeRates: toApi(rates) });
}

export async function createExchangeRate(req, res) {
  const { baseCurrency, quoteCurrency } = req.body;
  if (!isCurrency(baseCurrency) || !isCurrency(quoteCurrency)) return invalid(res, "baseCurrency and quoteCurrency must be ISO 4217 codes.");
  if (baseCurrency === quoteCurrency) return invalid(res, "The two currencies must differ.");
  const rateText = String(req.body.rate ?? "").trim();
  if (!/^\d+(\.\d{1,10})?$/.test(rateText) || !toMoney(rateText).greaterThan(0)) return invalid(res, "rate must be a positive number with at most 10 decimals.");
  const source = text(req.body.source, 200);
  if (!source) return invalid(res, "source is required — say where the rate came from (it is never fetched automatically).");
  let effectiveDate;
  try { effectiveDate = parseDay(req.body.effectiveDate, "effectiveDate"); } catch (err) { return invalid(res, err.message); }
  const rate = await prisma.exchangeRate.create({ data: { organizationId: req.organizationId, baseCurrency, quoteCurrency, rate: toMoney(rateText), effectiveDate, source, enteredByMembershipId: who(req) } });
  await audit(req, "finance.exchange_rate.created", "ExchangeRate", rate.id, { after: { baseCurrency, quoteCurrency, rate: rateText, effectiveDate, source } });
  res.status(201).json({ exchangeRate: toApi(rate) });
}

export async function approveExchangeRate(req, res) {
  const rate = await prisma.exchangeRate.findFirst({ where: { id: req.params.rateId, organizationId: req.organizationId } });
  if (!rate) return notFound(res, "Exchange rate");
  if (rate.status !== "Draft") return badTransition(res, `A ${rate.status.toLowerCase()} rate can't be approved.`);
  const settings = await getSettings(prisma, req.organizationId);
  if (!(await checkSeparation(req, res, { settings, sameActor: rate.enteredByMembershipId === who(req), rule: "The person who entered an exchange rate can't approve it.", action: "exchange_rate.approve", targetType: "ExchangeRate", targetId: rate.id }))) return;
  const updated = await prisma.exchangeRate.updateMany({ where: { id: rate.id, version: rate.version, status: "Draft" }, data: { status: "Approved", approvedByMembershipId: who(req), approvedAt: new Date(), version: { increment: 1 } } });
  if (updated.count !== 1) return versionConflict(res, "exchange rate");
  await audit(req, "finance.exchange_rate.approved", "ExchangeRate", rate.id);
  res.json({ exchangeRate: toApi(await prisma.exchangeRate.findUnique({ where: { id: rate.id } })) });
}

export const canPostSoftClosed = (req) => hasGrant(req, "fiscal_periods", "post");

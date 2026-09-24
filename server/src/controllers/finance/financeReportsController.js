// Backend Phase 6 (full spec) — Finance reports.
//
// Official statements (P&L, Balance Sheet, Cash Flow, Trial Balance,
// General Ledger, journal register, revenue by period, tax summary) use
// POSTED journals only, in the base currency. Document reports (aging,
// invoice/bill status, overdue, recorded payments, exposure) use the
// documents and keep every currency separate — never one blended total.
// Each report says what it is, its date or period, its source and its
// definition. Nothing here is audited or claims IFRS/GAAP/tax compliance.
import prisma from "../../lib/prisma.js";
import { toMoney } from "../../services/sales/moneyService.js";
import { getSettings, parseDay, invalid } from "../../services/finance/financeCommon.js";
import { NORMAL_BALANCE } from "../../services/finance/ledgerService.js";

const LEDGER_SOURCE = "Posted journals (reversals included, so reversed entries net to zero)";
const DOC_SOURCE = "Finance documents (per currency)";
const POSTED = ["Posted", "Reversed"];
const n = (d) => Number(toMoney(d).toFixed(2));
const DAY = 86400000;

function meta(report, settings, extra) {
  return { report, generatedAt: new Date().toISOString(), baseCurrency: settings.baseCurrency, notAudited: true, disclaimer: "Operational report — not audited, and no IFRS, GAAP or tax-compliance claim.", ...extra };
}

function range(req) {
  const from = parseDay(req.query.from || `${new Date().getUTCFullYear()}-01-01`, "from");
  const to = parseDay(req.query.to || new Date(), "to");
  if (to < from) throw new RangeError("to must be on or after from.");
  return { from, to };
}

// Posted base-currency totals per account for entries matching `entryWhere`.
async function accountTotals(organizationId, entryWhere) {
  const rows = await prisma.journalLine.groupBy({ by: ["accountId"], where: { organizationId, journalEntry: { status: { in: POSTED }, ...entryWhere } }, _sum: { baseDebit: true, baseCredit: true } });
  const accounts = await prisma.ledgerAccount.findMany({ where: { organizationId } });
  const byId = new Map(accounts.map((a) => [a.id, a]));
  return rows.map((r) => {
    const a = byId.get(r.accountId);
    const debit = toMoney(r._sum.baseDebit);
    const credit = toMoney(r._sum.baseCredit);
    const natural = (a.normalBalance || NORMAL_BALANCE[a.type]) === "Debit" ? debit.minus(credit) : credit.minus(debit);
    return { accountId: a.id, code: a.code, name: a.name, type: a.type, subtype: a.subtype, archived: !!a.archivedAt, debit, credit, balance: natural };
  }).sort((x, y) => x.code.localeCompare(y.code));
}

const sum = (rows, f = "balance") => rows.reduce((s, r) => s.plus(r[f]), toMoney(0));
const out = (r) => ({ ...r, debit: n(r.debit), credit: n(r.credit), balance: n(r.balance) });

async function trialBalance(req, settings) {
  const asOf = parseDay(req.query.asOf || new Date(), "asOf");
  const rows = await accountTotals(req.organizationId, { entryDate: { lte: asOf } });
  const totalDebit = sum(rows, "debit");
  const totalCredit = sum(rows, "credit");
  return { meta: meta("Trial Balance", settings, { asOf, source: LEDGER_SOURCE, definition: "Total posted debits and credits per account up to the date, in the base currency." }), rows: rows.map(out), totals: { debit: n(totalDebit), credit: n(totalCredit), balanced: totalDebit.equals(totalCredit) } };
}

async function profitAndLoss(req, settings) {
  const { from, to } = range(req);
  const rows = (await accountTotals(req.organizationId, { entryDate: { gte: from, lte: to } })).filter((r) => ["Revenue", "Expense"].includes(r.type));
  const revenue = rows.filter((r) => r.type === "Revenue");
  const expenses = rows.filter((r) => r.type === "Expense");
  return {
    meta: meta("Profit & Loss", settings, { from, to, source: LEDGER_SOURCE, definition: "Revenue minus expenses from posted journals dated in the period." }),
    revenue: revenue.map(out), expenses: expenses.map(out), totals: { revenue: n(sum(revenue)), expenses: n(sum(expenses)), netIncome: n(sum(revenue).minus(sum(expenses))) },
  };
}

async function balanceSheet(req, settings) {
  const asOf = parseDay(req.query.asOf || new Date(), "asOf");
  const rows = await accountTotals(req.organizationId, { entryDate: { lte: asOf } });
  const pick = (t) => rows.filter((r) => r.type === t);
  const earnings = sum(pick("Revenue")).minus(sum(pick("Expense")));
  const assets = sum(pick("Asset"));
  const liabilities = sum(pick("Liability"));
  const equity = sum(pick("Equity")).plus(earnings);
  return {
    meta: meta("Balance Sheet", settings, { asOf, source: LEDGER_SOURCE, definition: "Assets, liabilities and equity at the date. Equity includes accumulated earnings (all revenue minus expenses to date) because there is no closing entry to retained earnings." }),
    assets: pick("Asset").map(out), liabilities: pick("Liability").map(out), equity: [...pick("Equity").map(out), { code: "—", name: "Accumulated earnings (unclosed)", balance: n(earnings) }],
    totals: { assets: n(assets), liabilities: n(liabilities), equity: n(equity), balanced: assets.equals(liabilities.plus(equity)) },
  };
}

// Direct method on cash and bank accounts (subtype Cash/Bank, or the
// ledger accounts behind financial accounts), classified by the other side
// of each journal: revenue/receivables/expenses/payables/tax → operating;
// other assets → investing; other liabilities and equity → financing.
async function cashFlow(req, settings) {
  const { from, to } = range(req);
  const accounts = await prisma.ledgerAccount.findMany({ where: { organizationId: req.organizationId } });
  const fa = await prisma.financialAccount.findMany({ where: { organizationId: req.organizationId }, select: { ledgerAccountId: true } });
  const cashIds = new Set([...accounts.filter((a) => ["Cash", "Bank"].includes(a.subtype)).map((a) => a.id), ...fa.map((f) => f.ledgerAccountId)]);
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const entries = await prisma.journalEntry.findMany({ where: { organizationId: req.organizationId, status: { in: POSTED }, entryDate: { gte: from, lte: to }, lines: { some: { accountId: { in: [...cashIds] } } } }, include: { lines: true } });
  const buckets = { Operating: toMoney(0), Investing: toMoney(0), Financing: toMoney(0) };
  for (const e of entries) {
    const cash = e.lines.filter((l) => cashIds.has(l.accountId)).reduce((s, l) => s.plus(toMoney(l.baseDebit)).minus(toMoney(l.baseCredit)), toMoney(0));
    if (cash.isZero()) continue;
    const other = e.lines.filter((l) => !cashIds.has(l.accountId)).map((l) => byId.get(l.accountId));
    const operating = other.some((a) => ["Revenue", "Expense"].includes(a.type) || ["Receivable", "Payable", "Tax Payable", "Tax Recoverable", "Employee Payable"].includes(a.subtype));
    const cls = operating ? "Operating" : other.some((a) => a.type === "Asset") ? "Investing" : "Financing";
    buckets[cls] = buckets[cls].plus(cash);
  }
  const net = buckets.Operating.plus(buckets.Investing).plus(buckets.Financing);
  return { meta: meta("Cash Flow", settings, { from, to, source: LEDGER_SOURCE, definition: "Direct method: movement on cash and bank accounts, classified by the other side of each posted journal. Transfers between cash accounts net to zero." }), operating: n(buckets.Operating), investing: n(buckets.Investing), financing: n(buckets.Financing), netChange: n(net) };
}

async function generalLedger(req, settings) {
  const { from, to } = range(req);
  const account = await prisma.ledgerAccount.findFirst({ where: { id: req.query.accountId, organizationId: req.organizationId } });
  if (!account) throw new RangeError("accountId is required and must be an account in this organization.");
  const debitNormal = account.normalBalance === "Debit";
  const signed = (d, c) => (debitNormal ? toMoney(d).minus(toMoney(c)) : toMoney(c).minus(toMoney(d)));
  const opening = await prisma.journalLine.aggregate({ where: { accountId: account.id, journalEntry: { status: { in: POSTED }, entryDate: { lt: from } } }, _sum: { baseDebit: true, baseCredit: true } });
  let running = signed(opening._sum.baseDebit, opening._sum.baseCredit);
  const openingBalance = running;
  const lines = await prisma.journalLine.findMany({ where: { accountId: account.id, journalEntry: { status: { in: POSTED }, entryDate: { gte: from, lte: to } } }, include: { journalEntry: { select: { entryNumber: true, entryDate: true, description: true, sourceType: true, reference: true } } }, orderBy: [{ journalEntry: { entryDate: "asc" } }, { journalEntry: { entryNumber: "asc" } }], take: 5000 });
  const rows = lines.map((l) => {
    running = running.plus(signed(l.baseDebit, l.baseCredit));
    return { date: l.journalEntry.entryDate, entryNumber: l.journalEntry.entryNumber, description: l.description || l.journalEntry.description, sourceType: l.journalEntry.sourceType, debit: n(l.baseDebit), credit: n(l.baseCredit), balance: n(running) };
  });
  return { meta: meta("General Ledger", settings, { from, to, source: LEDGER_SOURCE, definition: "Every posted line on the account with a running balance in its normal direction." }), account: { code: account.code, name: account.name, type: account.type }, openingBalance: n(openingBalance), rows, closingBalance: n(running) };
}

async function journalRegister(req, settings) {
  const { from, to } = range(req);
  const entries = await prisma.journalEntry.findMany({ where: { organizationId: req.organizationId, status: { in: POSTED }, entryDate: { gte: from, lte: to } }, orderBy: [{ entryDate: "asc" }, { entryNumber: "asc" }], take: 2000, select: { entryNumber: true, entryDate: true, description: true, sourceType: true, reference: true, currency: true, totalDebit: true, status: true, reversalOfId: true } });
  return { meta: meta("Journal Register", settings, { from, to, source: LEDGER_SOURCE, definition: "Posted journals in the period, in the transaction currency." }), rows: entries.map((e) => ({ ...e, totalDebit: n(e.totalDebit) })) };
}

async function revenueByPeriod(req, settings) {
  const { from, to } = range(req);
  const lines = await prisma.journalLine.findMany({ where: { organizationId: req.organizationId, account: { type: "Revenue" }, journalEntry: { status: { in: POSTED }, entryDate: { gte: from, lte: to } } }, select: { baseDebit: true, baseCredit: true, journalEntry: { select: { entryDate: true } } } });
  const months = new Map();
  for (const l of lines) {
    const m = l.journalEntry.entryDate.toISOString().slice(0, 7);
    months.set(m, (months.get(m) || toMoney(0)).plus(toMoney(l.baseCredit)).minus(toMoney(l.baseDebit)));
  }
  return { meta: meta("Revenue by Period", settings, { from, to, source: LEDGER_SOURCE, definition: "Net posted revenue (credits minus debits on revenue accounts) per calendar month." }), rows: [...months.entries()].sort().map(([month, amount]) => ({ month, revenue: n(amount) })) };
}

async function expensesBreakdown(req, settings) {
  const { from, to } = range(req);
  const expenses = await prisma.expense.findMany({ where: { organizationId: req.organizationId, status: { in: ["Posted", "Reimbursed Record"] }, date: { gte: from, lte: to } }, select: { category: true, currency: true, amount: true, projectId: true, submittedByMembership: { select: { user: { select: { department: true } } } } } });
  const group = (key) => {
    const m = new Map();
    for (const e of expenses) {
      const k = `${key(e) || "Unassigned"}|${e.currency}`;
      m.set(k, (m.get(k) || toMoney(0)).plus(toMoney(e.amount)));
    }
    return [...m.entries()].map(([k, v]) => { const [name, currency] = k.split("|"); return { name, currency, amount: n(v) }; });
  };
  const projects = new Map((await prisma.project.findMany({ where: { organizationId: req.organizationId, id: { in: [...new Set(expenses.map((e) => e.projectId).filter(Boolean))] } }, select: { id: true, name: true } })).map((p) => [p.id, p.name]));
  return {
    meta: meta("Expenses by Category, Department and Project", settings, { from, to, source: "Posted expense records (per currency)", definition: "Posted or reimbursed expenses dated in the period. Department is the submitter's." }),
    byCategory: group((e) => e.category), byDepartment: group((e) => e.submittedByMembership?.user?.department), byProject: group((e) => projects.get(e.projectId)),
  };
}

// Aging buckets by days past due at `asOf`: Current (not yet due), 1–30,
// 31–60, 61–90, 90+. Void, written-off and fully paid documents excluded.
export function agingBucket(dueDate, asOf) {
  if (!dueDate) return "Current";
  const days = Math.floor((asOf.getTime() - new Date(dueDate).getTime()) / DAY);
  if (days <= 0) return "Current";
  if (days <= 30) return "1–30";
  if (days <= 60) return "31–60";
  if (days <= 90) return "61–90";
  return "90+";
}
const BUCKETS = ["Current", "1–30", "31–60", "61–90", "90+"];

function aging(docs, asOf, nameOf) {
  const byCurrency = {};
  const rows = docs.map((d) => {
    const bucket = agingBucket(d.dueDate, asOf);
    byCurrency[d.currency] ||= Object.fromEntries(BUCKETS.map((b) => [b, toMoney(0)]));
    byCurrency[d.currency][bucket] = byCurrency[d.currency][bucket].plus(toMoney(d.amountDue));
    return { number: d.number, party: nameOf(d), dueDate: d.dueDate, currency: d.currency, amountDue: n(d.amountDue), bucket };
  });
  const totals = Object.fromEntries(Object.entries(byCurrency).map(([c, b]) => [c, Object.fromEntries(Object.entries(b).map(([k, v]) => [k, n(v)]))]));
  return { rows, totals };
}

async function receivablesAging(req, settings) {
  const asOf = parseDay(req.query.asOf || new Date(), "asOf");
  const invoices = await prisma.invoice.findMany({ where: { organizationId: req.organizationId, status: { in: ["Posted", "Sent", "Partially Paid", "Disputed"] }, amountDue: { gt: 0 } }, include: { company: { select: { name: true } } } });
  return { meta: meta("Receivables Aging", settings, { asOf, source: DOC_SOURCE, definition: "Posted invoices with an amount due, by days past due at the date: Current = not yet due; 1–30, 31–60, 61–90, 90+ days. Void, written-off and paid invoices excluded." }), ...aging(invoices.map((i) => ({ ...i, number: i.invoiceNumber })), asOf, (d) => d.company?.name || "—") };
}

async function payablesAging(req, settings) {
  const asOf = parseDay(req.query.asOf || new Date(), "asOf");
  const bills = await prisma.vendorBill.findMany({ where: { organizationId: req.organizationId, status: { in: ["Posted", "Partially Paid", "Disputed"] }, amountDue: { gt: 0 } }, include: { vendor: { include: { company: { select: { name: true } } } } } });
  return { meta: meta("Payables Aging", settings, { asOf, source: DOC_SOURCE, definition: "Posted bills with an amount due, bucketed like receivables aging." }), ...aging(bills.map((b) => ({ ...b, number: b.billNumber })), asOf, (d) => d.vendor?.company?.name || d.vendor?.vendorCode) };
}

async function statusSummary(model, organizationId, extraWhere = {}) {
  const rows = await prisma[model].groupBy({ by: ["status", "currency"], where: { organizationId, ...extraWhere }, _count: { _all: true }, _sum: { total: true, amountDue: true } });
  return rows.map((r) => ({ status: r.status, currency: r.currency, count: r._count._all, total: n(r._sum.total), amountDue: n(r._sum.amountDue) }));
}

async function invoiceStatus(req, settings) {
  return { meta: meta("Invoice Status", settings, { source: DOC_SOURCE, definition: "Invoices by stored status and currency. Draft, Approved and Posted are separate rows; only posted invoices are in the ledger." }), rows: await statusSummary("invoice", req.organizationId, { archivedAt: null }) };
}

async function overdueInvoices(req, settings) {
  const asOf = parseDay(req.query.asOf || new Date(), "asOf");
  const rows = await prisma.invoice.findMany({ where: { organizationId: req.organizationId, status: { in: ["Posted", "Sent", "Partially Paid"] }, dueDate: { lt: asOf }, amountDue: { gt: 0 } }, include: { company: { select: { name: true } } }, orderBy: { dueDate: "asc" } });
  return { meta: meta("Overdue Invoices", settings, { asOf, source: DOC_SOURCE, definition: "Posted invoices past their due date with an amount still due." }), rows: rows.map((i) => ({ invoiceNumber: i.invoiceNumber, company: i.company?.name || null, dueDate: i.dueDate, daysOverdue: Math.floor((asOf - i.dueDate) / DAY), currency: i.currency, amountDue: n(i.amountDue) })) };
}

async function billStatus(req, settings) {
  return { meta: meta("Bill Status", settings, { source: DOC_SOURCE, definition: "Vendor bills by stored status and currency." }), rows: await statusSummary("vendorBill", req.organizationId, { archivedAt: null }) };
}

async function recordedPayments(req, settings) {
  const { from, to } = range(req);
  const rows = await prisma.payment.groupBy({ by: ["direction", "status", "currency"], where: { organizationId: req.organizationId, date: { gte: from, lte: to } }, _count: { _all: true }, _sum: { amount: true } });
  return { meta: meta("Recorded Payments", settings, { from, to, source: DOC_SOURCE, definition: "Payments recorded in the CRM by direction, status and currency. Recorded payment — no bank or payment-provider transfer was performed." }), rows: rows.map((r) => ({ direction: r.direction, status: r.status, currency: r.currency, count: r._count._all, amount: n(r._sum.amount) })) };
}

async function budgetVsActual(req, settings) {
  const budget = await prisma.budget.findFirst({ where: { id: req.query.budgetId, organizationId: req.organizationId }, include: { fiscalYear: true } });
  if (!budget) throw new RangeError("budgetId is required and must be a budget in this organization.");
  if (!budget.activeVersionId) throw new RangeError("This budget has no active version.");
  const version = await prisma.budgetVersion.findUnique({ where: { id: budget.activeVersionId }, include: { lines: { include: { account: true } } } });
  const actual = await accountTotals(req.organizationId, { entryDate: { gte: budget.fiscalYear.startDate, lte: budget.fiscalYear.endDate } });
  const actualById = new Map(actual.map((a) => [a.accountId, a.balance]));
  const planned = new Map();
  for (const l of version.lines) planned.set(l.accountId, { account: l.account, amount: (planned.get(l.accountId)?.amount || toMoney(0)).plus(toMoney(l.plannedAmount)) });
  const rows = [...planned.values()].map(({ account, amount }) => {
    const act = actualById.get(account.id) || toMoney(0);
    return { code: account.code, name: account.name, type: account.type, planned: n(amount), actual: n(act), variance: n(act.minus(amount)) };
  });
  const note = budget.currency !== settings.baseCurrency ? `Budget is in ${budget.currency}; actuals are in the base currency ${settings.baseCurrency} and are NOT converted.` : null;
  return { meta: meta("Budget vs Actual", settings, { budget: budget.name, versionNumber: version.versionNumber, fiscalYear: budget.fiscalYear.name, source: `${LEDGER_SOURCE}; active budget version`, definition: "Posted actuals per account for the fiscal year against the active budget version. Variance = actual − planned.", ...(note && { note }) }), rows };
}

async function cashBalances(req, settings) {
  const accounts = await prisma.financialAccount.findMany({ where: { organizationId: req.organizationId, archivedAt: null } });
  const rows = [];
  for (const a of accounts) {
    const agg = await prisma.journalLine.aggregate({ where: { accountId: a.ledgerAccountId, currency: a.currency, journalEntry: { status: { in: POSTED } } }, _sum: { debit: true, credit: true } });
    rows.push({ name: a.name, type: a.type, currency: a.currency, ledgerBalance: n(toMoney(agg._sum.debit).minus(toMoney(agg._sum.credit))) });
  }
  return { meta: meta("Cash Account Balances", settings, { source: LEDGER_SOURCE, definition: "Posted movement on each financial account's ledger account, in the account's currency. Financial accounts that share a ledger account show the shared balance.", sharedLedgerAccounts: accounts.length !== new Set(accounts.map((a) => a.ledgerAccountId)).size }), rows };
}

async function reconciliationDifferences(req, settings) {
  const sessions = await prisma.reconciliationSession.findMany({ where: { organizationId: req.organizationId }, orderBy: { periodEnd: "desc" }, take: 100 });
  const unmatched = await prisma.statementLine.groupBy({ by: ["financialAccountId"], where: { organizationId: req.organizationId, reconciliationStatus: "Unmatched" }, _count: { _all: true } });
  return { meta: meta("Reconciliation Differences", settings, { source: "Reconciliation sessions and statement lines", definition: "Each session's difference between the statement closing balance and the ledger, and unmatched statement lines per account." }), sessions: sessions.map((s) => ({ id: s.id, financialAccountId: s.financialAccountId, periodEnd: s.periodEnd, status: s.status, difference: n(s.difference) })), unmatchedLines: unmatched.map((u) => ({ financialAccountId: u.financialAccountId, lines: u._count._all })) };
}

async function taxSummary(req, settings) {
  const { from, to } = range(req);
  const rows = (await accountTotals(req.organizationId, { entryDate: { gte: from, lte: to } })).filter((r) => ["Tax Payable", "Tax Recoverable"].includes(r.subtype));
  const payable = sum(rows.filter((r) => r.subtype === "Tax Payable"));
  const recoverable = sum(rows.filter((r) => r.subtype === "Tax Recoverable"));
  return { meta: meta("Tax Summary", settings, { from, to, source: LEDGER_SOURCE, definition: "Operational estimate: movement on tax payable and tax recoverable accounts in the period. Not a tax return and not tax advice." }), label: "Operational estimate", rows: rows.map(out), totals: { payable: n(payable), recoverable: n(recoverable), net: n(payable.minus(recoverable)) } };
}

async function currencyExposure(req, settings) {
  const [inv, bills] = await Promise.all([
    prisma.invoice.groupBy({ by: ["currency"], where: { organizationId: req.organizationId, status: { in: ["Posted", "Sent", "Partially Paid", "Disputed"] }, amountDue: { gt: 0 } }, _sum: { amountDue: true } }),
    prisma.vendorBill.groupBy({ by: ["currency"], where: { organizationId: req.organizationId, status: { in: ["Posted", "Partially Paid", "Disputed"] }, amountDue: { gt: 0 } }, _sum: { amountDue: true } }),
  ]);
  const currencies = [...new Set([...inv.map((r) => r.currency), ...bills.map((r) => r.currency)])];
  return { meta: meta("Multi-currency Exposure", settings, { source: DOC_SOURCE, definition: "Open receivables and payables per currency. Nothing is converted." }), rows: currencies.map((c) => ({ currency: c, isBase: c === settings.baseCurrency, receivable: n(inv.find((r) => r.currency === c)?._sum.amountDue), payable: n(bills.find((r) => r.currency === c)?._sum.amountDue) })) };
}

export const REPORTS = {
  "trial-balance": trialBalance, "profit-and-loss": profitAndLoss, "balance-sheet": balanceSheet, "cash-flow": cashFlow, "general-ledger": generalLedger,
  "journal-register": journalRegister, "revenue-by-period": revenueByPeriod, expenses: expensesBreakdown, "receivables-aging": receivablesAging, "payables-aging": payablesAging,
  "invoice-status": invoiceStatus, "overdue-invoices": overdueInvoices, "bill-status": billStatus, "recorded-payments": recordedPayments, "budget-vs-actual": budgetVsActual,
  "cash-balances": cashBalances, "reconciliation-differences": reconciliationDifferences, "tax-summary": taxSummary, "currency-exposure": currencyExposure,
};

export async function listReports(req, res) {
  res.json({ reports: Object.keys(REPORTS) });
}

export async function runReport(req, res) {
  const fn = REPORTS[req.params.report];
  if (!fn) return res.status(404).json({ code: "FINANCE_RECORD_NOT_FOUND", message: `Unknown report. Available: ${Object.keys(REPORTS).join(", ")}.` });
  const settings = await getSettings(prisma, req.organizationId);
  try {
    res.json(await fn(req, settings));
  } catch (err) {
    if (err instanceof RangeError) return invalid(res, err.message);
    throw err;
  }
}

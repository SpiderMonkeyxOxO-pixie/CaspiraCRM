// Backend Phase 6 (full spec) — the general ledger: double-entry
// validation, fiscal-period checks, posting and reversal.
//
// Rules (each enforced here, never trusted from the client):
// - a journal has at least two lines; each line is a debit OR a credit,
//   never both, never negative, never zero;
// - total debits equal total credits, in the transaction currency AND in
//   the base currency (a rounding difference from conversion goes onto the
//   largest line of the lighter side and is reported, never ignored);
// - every account is in the same organization, active, postable (not a
//   header) and allows the currency;
// - the entry date falls in a fiscal period that accepts postings (Closed:
//   never; Soft Closed: only with fiscal_periods:post);
// - posted entries are immutable. A correction is a reversal (a mirror
//   entry, linked both ways) plus a new entry.
import { Prisma } from "@prisma/client";
import { nextDocumentNumber } from "../sales/documentNumberService.js";
import { toMoney, round, add } from "../sales/moneyService.js";
import { parseAmount } from "./financeCommon.js";

const { Decimal } = Prisma;

export const ACCOUNT_TYPES = ["Asset", "Liability", "Equity", "Revenue", "Expense"];
export const NORMAL_BALANCE = { Asset: "Debit", Expense: "Debit", Liability: "Credit", Equity: "Credit", Revenue: "Credit" };
export const JOURNAL_STATUSES = ["Draft", "Submitted", "Approved", "Posted", "Reversed", "Cancelled"];
export const MAX_JOURNAL_LINES = 500;

export class LedgerError extends Error {
  constructor(message, { status = 400, code = "FINANCE_LEDGER_REJECTED" } = {}) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const sendLedgerError = (res, err) => res.status(err.status).json({ code: err.code, message: err.message });

// Validates raw lines ({ accountId, debit?, credit?, costCenterId?,
// projectId?, companyId?, description?, taxRateId?, taxSnapshot? }) against
// the loaded accounts and returns normalized lines with Decimal amounts and
// base-currency amounts. Pure: no database access.
export function buildJournalLines(rawLines, { currency, baseCurrency = currency, exchangeRate = 1, accountsById }) {
  if (!Array.isArray(rawLines) || rawLines.length < 2) throw new LedgerError("A journal needs at least two lines.");
  if (rawLines.length > MAX_JOURNAL_LINES) throw new LedgerError(`A journal can have at most ${MAX_JOURNAL_LINES} lines.`);
  const rate = toMoney(exchangeRate);
  if (!rate.greaterThan(0)) throw new LedgerError("The exchange rate must be positive.");

  const lines = rawLines.map((raw, i) => {
    const n = i + 1;
    const account = accountsById.get(raw?.accountId);
    if (!account) throw new LedgerError(`Line ${n}: the account doesn't exist in this organization.`);
    if (!account.active || account.archivedAt) throw new LedgerError(`Line ${n}: account ${account.code} is inactive.`);
    if (!account.postingAllowed) throw new LedgerError(`Line ${n}: account ${account.code} is a header account and can't be posted to.`);
    if (account.currency && account.currency !== currency) throw new LedgerError(`Line ${n}: account ${account.code} only accepts ${account.currency}.`);
    let debit;
    let credit;
    try {
      debit = raw.debit === undefined || raw.debit === null || raw.debit === "" ? new Decimal(0) : parseAmount(raw.debit, { field: `Line ${n} debit`, currency, allowZero: true });
      credit = raw.credit === undefined || raw.credit === null || raw.credit === "" ? new Decimal(0) : parseAmount(raw.credit, { field: `Line ${n} credit`, currency, allowZero: true });
    } catch (err) {
      throw new LedgerError(err.message);
    }
    if (debit.greaterThan(0) && credit.greaterThan(0)) throw new LedgerError(`Line ${n} has both a debit and a credit; use two lines.`);
    if (debit.isZero() && credit.isZero()) throw new LedgerError(`Line ${n} needs a debit or a credit.`);
    return {
      accountId: account.id,
      costCenterId: raw.costCenterId || null,
      projectId: raw.projectId || null,
      companyId: raw.companyId || null,
      description: typeof raw.description === "string" ? raw.description.trim().slice(0, 500) || null : null,
      debit, credit, currency,
      baseDebit: round(debit.times(rate), baseCurrency),
      baseCredit: round(credit.times(rate), baseCurrency),
      taxRateId: raw.taxRateId || null,
      taxSnapshot: raw.taxSnapshot || null,
    };
  });

  const totalDebit = lines.reduce((s, l) => add(s, l.debit), new Decimal(0));
  const totalCredit = lines.reduce((s, l) => add(s, l.credit), new Decimal(0));
  if (!totalDebit.equals(totalCredit)) {
    throw new LedgerError(`Debits (${totalDebit.toFixed(2)}) and credits (${totalCredit.toFixed(2)}) don't balance.`, { code: "FINANCE_JOURNAL_UNBALANCED" });
  }

  // Conversion rounding: balanced in the transaction currency can be off by
  // a minor unit in the base currency. Put the difference on the largest
  // line of the lighter side and report it.
  let roundingAdjustment = new Decimal(0);
  const baseDebit = lines.reduce((s, l) => add(s, l.baseDebit), new Decimal(0));
  const baseCredit = lines.reduce((s, l) => add(s, l.baseCredit), new Decimal(0));
  if (!baseDebit.equals(baseCredit)) {
    const diff = baseDebit.minus(baseCredit);
    const side = diff.isPositive() ? "baseCredit" : "baseDebit";
    const target = lines.filter((l) => l[side].greaterThan(0)).sort((a, b) => b[side].comparedTo(a[side]))[0];
    target[side] = target[side].plus(diff.abs());
    roundingAdjustment = diff.abs();
  }
  return { lines, totalDebit, totalCredit, roundingAdjustment };
}

export async function loadAccounts(db, organizationId, accountIds) {
  const ids = [...new Set(accountIds.filter(Boolean))];
  const accounts = await db.ledgerAccount.findMany({ where: { organizationId, id: { in: ids } } });
  return new Map(accounts.map((a) => [a.id, a]));
}

export function periodFor(db, organizationId, date) {
  return db.fiscalPeriod.findFirst({ where: { organizationId, startDate: { lte: date }, endDate: { gte: date } } });
}

// Why a period refuses a posting, or null when it accepts it.
export function periodRefusal(period, { canPostSoftClosed = false } = {}) {
  if (!period) return "No fiscal period covers this date. Create the fiscal year and its periods first.";
  if (period.status === "Closed") return `Fiscal period ${period.name} is closed.`;
  if (period.status === "Soft Closed" && !canPostSoftClosed) return `Fiscal period ${period.name} is soft-closed; posting into it needs fiscal_periods:post.`;
  return null;
}

// Transaction currency → base currency, from manually entered, approved
// rates only (no provider). 1 base = rate × quote on a row.
export async function resolveRate(db, organizationId, currency, baseCurrency, date) {
  if (currency === baseCurrency) return { rate: new Decimal(1), exchangeRateId: null };
  const where = { organizationId, status: "Approved", effectiveDate: { lte: date } };
  const direct = await db.exchangeRate.findFirst({ where: { ...where, baseCurrency: currency, quoteCurrency: baseCurrency }, orderBy: { effectiveDate: "desc" } });
  if (direct) return { rate: toMoney(direct.rate), exchangeRateId: direct.id };
  const inverse = await db.exchangeRate.findFirst({ where: { ...where, baseCurrency, quoteCurrency: currency }, orderBy: { effectiveDate: "desc" } });
  if (inverse) return { rate: new Decimal(1).dividedBy(toMoney(inverse.rate)).toDecimalPlaces(10, Decimal.ROUND_HALF_UP), exchangeRateId: inverse.id };
  throw new LedgerError(`No approved exchange rate from ${currency} to ${baseCurrency} on or before ${date.toISOString().slice(0, 10)}. Enter one under Finance → Exchange rates.`, { code: "FINANCE_EXCHANGE_RATE_MISSING" });
}

// Creates a journal in the given status (Draft for manual entries). `built`
// is buildJournalLines' result.
export async function createJournal(tx, { organizationId, entryDate, description, sourceType = "Manual", sourceId = null, reference = null, currency, exchangeRate = 1, exchangeRateId = null, built, createdByMembershipId = null, status = "Draft", extra = {} }) {
  const entryNumber = await nextDocumentNumber(tx, organizationId, "JournalEntry");
  const period = await periodFor(tx, organizationId, entryDate);
  return tx.journalEntry.create({
    data: {
      organizationId, entryNumber, entryDate, periodId: period?.id || null, description, sourceType, sourceId, reference,
      currency, exchangeRate: toMoney(exchangeRate), exchangeRateId, status,
      totalDebit: built.totalDebit, totalCredit: built.totalCredit, createdByMembershipId, ...extra,
      lines: { create: built.lines.map((l, i) => ({ organizationId, lineNumber: i + 1, ...l })) },
    },
    include: { lines: true },
  });
}

// Re-checks a stored journal from its own lines (never its stored totals)
// and the period, then flips it to Posted under a version check.
export async function postJournal(tx, entry, { membershipId, canPostSoftClosed = false, allowedFrom = ["Approved"] }) {
  if (!allowedFrom.includes(entry.status)) throw new LedgerError(`A ${entry.status.toLowerCase()} journal can't be posted.`, { code: "FINANCE_INVALID_TRANSITION" });
  const lines = entry.lines || (await tx.journalLine.findMany({ where: { journalEntryId: entry.id } }));
  const accountsById = await loadAccounts(tx, entry.organizationId, lines.map((l) => l.accountId));
  const rebuilt = buildJournalLines(lines.map((l) => ({ ...l, debit: toMoney(l.debit).toFixed(2), credit: toMoney(l.credit).toFixed(2) })), { currency: entry.currency, exchangeRate: 1, accountsById });
  const baseDebit = lines.reduce((s, l) => add(s, l.baseDebit), new Decimal(0));
  const baseCredit = lines.reduce((s, l) => add(s, l.baseCredit), new Decimal(0));
  if (!baseDebit.equals(baseCredit)) throw new LedgerError("The journal's base-currency amounts don't balance.", { code: "FINANCE_JOURNAL_UNBALANCED" });
  const period = await periodFor(tx, entry.organizationId, entry.entryDate);
  const refusal = periodRefusal(period, { canPostSoftClosed });
  if (refusal) throw new LedgerError(refusal, { code: "FINANCE_PERIOD_CLOSED" });
  const updated = await tx.journalEntry.updateMany({
    where: { id: entry.id, version: entry.version, status: entry.status },
    data: {
      status: "Posted", postedByMembershipId: membershipId, postedAt: new Date(), periodId: period.id,
      totalDebit: rebuilt.totalDebit, totalCredit: rebuilt.totalCredit, version: { increment: 1 },
    },
  });
  if (updated.count !== 1) throw new LedgerError("This journal was changed by someone else. Refresh and try again.", { status: 409, code: "FINANCE_VERSION_CONFLICT" });
  return tx.journalEntry.findUnique({ where: { id: entry.id }, include: { lines: true } });
}

// Journals behind approved documents (invoices, bills, expense reports,
// payments, credit notes): the document carried the approval, so the
// journal is created and posted in one step, inside the caller's
// transaction — all or nothing.
export async function postSystemJournal(tx, { organizationId, settings, entryDate, description, sourceType, sourceId, reference = null, currency, lines, membershipId, canPostSoftClosed = false }) {
  const baseCurrency = settings.baseCurrency || "USD";
  const { rate, exchangeRateId } = await resolveRate(tx, organizationId, currency, baseCurrency, entryDate);
  const accountsById = await loadAccounts(tx, organizationId, lines.map((l) => l.accountId));
  const built = buildJournalLines(lines.filter((l) => !toMoney(l.debit).isZero() || !toMoney(l.credit).isZero()), { currency, baseCurrency, exchangeRate: rate, accountsById });
  const period = await periodFor(tx, organizationId, entryDate);
  const refusal = periodRefusal(period, { canPostSoftClosed });
  if (refusal) throw new LedgerError(refusal, { code: "FINANCE_PERIOD_CLOSED" });
  const now = new Date();
  return createJournal(tx, {
    organizationId, entryDate, description, sourceType, sourceId, reference, currency, exchangeRate: rate, exchangeRateId, built,
    createdByMembershipId: membershipId, status: "Posted",
    extra: { submittedByMembershipId: membershipId, submittedAt: now, approvedByMembershipId: membershipId, approvedAt: now, postedByMembershipId: membershipId, postedAt: now },
  });
}

// Mirrors a posted journal (debits ↔ credits) dated `reversalDate`, links
// both ways, and marks the original Reversed. One reversal per journal
// (unique reversalOfId).
export async function reverseJournal(tx, entry, { membershipId, reason, reversalDate, canPostSoftClosed = false }) {
  if (entry.status !== "Posted") throw new LedgerError("Only a posted journal can be reversed.", { code: "FINANCE_INVALID_TRANSITION" });
  const lines = entry.lines || (await tx.journalLine.findMany({ where: { journalEntryId: entry.id } }));
  const date = reversalDate || new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
  const period = await periodFor(tx, entry.organizationId, date);
  const refusal = periodRefusal(period, { canPostSoftClosed });
  if (refusal) throw new LedgerError(refusal, { code: "FINANCE_PERIOD_CLOSED" });
  const updated = await tx.journalEntry.updateMany({
    where: { id: entry.id, version: entry.version, status: "Posted" },
    data: { status: "Reversed", reversedAt: new Date(), reversalReason: reason, version: { increment: 1 } },
  });
  if (updated.count !== 1) throw new LedgerError("This journal was changed by someone else. Refresh and try again.", { status: 409, code: "FINANCE_VERSION_CONFLICT" });
  const entryNumber = await nextDocumentNumber(tx, entry.organizationId, "JournalEntry");
  const now = new Date();
  return tx.journalEntry.create({
    data: {
      organizationId: entry.organizationId, entryNumber, entryDate: date, periodId: period.id,
      description: `Reversal of ${entry.entryNumber}: ${reason}`.slice(0, 500), sourceType: "Reversal", sourceId: entry.id, reference: entry.entryNumber,
      currency: entry.currency, exchangeRate: entry.exchangeRate, exchangeRateId: entry.exchangeRateId,
      status: "Posted", totalDebit: entry.totalCredit, totalCredit: entry.totalDebit, reversalOfId: entry.id,
      createdByMembershipId: membershipId, submittedByMembershipId: membershipId, submittedAt: now, approvedByMembershipId: membershipId, approvedAt: now, postedByMembershipId: membershipId, postedAt: now,
      lines: {
        create: lines.map((l) => ({
          organizationId: entry.organizationId, lineNumber: l.lineNumber, accountId: l.accountId, costCenterId: l.costCenterId, projectId: l.projectId, companyId: l.companyId,
          description: l.description, debit: l.credit, credit: l.debit, currency: l.currency, baseDebit: l.baseCredit, baseCredit: l.baseDebit, taxRateId: l.taxRateId, taxSnapshot: l.taxSnapshot ?? undefined,
        })),
      },
    },
    include: { lines: true },
  });
}

// An account's signed balance in its normal direction.
export function normalBalanceAmount(account, debit, credit) {
  return account.normalBalance === "Debit" ? toMoney(debit).minus(toMoney(credit)) : toMoney(credit).minus(toMoney(debit));
}

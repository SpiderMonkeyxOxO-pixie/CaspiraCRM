// Backend Phase 6 (full spec) — statement import (preview → confirm) and
// bank reconciliation.
//
// Reconciliation is manual: a person matches statement lines to ledger
// lines (one-to-one, split, many-to-one or one-to-many). Suggestions come
// from a deterministic exact-match rule — same amount and currency, date
// within 3 days, reference hints — and are labelled as such; nothing is
// matched or committed without a person confirming. Completing needs every
// statement line in the period matched or excluded, a zero difference, and
// an approver other than the preparer.
import crypto from "node:crypto";
import prisma from "../../lib/prisma.js";
import { toApi } from "../../utils/serialize.js";
import { toMoney } from "../../services/sales/moneyService.js";
import {
  invalid, notFound, badTransition, versionConflict, staleVersion, audit, parseAmount, parseDay, text, getSettings, checkSeparation,
} from "../../services/finance/financeCommon.js";
import { buildStatementLines, safeText } from "../../services/finance/statementImport.js";

const who = (req) => req.membership?.id || null;
export const SUGGESTION_RULE = "Exact-match rule: same amount and currency, date within 3 days; a matching payment or journal reference ranks first. Not AI.";
const DATE_TOLERANCE_DAYS = 3;

async function loadAccount(req, res, id) {
  const account = await prisma.financialAccount.findFirst({ where: { id, organizationId: req.organizationId } });
  if (!account) notFound(res, "Financial account");
  return account;
}

async function parseImport(req, res) {
  const account = await loadAccount(req, res, req.body.financialAccountId);
  if (!account) return null;
  const fileName = safeText(req.body.fileName || "statement.csv", 120).replace(/[\\/]/g, "_");
  try {
    const parsed = buildStatementLines(req.body.csv, { mapping: req.body.mapping || {}, dateFormat: req.body.dateFormat || "YYYY-MM-DD", currency: account.currency, financialAccountId: account.id });
    const existing = new Set((await prisma.statementLine.findMany({ where: { financialAccountId: account.id, fingerprint: { in: parsed.lines.map((l) => l.fingerprint) } }, select: { fingerprint: true } })).map((l) => l.fingerprint));
    const alreadyImported = await prisma.statementImport.findFirst({ where: { financialAccountId: account.id, checksum: parsed.checksum } });
    return { account, fileName, ...parsed, duplicates: parsed.lines.filter((l) => existing.has(l.fingerprint)), fresh: parsed.lines.filter((l) => !existing.has(l.fingerprint)), alreadyImported };
  } catch (err) {
    if (err instanceof RangeError) { invalid(res, err.message); return null; }
    throw err;
  }
}

const previewLine = (l, duplicate) => ({ rowNumber: l.rowNumber, transactionDate: l.transactionDate, description: l.description, reference: l.reference, direction: l.direction, amount: Number(l.amount), duplicate });

// Parses, maps and validates — saves nothing.
export async function importPreview(req, res) {
  const p = await parseImport(req, res);
  if (!p) return;
  res.json({
    preview: {
      fileName: p.fileName, headers: p.headers, checksum: p.checksum, alreadyImported: !!p.alreadyImported,
      lineCount: p.lines.length, newLines: p.fresh.length, duplicateLines: p.duplicates.length, errors: p.errors,
      lines: [...p.fresh.map((l) => previewLine(l, false)), ...p.duplicates.map((l) => previewLine(l, true))].sort((a, b) => a.rowNumber - b.rowNumber).slice(0, 200),
    },
    note: "Nothing has been saved. Confirm to import the new lines. This is an uploaded file — the CRM has no bank connection.",
  });
}

export async function importConfirm(req, res) {
  const p = await parseImport(req, res);
  if (!p) return;
  if (p.alreadyImported) return res.status(409).json({ code: "FINANCE_DUPLICATE_IMPORT", message: `This exact file was already imported on ${p.alreadyImported.createdAt.toISOString().slice(0, 10)}.` });
  if (p.errors.length && req.body.skipInvalidRows !== true) return invalid(res, `${p.errors.length} row(s) have errors. Fix them, or confirm with skipInvalidRows: true.`, { errors: p.errors.slice(0, 50) });
  if (!p.fresh.length) return invalid(res, "Every line in this file has already been imported.");
  const dates = p.fresh.map((l) => l.transactionDate.getTime());
  const created = await prisma.$transaction(async (tx) => {
    const imp = await tx.statementImport.create({
      data: {
        organizationId: req.organizationId, financialAccountId: p.account.id, checksum: p.checksum, fileName: p.fileName, columnMapping: { ...(req.body.mapping || {}), dateFormat: req.body.dateFormat || "YYYY-MM-DD" },
        importedByMembershipId: who(req), lineCount: p.fresh.length, duplicateCount: p.duplicates.length, periodStart: new Date(Math.min(...dates)), periodEnd: new Date(Math.max(...dates)),
      },
    });
    await tx.statementLine.createMany({ data: p.fresh.map((l) => ({ organizationId: req.organizationId, importId: imp.id, financialAccountId: p.account.id, ...l })) });
    return imp;
  });
  await audit(req, "finance.statement.imported", "StatementImport", created.id, { after: { fileName: p.fileName, lines: p.fresh.length, duplicates: p.duplicates.length, skipped: p.errors.length } });
  res.status(201).json({ import: toApi(created), skippedRows: p.errors.length, duplicateLines: p.duplicates.length });
}

export async function listStatementLines(req, res) {
  const where = { organizationId: req.organizationId };
  if (req.query.financialAccountId) where.financialAccountId = req.query.financialAccountId;
  if (req.query.status) where.reconciliationStatus = req.query.status;
  const lines = await prisma.statementLine.findMany({ where, orderBy: [{ transactionDate: "desc" }, { rowNumber: "asc" }], take: 500 });
  res.json({ statementLines: toApi(lines) });
}

// ---- Reconciliation sessions ----------------------------------------------

// Posted ledger movement on the account's ledger account up to a date.
async function ledgerBalance(organizationId, ledgerAccountId, upTo) {
  const agg = await prisma.journalLine.aggregate({
    where: { organizationId, accountId: ledgerAccountId, journalEntry: { status: { in: ["Posted", "Reversed"] }, entryDate: { lte: upTo } } },
    _sum: { debit: true, credit: true },
  });
  return toMoney(agg._sum.debit).minus(toMoney(agg._sum.credit));
}

async function sessionState(session, account) {
  const range = { gte: session.periodStart, lte: session.periodEnd };
  const [statementLines, journalLines, matches] = await Promise.all([
    prisma.statementLine.findMany({ where: { financialAccountId: account.id, transactionDate: range }, orderBy: { transactionDate: "asc" } }),
    prisma.journalLine.findMany({ where: { organizationId: session.organizationId, accountId: account.ledgerAccountId, journalEntry: { status: { in: ["Posted", "Reversed"] }, entryDate: range } }, include: { journalEntry: { select: { entryNumber: true, entryDate: true, reference: true, description: true, sourceType: true } } } }),
    prisma.reconciliationMatch.findMany({ where: { status: "Active", OR: [{ sessionId: session.id }, { statementLine: { financialAccountId: account.id } }] } }),
  ]);
  const matchedJournal = new Set(matches.filter((m) => m.journalLineId).map((m) => m.journalLineId));
  const ledger = await ledgerBalance(session.organizationId, account.ledgerAccountId, session.periodEnd);
  const difference = toMoney(session.closingBalance).minus(ledger);
  return { statementLines, journalLines, matches, matchedJournal, ledger, difference };
}

const signedStatement = (l) => (l.direction === "Credit" ? toMoney(l.amount) : toMoney(l.amount).negated());
const signedLedger = (j) => toMoney(j.debit).minus(toMoney(j.credit));

// Deterministic suggestions for unmatched statement lines.
export function suggestMatches(statementLines, journalLines, matchedJournal) {
  const out = [];
  const used = new Set(matchedJournal);
  for (const s of statementLines.filter((l) => l.reconciliationStatus === "Unmatched")) {
    const target = signedStatement(s);
    const candidates = journalLines
      .filter((j) => !used.has(j.id) && signedLedger(j).equals(target) && Math.abs(new Date(j.journalEntry.entryDate) - new Date(s.transactionDate)) <= DATE_TOLERANCE_DAYS * 86400000)
      .map((j) => ({ j, referenceHit: !!(s.reference && [j.journalEntry.reference, j.journalEntry.entryNumber].some((r) => r && s.reference.toLowerCase().includes(r.toLowerCase()))) }))
      .sort((a, b) => Number(b.referenceHit) - Number(a.referenceHit) || Math.abs(new Date(a.j.journalEntry.entryDate) - new Date(s.transactionDate)) - Math.abs(new Date(b.j.journalEntry.entryDate) - new Date(s.transactionDate)));
    if (candidates.length) {
      used.add(candidates[0].j.id);
      out.push({ statementLineId: s.id, journalLineId: candidates[0].j.id, entryNumber: candidates[0].j.journalEntry.entryNumber, amount: Number(target), referenceMatch: candidates[0].referenceHit, rule: SUGGESTION_RULE });
    }
  }
  return out;
}

async function loadSession(req, res) {
  const session = await prisma.reconciliationSession.findFirst({ where: { id: req.params.sessionId, organizationId: req.organizationId } });
  if (!session) notFound(res, "Reconciliation");
  return session;
}

export async function listReconciliations(req, res) {
  const sessions = await prisma.reconciliationSession.findMany({ where: { organizationId: req.organizationId, ...(req.query.financialAccountId && { financialAccountId: req.query.financialAccountId }) }, orderBy: { periodEnd: "desc" }, take: 100 });
  res.json({ reconciliations: toApi(sessions) });
}

export async function createReconciliation(req, res) {
  const account = await loadAccount(req, res, req.body.financialAccountId);
  if (!account) return;
  let periodStart;
  let periodEnd;
  let openingBalance;
  let closingBalance;
  try {
    periodStart = parseDay(req.body.periodStart, "periodStart");
    periodEnd = parseDay(req.body.periodEnd, "periodEnd");
    if (periodEnd < periodStart) throw new RangeError("periodEnd must be on or after periodStart.");
    openingBalance = parseAmount(req.body.openingBalance, { field: "openingBalance", currency: account.currency, allowZero: true, allowNegative: true });
    closingBalance = parseAmount(req.body.closingBalance, { field: "closingBalance", currency: account.currency, allowZero: true, allowNegative: true });
  } catch (err) {
    return invalid(res, err.message);
  }
  const open = await prisma.reconciliationSession.findFirst({ where: { financialAccountId: account.id, status: { in: ["Open", "Submitted"] } } });
  if (open) return badTransition(res, "This account already has a reconciliation in progress.");
  const ledger = await ledgerBalance(req.organizationId, account.ledgerAccountId, periodEnd);
  const session = await prisma.reconciliationSession.create({
    data: { organizationId: req.organizationId, financialAccountId: account.id, periodStart, periodEnd, openingBalance, closingBalance, statementBalance: closingBalance, ledgerBalance: ledger, difference: closingBalance.minus(ledger), preparedByMembershipId: who(req) },
  });
  await audit(req, "finance.reconciliation.created", "ReconciliationSession", session.id);
  res.status(201).json({ reconciliation: toApi(session) });
}

// The preparer corrects the statement balances while the session is open.
export async function updateReconciliation(req, res) {
  const session = await loadSession(req, res);
  if (!session) return;
  if (session.status !== "Open") return badTransition(res, "Only an open reconciliation can be changed.");
  if (staleVersion(req.body, session)) return versionConflict(res, "reconciliation");
  const account = await prisma.financialAccount.findUnique({ where: { id: session.financialAccountId } });
  const data = {};
  try {
    for (const f of ["openingBalance", "closingBalance"]) if (f in req.body) data[f] = parseAmount(req.body[f], { field: f, currency: account.currency, allowZero: true, allowNegative: true });
  } catch (err) {
    return invalid(res, err.message);
  }
  if (data.closingBalance) Object.assign(data, { statementBalance: data.closingBalance, difference: data.closingBalance.minus(toMoney(session.ledgerBalance)) });
  const updated = await prisma.reconciliationSession.updateMany({ where: { id: session.id, version: session.version, status: "Open" }, data: { ...data, version: { increment: 1 } } });
  if (updated.count !== 1) return versionConflict(res, "reconciliation");
  await audit(req, "finance.reconciliation.updated", "ReconciliationSession", session.id, { after: { closingBalance: data.closingBalance?.toFixed(2) } });
  return getReconciliation(req, res);
}

export async function getReconciliation(req, res) {
  const session = await loadSession(req, res);
  if (!session) return;
  const account = await prisma.financialAccount.findUnique({ where: { id: session.financialAccountId } });
  const s = await sessionState(session, account);
  res.json({
    reconciliation: toApi({ ...session, ledgerBalance: s.ledger, difference: s.difference }),
    statementLines: toApi(s.statementLines),
    unmatchedLedgerLines: toApi(s.journalLines.filter((j) => !s.matchedJournal.has(j.id))),
    matches: toApi(s.matches.filter((m) => m.sessionId === session.id)),
    suggestions: session.status === "Open" ? suggestMatches(s.statementLines, s.journalLines, s.matchedJournal) : [],
  });
}

// Confirms matches: groups of statement lines and ledger lines whose signed
// totals are equal (a split, many-to-one or one-to-many match).
export async function createMatches(req, res) {
  const session = await loadSession(req, res);
  if (!session) return;
  if (session.status !== "Open") return badTransition(res, "Only an open reconciliation can be changed.");
  if (staleVersion(req.body, session)) return versionConflict(res, "reconciliation");
  const groups = Array.isArray(req.body.groups) ? req.body.groups : [];
  if (!groups.length || groups.length > 200) return invalid(res, "Give 1–200 match groups.");
  const account = await prisma.financialAccount.findUnique({ where: { id: session.financialAccountId } });
  try {
    await prisma.$transaction(async (tx) => {
      for (const [i, g] of groups.entries()) {
        const n = i + 1;
        const sIds = [...new Set(g.statementLineIds || [])];
        const jIds = [...new Set(g.journalLineIds || [])];
        if (!sIds.length || !jIds.length) throw new RangeError(`Group ${n} needs at least one statement line and one ledger line.`);
        const sLines = await tx.statementLine.findMany({ where: { id: { in: sIds }, financialAccountId: account.id, reconciliationStatus: "Unmatched" } });
        if (sLines.length !== sIds.length) throw new RangeError(`Group ${n}: some statement lines aren't unmatched lines of this account.`);
        const jLines = await tx.journalLine.findMany({ where: { id: { in: jIds }, accountId: account.ledgerAccountId, journalEntry: { status: { in: ["Posted", "Reversed"] } } } });
        if (jLines.length !== jIds.length) throw new RangeError(`Group ${n}: some ledger lines aren't posted lines of this account.`);
        const taken = await tx.reconciliationMatch.count({ where: { journalLineId: { in: jIds }, status: "Active" } });
        if (taken) throw new RangeError(`Group ${n}: a ledger line is already matched.`);
        const sTotal = sLines.reduce((s, l) => s.plus(signedStatement(l)), toMoney(0));
        const jTotal = jLines.reduce((s, j) => s.plus(signedLedger(j)), toMoney(0));
        if (!sTotal.equals(jTotal)) throw new RangeError(`Group ${n}: statement lines total ${sTotal.toFixed(2)} but ledger lines total ${jTotal.toFixed(2)}.`);
        const groupId = crypto.randomUUID();
        const matchType = sIds.length === 1 && jIds.length === 1 ? (g.fromSuggestion ? "Exact" : "Manual") : "Split";
        const reason = text(g.reason, 300) || null;
        await tx.reconciliationMatch.createMany({
          data: [
            ...sLines.map((l) => ({ organizationId: req.organizationId, sessionId: session.id, groupId, statementLineId: l.id, amount: signedStatement(l), matchType, reason, createdByMembershipId: who(req) })),
            ...jLines.map((j) => ({ organizationId: req.organizationId, sessionId: session.id, groupId, statementLineId: sLines[0].id, journalLineId: j.id, amount: signedLedger(j), matchType, reason, createdByMembershipId: who(req) })),
          ],
        });
        await tx.statementLine.updateMany({ where: { id: { in: sIds } }, data: { reconciliationStatus: "Matched" } });
      }
      const touched = await tx.reconciliationSession.updateMany({ where: { id: session.id, version: session.version }, data: { version: { increment: 1 } } });
      if (touched.count !== 1) throw new RangeError("VERSION");
    });
  } catch (err) {
    if (err instanceof RangeError) return err.message === "VERSION" ? versionConflict(res, "reconciliation") : invalid(res, err.message);
    throw err;
  }
  await audit(req, "finance.reconciliation.matched", "ReconciliationSession", session.id, { after: { groups: groups.length } });
  return getReconciliation(req, res);
}

export async function unmatchGroup(req, res) {
  const session = await loadSession(req, res);
  if (!session) return;
  if (session.status !== "Open") return badTransition(res, "Only an open reconciliation can be changed.");
  const rows = await prisma.reconciliationMatch.findMany({ where: { sessionId: session.id, groupId: req.params.groupId, status: "Active" } });
  if (!rows.length) return notFound(res, "Match");
  await prisma.$transaction([
    prisma.reconciliationMatch.updateMany({ where: { sessionId: session.id, groupId: req.params.groupId }, data: { status: "Reversed", reversedAt: new Date() } }),
    prisma.statementLine.updateMany({ where: { id: { in: rows.filter((r) => !r.journalLineId).map((r) => r.statementLineId) } }, data: { reconciliationStatus: "Unmatched" } }),
  ]);
  await audit(req, "finance.reconciliation.unmatched", "ReconciliationSession", session.id);
  return getReconciliation(req, res);
}

export async function excludeLine(req, res) {
  const session = await loadSession(req, res);
  if (!session) return;
  if (session.status !== "Open") return badTransition(res, "Only an open reconciliation can be changed.");
  const reason = text(req.body.reason, 300);
  if (!reason) return invalid(res, "Excluding a statement line needs a reason.");
  const line = await prisma.statementLine.findFirst({ where: { id: req.params.lineId, financialAccountId: session.financialAccountId, reconciliationStatus: "Unmatched" } });
  if (!line) return notFound(res, "Unmatched statement line");
  await prisma.$transaction([
    prisma.statementLine.update({ where: { id: line.id }, data: { reconciliationStatus: "Excluded" } }),
    prisma.reconciliationMatch.create({ data: { organizationId: req.organizationId, sessionId: session.id, groupId: crypto.randomUUID(), statementLineId: line.id, amount: signedStatement(line), matchType: "Adjustment", reason: `Excluded: ${reason}`, createdByMembershipId: who(req) } }),
  ]);
  await audit(req, "finance.reconciliation.line_excluded", "ReconciliationSession", session.id, { reason });
  return getReconciliation(req, res);
}

// A journal the person can create (through the journals API) for a
// statement line with no ledger entry — e.g. a bank fee. Saves nothing.
export async function adjustmentPreview(req, res) {
  const session = await loadSession(req, res);
  if (!session) return;
  const line = await prisma.statementLine.findFirst({ where: { id: req.body.statementLineId, financialAccountId: session.financialAccountId } });
  if (!line) return notFound(res, "Statement line");
  const account = await prisma.financialAccount.findUnique({ where: { id: session.financialAccountId } });
  const other = await prisma.ledgerAccount.findFirst({ where: { id: req.body.accountId, organizationId: req.organizationId, postingAllowed: true, archivedAt: null } });
  if (!other) return invalid(res, "accountId must be an active, postable account (for example Bank Charges).");
  const amount = toMoney(line.amount).toFixed(2);
  const lines = line.direction === "Credit"
    ? [{ accountId: account.ledgerAccountId, debit: amount }, { accountId: other.id, credit: amount }]
    : [{ accountId: other.id, debit: amount }, { accountId: account.ledgerAccountId, credit: amount }];
  res.json({ preview: { entryDate: line.transactionDate, currency: line.currency, description: `Reconciliation adjustment: ${line.description}`.slice(0, 500), sourceType: "Adjustment", lines }, note: "Not saved. Create it as a journal, then match it." });
}

export async function submitReconciliation(req, res) {
  const session = await loadSession(req, res);
  if (!session) return;
  if (session.status !== "Open") return badTransition(res, "Only an open reconciliation can be submitted.");
  const updated = await prisma.reconciliationSession.updateMany({ where: { id: session.id, version: session.version, status: "Open" }, data: { status: "Submitted", submittedAt: new Date(), version: { increment: 1 } } });
  if (updated.count !== 1) return versionConflict(res, "reconciliation");
  await audit(req, "finance.reconciliation.submitted", "ReconciliationSession", session.id);
  res.json({ reconciliation: toApi(await prisma.reconciliationSession.findUnique({ where: { id: session.id } })) });
}

export async function completeReconciliation(req, res) {
  const session = await loadSession(req, res);
  if (!session) return;
  if (staleVersion(req.body, session)) return versionConflict(res, "reconciliation");
  if (session.status !== "Submitted") return badTransition(res, "Submit the reconciliation before completing it.");
  const settings = await getSettings(prisma, req.organizationId);
  if (!(await checkSeparation(req, res, { settings, sameActor: session.preparedByMembershipId === who(req), rule: "The person who prepared a reconciliation can't approve it.", action: "reconciliation.complete", targetType: "ReconciliationSession", targetId: session.id }))) return;
  const account = await prisma.financialAccount.findUnique({ where: { id: session.financialAccountId } });
  const s = await sessionState(session, account);
  const unmatched = s.statementLines.filter((l) => l.reconciliationStatus === "Unmatched").length;
  if (unmatched) return badTransition(res, `${unmatched} statement line(s) in the period are still unmatched.`);
  if (!s.difference.isZero()) return badTransition(res, `The statement closing balance differs from the ledger by ${s.difference.toFixed(2)} ${account.currency}.`);
  const updated = await prisma.reconciliationSession.updateMany({ where: { id: session.id, version: session.version, status: "Submitted" }, data: { status: "Completed", approvedByMembershipId: who(req), completedAt: new Date(), ledgerBalance: s.ledger, difference: s.difference, version: { increment: 1 } } });
  if (updated.count !== 1) return versionConflict(res, "reconciliation");
  await audit(req, "finance.reconciliation.completed", "ReconciliationSession", session.id);
  res.json({ reconciliation: toApi(await prisma.reconciliationSession.findUnique({ where: { id: session.id } })) });
}

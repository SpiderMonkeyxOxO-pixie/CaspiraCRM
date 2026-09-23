// Backend Phase 6 (full spec) — manual journal entries:
// Draft → Submitted → Approved → Posted (→ Reversed), or Cancelled.
//
// Posting is done by a person with journals:post, never automatically.
// With journal approval on (the default), only an Approved journal posts;
// the creator can't approve their own journal, and the approver can't post
// it. Journals created by documents (invoices, bills, payments…) are
// reversed through their document, not here.
import prisma from "../../lib/prisma.js";
import { toApi } from "../../utils/serialize.js";
import {
  invalid, notFound, badTransition, versionConflict, staleVersion, audit, isCurrency, parseDay, text, getSettings, checkSeparation,
} from "../../services/finance/financeCommon.js";
import {
  LedgerError, sendLedgerError, buildJournalLines, loadAccounts, resolveRate, createJournal, postJournal, reverseJournal, JOURNAL_STATUSES,
} from "../../services/finance/ledgerService.js";
import { canPostSoftClosed } from "./ledgerSetupController.js";

const who = (req) => req.membership?.id || null;
const MAX_PAGE_SIZE = 100;
const MANUAL_SOURCES = ["Manual", "Opening Balance", "Adjustment"];
const INCLUDE = { lines: { orderBy: { lineNumber: "asc" }, include: { account: { select: { id: true, code: true, name: true, type: true } } } }, period: { select: { id: true, name: true, status: true } } };

const serialize = (entry) => toApi(entry);

async function loadJournal(req, res) {
  const entry = await prisma.journalEntry.findFirst({ where: { id: req.params.journalId, organizationId: req.organizationId }, include: INCLUDE });
  if (!entry) notFound(res, "Journal entry");
  return entry;
}

export async function listJournals(req, res) {
  const q = req.query;
  const page = Math.max(1, Number(q.page) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(q.pageSize) || 25));
  const where = { organizationId: req.organizationId };
  if (q.status && JOURNAL_STATUSES.includes(q.status)) where.status = q.status;
  if (q.sourceType) where.sourceType = q.sourceType;
  if (q.periodId) where.periodId = q.periodId;
  if (q.accountId) where.lines = { some: { accountId: q.accountId } };
  if (q.from || q.to) where.entryDate = { ...(q.from && { gte: new Date(q.from) }), ...(q.to && { lte: new Date(q.to) }) };
  if (q.search) where.OR = [{ entryNumber: { contains: q.search, mode: "insensitive" } }, { description: { contains: q.search, mode: "insensitive" } }, { reference: { contains: q.search, mode: "insensitive" } }];
  const [entries, total] = await Promise.all([
    prisma.journalEntry.findMany({ where, include: INCLUDE, orderBy: [{ entryDate: "desc" }, { entryNumber: "desc" }], skip: (page - 1) * pageSize, take: pageSize }),
    prisma.journalEntry.count({ where }),
  ]);
  res.json({ journals: entries.map(serialize), total, page, pageSize });
}

export async function getJournal(req, res) {
  const entry = await loadJournal(req, res);
  if (entry) res.json({ journal: serialize(entry) });
}

// Validates the body into { entryDate, description, currency, built, rate }.
async function journalInput(req, settings, existing = null) {
  const entryDate = parseDay(req.body.entryDate ?? existing?.entryDate, "entryDate");
  const description = text(req.body.description ?? existing?.description, 500);
  if (!description) throw new LedgerError("description is required.");
  const currency = req.body.currency ?? existing?.currency ?? settings.baseCurrency;
  if (!isCurrency(currency)) throw new LedgerError("currency must be an ISO 4217 code.");
  const sourceType = req.body.sourceType ?? existing?.sourceType ?? "Manual";
  if (!MANUAL_SOURCES.includes(sourceType)) throw new LedgerError(`sourceType must be one of ${MANUAL_SOURCES.join(", ")}.`);
  const rawLines = req.body.lines ?? existing?.lines?.map((l) => ({ ...l, debit: String(l.debit), credit: String(l.credit) }));
  const { rate, exchangeRateId } = await resolveRate(prisma, req.organizationId, currency, settings.baseCurrency, entryDate);
  const accountsById = await loadAccounts(prisma, req.organizationId, (rawLines || []).map((l) => l?.accountId));
  const built = buildJournalLines(rawLines, { currency, baseCurrency: settings.baseCurrency, exchangeRate: rate, accountsById });
  await checkLineRefs(req.organizationId, built.lines);
  return { entryDate, description, currency, sourceType, rate, exchangeRateId, built, reference: text(req.body.reference ?? existing?.reference, 120) || null };
}

// Cost centers, projects and companies on lines must be in this organization.
async function checkLineRefs(organizationId, lines) {
  const ids = (field) => [...new Set(lines.map((l) => l[field]).filter(Boolean))];
  const checks = [["costCenterId", "costCenter"], ["projectId", "project"], ["companyId", "company"]];
  for (const [field, model] of checks) {
    const wanted = ids(field);
    if (!wanted.length) continue;
    const found = await prisma[model].count({ where: { organizationId, id: { in: wanted } } });
    if (found !== wanted.length) throw new LedgerError(`A line's ${field} isn't in this organization.`);
  }
}

export async function createJournalEntry(req, res) {
  const settings = await getSettings(prisma, req.organizationId);
  let input;
  try { input = await journalInput(req, settings); } catch (err) { return err instanceof LedgerError || err instanceof RangeError ? invalid(res, err.message) : Promise.reject(err); }
  const entry = await prisma.$transaction((tx) => createJournal(tx, {
    organizationId: req.organizationId, entryDate: input.entryDate, description: input.description, sourceType: input.sourceType, reference: input.reference,
    currency: input.currency, exchangeRate: input.rate, exchangeRateId: input.exchangeRateId, built: input.built, createdByMembershipId: who(req),
  }));
  await audit(req, "finance.journal.created", "JournalEntry", entry.id, { after: { entryNumber: entry.entryNumber, total: input.built.totalDebit.toFixed(2), currency: input.currency } });
  const saved = await prisma.journalEntry.findUnique({ where: { id: entry.id }, include: INCLUDE });
  res.status(201).json({ journal: serialize(saved), ...(input.built.roundingAdjustment.isZero() ? {} : { roundingAdjustment: input.built.roundingAdjustment.toFixed(2) }) });
}

// Only a Draft is editable; its lines are replaced as a whole.
export async function updateJournalEntry(req, res) {
  const entry = await loadJournal(req, res);
  if (!entry) return;
  if (entry.status !== "Draft") return badTransition(res, "Only a draft journal can be edited.");
  if (staleVersion(req.body, entry)) return versionConflict(res, "journal");
  const settings = await getSettings(prisma, req.organizationId);
  let input;
  try { input = await journalInput(req, settings, entry); } catch (err) { return err instanceof LedgerError || err instanceof RangeError ? invalid(res, err.message) : Promise.reject(err); }
  const ok = await prisma.$transaction(async (tx) => {
    const updated = await tx.journalEntry.updateMany({
      where: { id: entry.id, version: entry.version, status: "Draft" },
      data: {
        entryDate: input.entryDate, description: input.description, sourceType: input.sourceType, reference: input.reference, currency: input.currency,
        exchangeRate: input.rate, exchangeRateId: input.exchangeRateId, totalDebit: input.built.totalDebit, totalCredit: input.built.totalCredit, version: { increment: 1 },
      },
    });
    if (updated.count !== 1) return false;
    await tx.journalLine.deleteMany({ where: { journalEntryId: entry.id } });
    await tx.journalLine.createMany({ data: input.built.lines.map((l, i) => ({ organizationId: req.organizationId, journalEntryId: entry.id, lineNumber: i + 1, ...l, taxSnapshot: l.taxSnapshot ?? undefined })) });
    return true;
  });
  if (!ok) return versionConflict(res, "journal");
  await audit(req, "finance.journal.updated", "JournalEntry", entry.id);
  res.json({ journal: serialize(await prisma.journalEntry.findUnique({ where: { id: entry.id }, include: INCLUDE })) });
}

async function move(req, res, entry, from, data, action, extra = {}) {
  const updated = await prisma.journalEntry.updateMany({ where: { id: entry.id, version: entry.version, status: { in: from } }, data: { ...data, version: { increment: 1 } } });
  if (updated.count !== 1) return versionConflict(res, "journal");
  await audit(req, action, "JournalEntry", entry.id, { before: { status: entry.status }, after: { status: data.status }, ...extra });
  res.json({ journal: serialize(await prisma.journalEntry.findUnique({ where: { id: entry.id }, include: INCLUDE })) });
}

export async function submitJournal(req, res) {
  const entry = await loadJournal(req, res);
  if (!entry) return;
  if (staleVersion(req.body, entry)) return versionConflict(res, "journal");
  if (entry.status !== "Draft") return badTransition(res, `A ${entry.status.toLowerCase()} journal can't be submitted.`);
  return move(req, res, entry, ["Draft"], { status: "Submitted", submittedByMembershipId: who(req), submittedAt: new Date() }, "finance.journal.submitted");
}

export async function approveJournal(req, res) {
  const entry = await loadJournal(req, res);
  if (!entry) return;
  if (staleVersion(req.body, entry)) return versionConflict(res, "journal");
  if (entry.status !== "Submitted") return badTransition(res, "Only a submitted journal can be approved.");
  const settings = await getSettings(prisma, req.organizationId);
  const sameActor = [entry.createdByMembershipId, entry.submittedByMembershipId].includes(who(req));
  if (!(await checkSeparation(req, res, { settings, sameActor, rule: "The person who created or submitted a journal can't approve it.", action: "journal.approve", targetType: "JournalEntry", targetId: entry.id }))) return;
  return move(req, res, entry, ["Submitted"], { status: "Approved", approvedByMembershipId: who(req), approvedAt: new Date() }, "finance.journal.approved");
}

export async function postJournalEntry(req, res) {
  const entry = await loadJournal(req, res);
  if (!entry) return;
  if (staleVersion(req.body, entry)) return versionConflict(res, "journal");
  if (!MANUAL_SOURCES.includes(entry.sourceType)) return badTransition(res, "This journal belongs to a document; post the document instead.");
  const settings = await getSettings(prisma, req.organizationId);
  const allowedFrom = settings.journalApprovalRequired ? ["Approved"] : ["Submitted", "Approved"];
  if (!allowedFrom.includes(entry.status)) return badTransition(res, settings.journalApprovalRequired ? "The journal must be approved before it's posted." : "Submit the journal before posting it.");
  if (!(await checkSeparation(req, res, { settings, sameActor: entry.createdByMembershipId === who(req), rule: "The person who created a journal can't post it.", action: "journal.post", targetType: "JournalEntry", targetId: entry.id }))) return;
  if (entry.approvedByMembershipId && !(await checkSeparation(req, res, { settings, sameActor: entry.approvedByMembershipId === who(req), rule: "The approver of a journal can't also post it.", action: "journal.post", targetType: "JournalEntry", targetId: entry.id }))) return;
  let posted;
  try {
    posted = await prisma.$transaction((tx) => postJournal(tx, entry, { membershipId: who(req), canPostSoftClosed: canPostSoftClosed(req), allowedFrom }));
  } catch (err) {
    if (err instanceof LedgerError) {
      await audit(req, "finance.journal.post_refused", "JournalEntry", entry.id, { result: "Denied", reason: err.message });
      return sendLedgerError(res, err);
    }
    throw err;
  }
  await audit(req, "finance.journal.posted", "JournalEntry", entry.id, { after: { entryNumber: posted.entryNumber, totalDebit: posted.totalDebit.toFixed(2) } });
  res.json({ journal: serialize(await prisma.journalEntry.findUnique({ where: { id: entry.id }, include: INCLUDE })) });
}

export async function reverseJournalEntry(req, res) {
  const entry = await loadJournal(req, res);
  if (!entry) return;
  if (staleVersion(req.body, entry)) return versionConflict(res, "journal");
  if (!MANUAL_SOURCES.includes(entry.sourceType)) return badTransition(res, "This journal belongs to a document; void or reverse the document instead.");
  const reason = text(req.body.reason, 500);
  if (!reason) return invalid(res, "Reversing a journal needs a reason.");
  let reversalDate = null;
  try { reversalDate = parseDay(req.body.reversalDate, "reversalDate", { required: false }); } catch (err) { return invalid(res, err.message); }
  let reversal;
  try {
    reversal = await prisma.$transaction((tx) => reverseJournal(tx, entry, { membershipId: who(req), reason, reversalDate, canPostSoftClosed: canPostSoftClosed(req) }));
  } catch (err) {
    if (err instanceof LedgerError) return sendLedgerError(res, err);
    throw err;
  }
  await audit(req, "finance.journal.reversed", "JournalEntry", entry.id, { reason, after: { reversalId: reversal.id, reversalNumber: reversal.entryNumber } });
  const [original, mirror] = await Promise.all([
    prisma.journalEntry.findUnique({ where: { id: entry.id }, include: INCLUDE }),
    prisma.journalEntry.findUnique({ where: { id: reversal.id }, include: INCLUDE }),
  ]);
  res.status(201).json({ journal: serialize(original), reversal: serialize(mirror) });
}

export async function cancelJournal(req, res) {
  const entry = await loadJournal(req, res);
  if (!entry) return;
  if (staleVersion(req.body, entry)) return versionConflict(res, "journal");
  if (!["Draft", "Submitted", "Approved"].includes(entry.status)) return badTransition(res, "A posted journal can't be cancelled; reverse it instead.");
  const reason = text(req.body.reason, 500);
  if (!reason) return invalid(res, "Cancelling a journal needs a reason.");
  return move(req, res, entry, ["Draft", "Submitted", "Approved"], { status: "Cancelled", cancelledReason: reason }, "finance.journal.cancelled", { reason });
}

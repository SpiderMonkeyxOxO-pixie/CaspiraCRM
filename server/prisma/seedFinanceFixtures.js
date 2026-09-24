// Idempotent Finance fixture import — LOCAL DEVELOPMENT ONLY, never
// production. Same approach as the other fixture imports: a small,
// hand-curated set in the shape of the frontend's mockFinanceData.js
// (invoice lines with tax categories, statuses, expense categories), not a
// port of its random generator.
//
// Creates, only when missing: the starter chart of accounts and default
// accounts, the current fiscal year, a 12% tax rate, one financial account,
// and one posted invoice (with its journal). Then it checks the whole
// organization: every invoice's lines add up to its totals, every posted
// journal balances, and the trial balance balances — and reports any
// mismatch instead of "fixing" it.
//
// Usage: FINANCE_FIXTURE_ORG_ID=<org id> node prisma/seedFinanceFixtures.js
import "dotenv/config";
import prisma from "../src/lib/prisma.js";
import { STARTER_CHART, monthlyPeriods } from "../src/controllers/finance/ledgerSetupController.js";
import { NORMAL_BALANCE, postSystemJournal } from "../src/services/finance/ledgerService.js";
import { createDraftInvoice } from "../src/services/finance/invoiceService.js";
import { invoiceJournalLines } from "../src/controllers/finance/invoicesController.js";
import { getSettings } from "../src/services/finance/financeCommon.js";
import { toMoney } from "../src/services/sales/moneyService.js";

if (process.env.NODE_ENV === "production") {
  console.error("Refusing to import Finance fixtures in production.");
  process.exit(1);
}
const organizationId = process.env.FINANCE_FIXTURE_ORG_ID;
if (!organizationId) {
  console.error("Set FINANCE_FIXTURE_ORG_ID to the organization to import into.");
  process.exit(1);
}

const report = { created: {}, skipped: {}, mismatches: [] };
const tally = (kind, created) => { const b = created ? report.created : report.skipped; b[kind] = (b[kind] || 0) + 1; };
const FIXTURE_LINE = "[Fixture] Onboarding services";

async function ensureChart() {
  const byCode = new Map((await prisma.ledgerAccount.findMany({ where: { organizationId } })).map((a) => [a.code, a]));
  for (const def of STARTER_CHART) {
    if (byCode.has(def.code)) { tally("accounts", false); continue; }
    const a = await prisma.ledgerAccount.create({ data: { organizationId, code: def.code, name: def.name, type: def.type, subtype: def.subtype || null, normalBalance: NORMAL_BALANCE[def.type], postingAllowed: !def.header, parentId: def.parent ? byCode.get(def.parent)?.id || null : null } });
    byCode.set(def.code, a);
    tally("accounts", true);
  }
  const current = await prisma.financeSettings.findUnique({ where: { organizationId } });
  const defaults = {};
  for (const def of STARTER_CHART) if (def.setting && !current?.[def.setting]) defaults[def.setting] = byCode.get(def.code).id;
  await prisma.financeSettings.upsert({ where: { organizationId }, create: { organizationId, ...defaults }, update: defaults });
  return byCode;
}

async function ensureFiscalYear() {
  const year = new Date().getUTCFullYear();
  const start = new Date(Date.UTC(year, 0, 1));
  const end = new Date(Date.UTC(year, 11, 31));
  const existing = await prisma.fiscalYear.findFirst({ where: { organizationId, startDate: { lte: end }, endDate: { gte: start } } });
  if (existing) return tally("fiscalYears", false);
  await prisma.fiscalYear.create({ data: { organizationId, name: `FY ${year}`, startDate: start, endDate: end, periods: { create: monthlyPeriods(start, end).map((p) => ({ organizationId, ...p })) } } });
  tally("fiscalYears", true);
}

async function main() {
  const byCode = await ensureChart();
  await ensureFiscalYear();

  if (await prisma.taxRate.findFirst({ where: { organizationId, code: "VAT12" } })) tally("taxRates", false);
  else { await prisma.taxRate.create({ data: { organizationId, code: "VAT12", name: "VAT 12%", rateBasisPoints: 1200, type: "Both", recoverable: true } }); tally("taxRates", true); }

  if (await prisma.financialAccount.findFirst({ where: { organizationId, name: "Fixture Bank" } })) tally("financialAccounts", false);
  else { await prisma.financialAccount.create({ data: { organizationId, name: "Fixture Bank", type: "Bank", currency: "USD", maskedReference: "•••• 0000", ledgerAccountId: byCode.get("1020").id } }); tally("financialAccounts", true); }

  const company = await prisma.company.findFirst({ where: { organizationId }, orderBy: { createdAt: "asc" } });
  const existingInvoice = await prisma.invoice.findFirst({ where: { organizationId, lines: { some: { description: FIXTURE_LINE } } } });
  if (existingInvoice) tally("invoices", false);
  else {
    const settings = await getSettings(prisma, organizationId);
    await prisma.$transaction(async (tx) => {
      const draft = await createDraftInvoice(tx, { organizationId, companyId: company?.id || null, lines: [{ name: FIXTURE_LINE, qty: 1, unitPrice: 1500, taxCategory: "Standard" }, { name: "[Fixture] Training day", qty: 2, unitPrice: 400, taxCategory: "Reduced" }], currency: "USD", dueDays: 30 });
      const invoice = await tx.invoice.findUnique({ where: { id: draft.id }, include: { lines: true, company: true } });
      const journal = await postSystemJournal(tx, { organizationId, settings, entryDate: new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)), description: `Invoice ${invoice.invoiceNumber} (fixture)`, sourceType: "Invoice", sourceId: invoice.id, reference: invoice.invoiceNumber, currency: "USD", lines: await invoiceJournalLines(tx, invoice, settings), membershipId: null });
      await tx.invoice.update({ where: { id: invoice.id }, data: { status: "Sent", approvedAt: new Date(), postedAt: new Date(), sentAt: new Date(), journalEntryId: journal.id } });
    });
    tally("invoices", true);
  }

  // Consistency checks — reported, never silently corrected.
  const invoices = await prisma.invoice.findMany({ where: { organizationId }, include: { lines: true } });
  for (const inv of invoices) {
    if (!inv.lines.length) { report.mismatches.push({ invoice: inv.invoiceNumber, issue: "No line snapshots (created before Phase 6)" }); continue; }
    const lineTotal = inv.lines.reduce((s, l) => s.plus(toMoney(l.lineTotal)), toMoney(0));
    if (!lineTotal.equals(toMoney(inv.total))) report.mismatches.push({ invoice: inv.invoiceNumber, issue: `Lines total ${lineTotal.toFixed(2)} but invoice total is ${toMoney(inv.total).toFixed(2)}` });
    const due = toMoney(inv.total).minus(toMoney(inv.amountPaid)).minus(toMoney(inv.amountCredited));
    if (!["Void", "Written Off"].includes(inv.status) && !toMoney(inv.amountDue).equals(due.isNegative() ? toMoney(0) : due)) report.mismatches.push({ invoice: inv.invoiceNumber, issue: `amountDue ${toMoney(inv.amountDue).toFixed(2)} ≠ total − paid − credited (${due.toFixed(2)})` });
  }
  const journals = await prisma.journalEntry.findMany({ where: { organizationId, status: { in: ["Posted", "Reversed"] } }, include: { lines: true } });
  for (const j of journals) {
    const d = j.lines.reduce((s, l) => s.plus(toMoney(l.baseDebit)), toMoney(0));
    const c = j.lines.reduce((s, l) => s.plus(toMoney(l.baseCredit)), toMoney(0));
    if (!d.equals(c)) report.mismatches.push({ journal: j.entryNumber, issue: `Unbalanced: ${d.toFixed(2)} ≠ ${c.toFixed(2)}` });
  }
  const all = journals.flatMap((j) => j.lines);
  const tbD = all.reduce((s, l) => s.plus(toMoney(l.baseDebit)), toMoney(0));
  const tbC = all.reduce((s, l) => s.plus(toMoney(l.baseCredit)), toMoney(0));
  report.trialBalance = { debit: tbD.toFixed(2), credit: tbC.toFixed(2), balanced: tbD.equals(tbC), postedJournals: journals.length };

  console.log("Finance fixture import report:");
  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((err) => { console.error("Finance fixture import failed:", err.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

const D = (v) => new Prisma.Decimal(v);
const db = {
  financeSettings: { findUnique: vi.fn(async () => null) },
  financeOverride: { create: vi.fn() },
  financialAccount: { findFirst: vi.fn(), findUnique: vi.fn() },
  statementLine: { findMany: vi.fn(async () => []), createMany: vi.fn(), updateMany: vi.fn() },
  statementImport: { findFirst: vi.fn(async () => null), create: vi.fn(async ({ data }) => ({ id: "imp1", ...data })) },
  reconciliationSession: { findFirst: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn(async () => ({ count: 1 })) },
  reconciliationMatch: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0), createMany: vi.fn() },
  journalLine: { findMany: vi.fn(async () => []), aggregate: vi.fn(async () => ({ _sum: { debit: D(0), credit: D(0) } })) },
  budget: { findFirst: vi.fn(), findUnique: vi.fn(async () => ({ id: "b1" })), updateMany: vi.fn(async () => ({ count: 1 })) },
  budgetVersion: { updateMany: vi.fn(async () => ({ count: 1 })), update: vi.fn() },
  ledgerAccount: { findMany: vi.fn(async () => []) },
  fiscalPeriod: { findMany: vi.fn(async () => []) },
  costCenter: { findMany: vi.fn(async () => []) },
  project: { findMany: vi.fn(async () => []) },
  auditEvent: { create: vi.fn() },
};
db.$transaction = vi.fn(async (arg) => (typeof arg === "function" ? arg(db) : Promise.all(arg)));
vi.mock("../../lib/prisma.js", () => ({ default: db }));

const statements = await import("../../services/finance/statementImport.js");
const recon = await import("./reconciliationController.js");
const budgets = await import("./budgetsController.js");

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}
const req = (body = {}, params = {}, membershipId = "m1") => ({
  body, params, query: {}, headers: {}, organizationId: "org1", user: { id: "u1" }, isSystemOwnerOverride: false,
  membership: { id: membershipId, roles: [{ role: { defaultScope: "Organization", permissionGrants: [] } }] },
});

beforeEach(() => {
  for (const m of Object.values(db)) if (typeof m === "object") for (const fn of Object.values(m)) fn.mockClear?.();
});

const CSV = 'Date,Details,Amount,Ref\n2026-09-01,"Card, fee",-12.50,\n2026-09-02,=HYPERLINK("x"),"1,000.00",INV-1\n2026-09-02,=HYPERLINK("x"),"1,000.00",INV-1\nbad-date,Thing,5,\n2026-09-03,Zero,0,\n';
const mapping = { date: "Date", description: "Details", amount: "Amount", reference: "Ref" };

describe("statement CSV import", () => {
  it("parses quotes and thousands, signs money in/out, reports row errors", () => {
    const out = statements.buildStatementLines(CSV, { mapping, currency: "USD", financialAccountId: "fa1" });
    expect(out.lines).toHaveLength(3);
    expect(out.lines[0]).toMatchObject({ description: "Card, fee", direction: "Debit" });
    expect(out.lines[0].amount.toFixed(2)).toBe("12.50");
    expect(out.lines[1]).toMatchObject({ direction: "Credit", reference: "INV-1" });
    expect(out.errors.map((e) => e.rowNumber)).toEqual([5, 6]);
  });

  it("formulas are stored as inert text; identical lines get distinct fingerprints", () => {
    const out = statements.buildStatementLines(CSV, { mapping, currency: "USD", financialAccountId: "fa1" });
    expect(out.lines[1].description.startsWith("'=")).toBe(true);
    expect(out.lines[1].fingerprint).not.toBe(out.lines[2].fingerprint);
    const again = statements.buildStatementLines(CSV, { mapping, currency: "USD", financialAccountId: "fa1" });
    expect(again.lines.map((l) => l.fingerprint)).toEqual(out.lines.map((l) => l.fingerprint));
  });

  it("bounds and mapping are enforced; date formats are explicit", () => {
    expect(() => statements.buildStatementLines("Date\n", { mapping, currency: "USD" })).toThrow(/header row/);
    expect(() => statements.buildStatementLines(CSV, { mapping: { date: "Date" }, currency: "USD" })).toThrow(/description/);
    expect(() => statements.buildStatementLines("x".repeat(1_000_001), { mapping, currency: "USD" })).toThrow(/larger/);
    expect(statements.parseStatementDate("31/01/2026", "DD/MM/YYYY").toISOString().slice(0, 10)).toBe("2026-01-31");
    expect(statements.parseStatementDate("02/30/2026", "MM/DD/YYYY")).toBeNull();
    expect(statements.parseStatementAmount("(12.00)").toFixed(2)).toBe("-12.00");
  });

  it("preview saves nothing; confirming the same file twice is refused", async () => {
    db.financialAccount.findFirst.mockResolvedValue({ id: "fa1", currency: "USD" });
    await recon.importPreview(req({ financialAccountId: "fa1", csv: CSV, mapping }), mockRes());
    expect(db.statementImport.create).not.toHaveBeenCalled();
    expect(db.statementLine.createMany).not.toHaveBeenCalled();
    db.statementImport.findFirst.mockResolvedValueOnce({ createdAt: new Date("2026-09-01") });
    const dup = mockRes();
    await recon.importConfirm(req({ financialAccountId: "fa1", csv: CSV, mapping, skipInvalidRows: true }), dup);
    expect(dup.status).toHaveBeenCalledWith(409);
  });

  it("row errors block the import unless skipped explicitly", async () => {
    db.financialAccount.findFirst.mockResolvedValue({ id: "fa1", currency: "USD" });
    const res = mockRes();
    await recon.importConfirm(req({ financialAccountId: "fa1", csv: CSV, mapping }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    await recon.importConfirm(req({ financialAccountId: "fa1", csv: CSV, mapping, skipInvalidRows: true }), mockRes());
    expect(db.statementLine.createMany.mock.calls[0][0].data).toHaveLength(3);
  });
});

describe("reconciliation", () => {
  const sLine = (id, direction, amount, date, reference = null) => ({ id, direction, amount: D(amount), transactionDate: new Date(date), reference, reconciliationStatus: "Unmatched" });
  const jLine = (id, debit, credit, date, entryNumber, reference = null) => ({ id, debit: D(debit), credit: D(credit), journalEntry: { entryDate: new Date(date), entryNumber, reference } });

  it("suggestions: exact amount and sign within 3 days, reference first, each ledger line used once", () => {
    const s = [sLine("s1", "Credit", 500, "2026-09-20", "PAY-2026-000001"), sLine("s2", "Debit", 12.5, "2026-09-01")];
    const j = [jLine("j1", 500, 0, "2026-09-19", "JE-9"), jLine("j2", 500, 0, "2026-09-20", "JE-10", "PAY-2026-000001"), jLine("j3", 0, 12.5, "2026-09-10", "JE-11")];
    const out = recon.suggestMatches(s, j, new Set());
    expect(out).toEqual([expect.objectContaining({ statementLineId: "s1", journalLineId: "j2", referenceMatch: true, rule: expect.stringMatching(/Not AI/) })]);
  });

  it("a match group must balance", async () => {
    db.reconciliationSession.findFirst.mockResolvedValue({ id: "r1", status: "Open", version: 1, financialAccountId: "fa1" });
    db.financialAccount.findUnique.mockResolvedValue({ id: "fa1", ledgerAccountId: "bank" });
    db.statementLine.findMany.mockResolvedValueOnce([sLine("s1", "Credit", 500, "2026-09-20")]);
    db.journalLine.findMany.mockResolvedValueOnce([jLine("j1", 499, 0, "2026-09-20", "JE-1")]);
    const res = mockRes();
    await recon.createMatches(req({ groups: [{ statementLineIds: ["s1"], journalLineIds: ["j1"] }] }, { sessionId: "r1" }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toMatch(/500.00 but ledger lines total 499.00/);
    expect(db.reconciliationMatch.createMany).not.toHaveBeenCalled();
  });

  it("the preparer can't complete; unmatched lines or a difference block completion", async () => {
    db.reconciliationSession.findFirst.mockResolvedValue({ id: "r1", status: "Submitted", version: 2, preparedByMembershipId: "m1", financialAccountId: "fa1", organizationId: "org1", closingBalance: D(100), periodStart: new Date(), periodEnd: new Date() });
    const own = mockRes();
    await recon.completeReconciliation(req({}, { sessionId: "r1" }), own);
    expect(own.status).toHaveBeenCalledWith(403);
    db.financialAccount.findUnique.mockResolvedValue({ id: "fa1", ledgerAccountId: "bank", currency: "USD" });
    const diff = mockRes();
    await recon.completeReconciliation(req({}, { sessionId: "r1" }, "m2"), diff);
    expect(diff.json.mock.calls[0][0].message).toMatch(/differs from the ledger by 100.00/);
  });
});

describe("budgets", () => {
  const budget = (versions) => ({ id: "b1", organizationId: "org1", currency: "USD", fiscalYearId: "fy1", version: 3, activeVersionId: null, versions });

  it("lines must be postable revenue or expense accounts", async () => {
    db.ledgerAccount.findMany.mockResolvedValue([{ id: "a1", code: "1020", type: "Asset", postingAllowed: true }]);
    db.budget.findFirst.mockResolvedValue(budget([{ id: "v1", status: "Draft", versionNumber: 1 }]));
    const res = mockRes();
    await budgets.updateVersion(req({ lines: [{ accountId: "a1", plannedAmount: "100" }] }, { budgetId: "b1", versionId: "v1" }), res);
    expect(res.json.mock.calls[0][0].message).toMatch(/revenue and expense/);
  });

  it("approved versions are immutable; the preparer can't approve", async () => {
    db.budget.findFirst.mockResolvedValue(budget([{ id: "v1", status: "Approved", versionNumber: 1 }]));
    const locked = mockRes();
    await budgets.updateVersion(req({ lines: [] }, { budgetId: "b1", versionId: "v1" }), locked);
    expect(locked.json.mock.calls[0][0].message).toMatch(/new version/);
    db.budget.findFirst.mockResolvedValue(budget([{ id: "v1", status: "Submitted", versionNumber: 1, createdByMembershipId: "m1" }]));
    const own = mockRes();
    await budgets.approveVersion(req({}, { budgetId: "b1", versionId: "v1" }), own);
    expect(own.status).toHaveBeenCalledWith(403);
  });

  it("activation supersedes the previous active version and posts nothing", async () => {
    db.budget.findFirst.mockResolvedValue(budget([{ id: "v2", status: "Approved", versionNumber: 2 }, { id: "v1", status: "Active", versionNumber: 1 }]));
    const res = mockRes();
    await budgets.activateVersion(req({}, { budgetId: "b1", versionId: "v2" }), res);
    expect(db.budgetVersion.updateMany.mock.calls[0][0]).toMatchObject({ where: { budgetId: "b1", status: "Active" }, data: { status: "Superseded" } });
    expect(db.budgetVersion.update.mock.calls[0][0]).toMatchObject({ where: { id: "v2" }, data: { status: "Active" } });
    expect(res.json.mock.calls[0][0].note).toMatch(/No journals/);
  });
});

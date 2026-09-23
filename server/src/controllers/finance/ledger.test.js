import { describe, it, expect, vi, beforeEach } from "vitest";

const db = {
  financeSettings: { findUnique: vi.fn(async () => null), upsert: vi.fn() },
  financeOverride: { create: vi.fn() },
  journalEntry: { findFirst: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn(async () => ({ count: 1 })), count: vi.fn(async () => 0), create: vi.fn() },
  journalLine: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0) },
  ledgerAccount: { findMany: vi.fn(async () => []), findFirst: vi.fn(), count: vi.fn(async () => 0), update: vi.fn() },
  fiscalPeriod: { findFirst: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn(async () => ({ count: 1 })) },
  fiscalYear: { findFirst: vi.fn(async () => null), create: vi.fn(async ({ data }) => ({ id: "fy1", ...data })) },
  exchangeRate: { findFirst: vi.fn(async () => null) },
  auditEvent: { create: vi.fn() },
  salesDocumentCounter: { upsert: vi.fn(), update: vi.fn(async () => ({ value: 1 })) },
};
db.$transaction = vi.fn(async (arg) => (typeof arg === "function" ? arg(db) : Promise.all(arg)));
vi.mock("../../lib/prisma.js", () => ({ default: db }));

const { buildJournalLines, periodRefusal, resolveRate, reverseJournal, LedgerError } = await import("../../services/finance/ledgerService.js");
const { parseAmount, parseDay, checkSeparation, isCurrency } = await import("../../services/finance/financeCommon.js");
const setup = await import("./ledgerSetupController.js");
const journals = await import("./journalsController.js");

const acct = (id, over = {}) => ({ id, code: id.toUpperCase(), organizationId: "org1", type: "Asset", normalBalance: "Debit", active: true, archivedAt: null, postingAllowed: true, currency: null, ...over });
const accounts = new Map([["cash", acct("cash")], ["rev", acct("rev", { type: "Revenue", normalBalance: "Credit" })], ["hdr", acct("hdr", { postingAllowed: false })], ["old", acct("old", { active: false })], ["eur", acct("eur", { currency: "EUR" })]]);
const build = (lines, opts = {}) => buildJournalLines(lines, { currency: "USD", accountsById: accounts, ...opts });

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}
const grantsReq = (grants, body = {}, extra = {}) => ({
  body, query: {}, params: {}, headers: {}, organizationId: "org1", user: { id: "u1" }, isSystemOwnerOverride: false,
  membership: { id: "m1", roles: [{ role: { defaultScope: "Organization", permissionGrants: Object.entries(grants).map(([moduleId, actions]) => ({ moduleId, actions })) } }] },
  ...extra,
});

beforeEach(() => {
  for (const m of Object.values(db)) if (typeof m === "object") for (const fn of Object.values(m)) fn.mockClear?.();
});

describe("double-entry validation", () => {
  it("accepts a balanced journal and computes base amounts", () => {
    const built = build([{ accountId: "cash", debit: "100.10" }, { accountId: "rev", credit: 100.1 }]);
    expect(built.totalDebit.toFixed(2)).toBe("100.10");
    expect(built.lines[0].baseDebit.toFixed(2)).toBe("100.10");
  });

  it("refuses unbalanced, one-line, both-sided, zero, negative and float-noise lines", () => {
    expect(() => build([{ accountId: "cash", debit: 100 }, { accountId: "rev", credit: 99 }])).toThrow(/don't balance/);
    expect(() => build([{ accountId: "cash", debit: 100 }])).toThrow(/at least two lines/);
    expect(() => build([{ accountId: "cash", debit: 5, credit: 5 }, { accountId: "rev", credit: 0 }])).toThrow(/both a debit and a credit/);
    expect(() => build([{ accountId: "cash", debit: 0 }, { accountId: "rev", credit: 0 }])).toThrow(/needs a debit or a credit/);
    expect(() => build([{ accountId: "cash", debit: -5 }, { accountId: "rev", credit: -5 }])).toThrow(/negative/);
    expect(() => build([{ accountId: "cash", debit: "10.001" }, { accountId: "rev", credit: "10.001" }])).toThrow(/decimal places/);
  });

  it("refuses header, inactive, unknown and currency-restricted accounts", () => {
    expect(() => build([{ accountId: "hdr", debit: 1 }, { accountId: "rev", credit: 1 }])).toThrow(/header account/);
    expect(() => build([{ accountId: "old", debit: 1 }, { accountId: "rev", credit: 1 }])).toThrow(/inactive/);
    expect(() => build([{ accountId: "nope", debit: 1 }, { accountId: "rev", credit: 1 }])).toThrow(/doesn't exist/);
    expect(() => build([{ accountId: "eur", debit: 1 }, { accountId: "rev", credit: 1 }])).toThrow(/only accepts EUR/);
  });

  it("keeps base amounts balanced after conversion rounding and reports the adjustment", () => {
    const built = build([{ accountId: "cash", debit: "0.01" }, { accountId: "cash", debit: "0.01" }, { accountId: "rev", credit: "0.02" }], { currency: "EUR", baseCurrency: "USD", exchangeRate: "1.5", accountsById: new Map([...accounts, ["cash", acct("cash")]]) });
    const bd = built.lines.reduce((s, l) => s.plus(l.baseDebit), built.lines[0].baseDebit.minus(built.lines[0].baseDebit));
    const bc = built.lines.reduce((s, l) => s.plus(l.baseCredit), bd.minus(bd));
    expect(bd.equals(bc)).toBe(true);
    expect(built.roundingAdjustment.toFixed(2)).toBe("0.01");
  });
});

describe("money, dates, currencies", () => {
  it("parses amounts without floats and validates currencies", () => {
    expect(parseAmount("0.1", { field: "a" }).plus(parseAmount("0.2", { field: "b" })).toFixed(2)).toBe("0.30");
    expect(() => parseAmount("1e3")).toThrow(/plain number/);
    expect(() => parseAmount(NaN)).toThrow();
    expect(isCurrency("USD")).toBe(true);
    expect(isCurrency("usd")).toBe(false);
    expect(isCurrency("XYZ")).toBe(false);
    expect(parseDay("2026-09-24T18:00:00Z").toISOString()).toBe("2026-09-24T00:00:00.000Z");
  });
});

describe("fiscal periods", () => {
  it("closed periods refuse postings; soft-closed need fiscal_periods:post", () => {
    expect(periodRefusal(null)).toMatch(/No fiscal period/);
    expect(periodRefusal({ name: "Jan", status: "Closed" }, { canPostSoftClosed: true })).toMatch(/closed/);
    expect(periodRefusal({ name: "Jan", status: "Soft Closed" })).toMatch(/fiscal_periods:post/);
    expect(periodRefusal({ name: "Jan", status: "Soft Closed" }, { canPostSoftClosed: true })).toBeNull();
    expect(periodRefusal({ name: "Jan", status: "Reopened" })).toBeNull();
  });

  it("generates monthly periods and refuses overlapping years", async () => {
    const periods = setup.monthlyPeriods(new Date("2026-01-01"), new Date("2026-12-31"));
    expect(periods).toHaveLength(12);
    expect(periods[1]).toMatchObject({ periodNumber: 2, name: "Feb 2026" });
    expect(periods[1].endDate.toISOString().slice(0, 10)).toBe("2026-02-28");
    db.fiscalYear.findFirst.mockResolvedValueOnce({ name: "FY 2026" });
    const res = mockRes();
    await setup.createFiscalYear(grantsReq({}, { startDate: "2026-06-01" }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toMatch(/overlaps/);
  });

  it("the person who soft-closed a period can't close it; reopening needs a reason", async () => {
    db.fiscalPeriod.findFirst.mockResolvedValue({ id: "p1", status: "Soft Closed", version: 2, softClosedByMembershipId: "m1", startDate: new Date(), endDate: new Date() });
    const res = mockRes();
    await setup.closePeriod(grantsReq({}, {}, { params: { periodId: "p1" } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json.mock.calls[0][0].code).toBe("FINANCE_SEPARATION_OF_DUTIES");

    const reopen = mockRes();
    await setup.reopenPeriod(grantsReq({}, {}, { params: { periodId: "p1" } }), reopen);
    expect(reopen.status).toHaveBeenCalledWith(400);
  });
});

describe("separation of duties and the emergency override", () => {
  const args = { settings: { separationOfDuties: true }, sameActor: true, rule: "Creator can't approve.", action: "x", targetType: "JournalEntry", targetId: "j1" };

  it("denies the same person, and records the attempt", async () => {
    const res = mockRes();
    expect(await checkSeparation(grantsReq({}), res, args)).toBe(false);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(db.auditEvent.create.mock.calls[0][0].data).toMatchObject({ action: "finance.separation_of_duties.denied", result: "Denied" });
  });

  it("an override needs the grant AND a reason, and is recorded for auditors", async () => {
    expect(await checkSeparation(grantsReq({}, { overrideReason: "Only approver on leave" }), mockRes(), args)).toBe(false);
    expect(await checkSeparation(grantsReq({ finance_overrides: ["override_controls"] }), mockRes(), args)).toBe(false);
    expect(await checkSeparation(grantsReq({ finance_overrides: ["override_controls"] }, { overrideReason: "Only approver on leave" }), mockRes(), args)).toBe(true);
    expect(db.financeOverride.create.mock.calls[0][0].data).toMatchObject({ rule: "Creator can't approve.", reason: "Only approver on leave" });
  });

  it("can be switched off per organization", async () => {
    expect(await checkSeparation(grantsReq({}), mockRes(), { ...args, settings: { separationOfDuties: false } })).toBe(true);
  });
});

describe("journal workflow", () => {
  const journal = (over = {}) => ({ id: "j1", organizationId: "org1", entryNumber: "JE-2026-000001", status: "Submitted", version: 3, sourceType: "Manual", createdByMembershipId: "m2", submittedByMembershipId: "m2", approvedByMembershipId: null, lines: [], currency: "USD", entryDate: new Date("2026-09-01"), ...over });

  it("the creator can't approve their own journal", async () => {
    db.journalEntry.findFirst.mockResolvedValue(journal({ createdByMembershipId: "m1", submittedByMembershipId: "m1" }));
    const res = mockRes();
    await journals.approveJournal(grantsReq({ journals: ["approve"] }, {}, { params: { journalId: "j1" } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("with approval required, only an approved journal posts, and never by its approver", async () => {
    db.journalEntry.findFirst.mockResolvedValue(journal());
    const notApproved = mockRes();
    await journals.postJournalEntry(grantsReq({ journals: ["post"] }, {}, { params: { journalId: "j1" } }), notApproved);
    expect(notApproved.status).toHaveBeenCalledWith(400);

    db.journalEntry.findFirst.mockResolvedValue(journal({ status: "Approved", approvedByMembershipId: "m1" }));
    const ownApproval = mockRes();
    await journals.postJournalEntry(grantsReq({ journals: ["post"] }, {}, { params: { journalId: "j1" } }), ownApproval);
    expect(ownApproval.status).toHaveBeenCalledWith(403);
  });

  it("document journals are posted and reversed through their document", async () => {
    db.journalEntry.findFirst.mockResolvedValue(journal({ status: "Posted", sourceType: "Invoice" }));
    const res = mockRes();
    await journals.reverseJournalEntry(grantsReq({ journals: ["reverse"] }, { reason: "x" }, { params: { journalId: "j1" } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("a stale version is a conflict", async () => {
    db.journalEntry.findFirst.mockResolvedValue(journal({ status: "Draft" }));
    const res = mockRes();
    await journals.submitJournal(grantsReq({ journals: ["create"] }, { version: 1 }, { params: { journalId: "j1" } }), res);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it("reversal mirrors every line and links both entries; a closed period refuses it", async () => {
    const posted = journal({ status: "Posted", totalDebit: 50, totalCredit: 50, exchangeRate: 1, lines: [{ lineNumber: 1, accountId: "cash", debit: 50, credit: 0, baseDebit: 50, baseCredit: 0, currency: "USD" }, { lineNumber: 2, accountId: "rev", debit: 0, credit: 50, baseDebit: 0, baseCredit: 50, currency: "USD" }] });
    db.fiscalPeriod.findFirst.mockResolvedValueOnce({ id: "p9", name: "Sep 2026", status: "Closed" });
    await expect(reverseJournal(db, posted, { membershipId: "m1", reason: "Wrong account" })).rejects.toBeInstanceOf(LedgerError);

    db.fiscalPeriod.findFirst.mockResolvedValueOnce({ id: "p9", name: "Sep 2026", status: "Open" });
    await reverseJournal(db, posted, { membershipId: "m1", reason: "Wrong account" });
    const data = db.journalEntry.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ reversalOfId: "j1", sourceType: "Reversal", status: "Posted" });
    expect(data.lines.create[0]).toMatchObject({ debit: 0, credit: 50, baseCredit: 50 });
    expect(db.journalEntry.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: "j1", status: "Posted" }, data: { status: "Reversed" } });
  });

  it("a missing exchange rate is refused, never guessed", async () => {
    await expect(resolveRate(db, "org1", "EUR", "USD", new Date("2026-09-01"))).rejects.toThrow(/No approved exchange rate/);
    db.exchangeRate.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "x1", rate: "2" });
    const { rate } = await resolveRate(db, "org1", "EUR", "USD", new Date("2026-09-01"));
    expect(rate.toString()).toBe("0.5");
  });
});

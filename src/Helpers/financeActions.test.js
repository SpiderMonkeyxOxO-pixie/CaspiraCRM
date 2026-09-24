import { describe, it, expect, vi, beforeEach } from "vitest";

const financePost = vi.fn(async () => ({ ok: true }));
vi.mock("./backendFinanceClient", () => ({ financePost: (...a) => financePost(...a), BACKEND_FINANCE_MODE_ENABLED: false }));

const { runQueueAction, NEEDS_REASON, NEEDS_FINANCIAL_ACCOUNT } = await import("./financeActions");
const { canDo, hasAnyFinance } = await import("./financeAccess");

beforeEach(() => financePost.mockClear());

describe("finance work-queue actions", () => {
  it("posting steps send an idempotency key; approvals don't", async () => {
    await runQueueAction("org1", { kind: "invoice", id: "i1" }, "post");
    expect(financePost).toHaveBeenLastCalledWith("/finance/invoices/i1/post", "org1", {}, true);
    await runQueueAction("org1", { kind: "payment", id: "p1" }, "approve");
    expect(financePost).toHaveBeenLastCalledWith("/finance/payments/p1/approve", "org1", {}, undefined);
  });

  it("maps reasons, reimbursement accounts, budget paths and overrides", async () => {
    await runQueueAction("org1", { kind: "expense", id: "e1" }, "reject", { reason: "No receipt" });
    expect(financePost).toHaveBeenLastCalledWith("/finance/expenses/e1/review", "org1", { status: "Rejected", note: "No receipt" }, undefined);
    await runQueueAction("org1", { kind: "expenseReport", id: "r1" }, "reimburse", { financialAccountId: "fa1" });
    expect(financePost).toHaveBeenLastCalledWith("/finance/expense-reports/r1/reimburse", "org1", { financialAccountId: "fa1" }, true);
    await runQueueAction("org1", { kind: "budgetVersion", id: "v2", budgetId: "b1" }, "activate");
    expect(financePost).toHaveBeenLastCalledWith("/finance/budgets/b1/versions/v2/activate", "org1", {}, true);
    await runQueueAction("org1", { kind: "journal", id: "j1" }, "approve", { overrideReason: "Only approver away" });
    expect(financePost).toHaveBeenLastCalledWith("/finance/journals/j1/approve", "org1", { overrideReason: "Only approver away" }, undefined);
    expect(NEEDS_REASON.has("reject") && NEEDS_FINANCIAL_ACCOUNT.has("reimburse")).toBe(true);
  });

  it("refuses unknown actions instead of guessing", async () => {
    await expect(runQueueAction("org1", { kind: "invoice", id: "i1" }, "reverse")).rejects.toThrow(/isn't available/);
    expect(financePost).not.toHaveBeenCalled();
  });
});

describe("finance access helpers", () => {
  const data = { systemOwner: false, access: { invoices: ["view"], journals: [] } };
  it("reads grants; the System Owner can do everything", () => {
    expect(canDo(data, "invoices", "view")).toBe(true);
    expect(canDo(data, "invoices", "post")).toBe(false);
    expect(canDo({ systemOwner: true, access: {} }, "journals", "post")).toBe(true);
    expect(hasAnyFinance(data)).toBe(true);
    expect(hasAnyFinance({ systemOwner: false, access: { invoices: [] } })).toBe(false);
    expect(canDo(null, "invoices", "view")).toBe(false);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockQuoteFindMany = vi.fn().mockResolvedValue([]);
const mockContractFindMany = vi.fn().mockResolvedValue([]);
const mockObligationUpdateMany = vi.fn().mockResolvedValue({ count: 0 });
const mockOutboxFindFirst = vi.fn().mockResolvedValue(null);
const mockOutboxCreate = vi.fn().mockResolvedValue({});

vi.mock("../../lib/prisma.js", () => ({
  default: {
    quote: { findMany: (...a) => mockQuoteFindMany(...a) },
    contract: { findMany: (...a) => mockContractFindMany(...a) },
    contractObligation: { updateMany: (...a) => mockObligationUpdateMany(...a) },
    outboxEvent: { findFirst: (...a) => mockOutboxFindFirst(...a), create: (...a) => mockOutboxCreate(...a) },
  },
}));

const { detectExpiredQuotes, detectExpiredContracts, detectRenewalNoticeDeadlines, detectOverdueObligations, runSalesDeadlineSweep } = await import("./salesDeadlineJobs.js");

describe("salesDeadlineJobs", () => {
  beforeEach(() => vi.clearAllMocks());

  it("detectExpiredQuotes creates one notification per candidate and skips if already pending", async () => {
    mockQuoteFindMany.mockResolvedValueOnce([{ id: "q1", organizationId: "org-1", quoteNumber: "QUOTE-1", validUntilDate: new Date() }]);
    mockOutboxFindFirst.mockResolvedValueOnce(null);
    const count = await detectExpiredQuotes();
    expect(count).toBe(1);
    expect(mockOutboxCreate).toHaveBeenCalledTimes(1);
  });

  it("detectExpiredQuotes is idempotent — skips creating a duplicate notification", async () => {
    mockQuoteFindMany.mockResolvedValueOnce([{ id: "q1", organizationId: "org-1", quoteNumber: "QUOTE-1" }]);
    mockOutboxFindFirst.mockResolvedValueOnce({ id: "existing" });
    await detectExpiredQuotes();
    expect(mockOutboxCreate).not.toHaveBeenCalled();
  });

  it("detectExpiredContracts filters via isExpired before notifying", async () => {
    const past = new Date(Date.now() - 86400000);
    const future = new Date(Date.now() + 86400000);
    mockContractFindMany.mockResolvedValueOnce([
      { id: "c1", organizationId: "org-1", contractNumber: "CONTRACT-1", status: "Signed", endDate: past },
      { id: "c2", organizationId: "org-1", contractNumber: "CONTRACT-2", status: "Signed", endDate: future },
    ]);
    const count = await detectExpiredContracts();
    expect(count).toBe(1);
  });

  it("detectRenewalNoticeDeadlines only flags contracts within their notice window", async () => {
    const soon = new Date(Date.now() + 5 * 86400000);
    mockContractFindMany.mockResolvedValueOnce([{ id: "c1", organizationId: "org-1", contractNumber: "CONTRACT-1", status: "Signed", renewalType: "Auto-Renew", renewalNoticeDays: 30, endDate: soon }]);
    const count = await detectRenewalNoticeDeadlines();
    expect(count).toBe(1);
  });

  it("detectOverdueObligations flips Open/In Progress past-due obligations to Overdue", async () => {
    mockObligationUpdateMany.mockResolvedValueOnce({ count: 3 });
    const count = await detectOverdueObligations();
    expect(count).toBe(3);
    expect(mockObligationUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "Overdue" } }));
  });

  it("runSalesDeadlineSweep runs all four checks and aggregates counts", async () => {
    const result = await runSalesDeadlineSweep();
    expect(result).toEqual({ expiredQuotes: 0, expiredContracts: 0, renewalNotices: 0, overdueObligations: 0 });
  });
});

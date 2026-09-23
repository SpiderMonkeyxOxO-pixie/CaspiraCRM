import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCount = vi.fn();
const mockCreate = vi.fn().mockResolvedValue({ id: "pipeline-1" });
const mockStageCreateMany = vi.fn().mockResolvedValue({ count: 9 });
const mockTransaction = vi.fn(async (fn) => fn({ pipeline: { count: mockCount, create: mockCreate }, pipelineStage: { createMany: mockStageCreateMany } }));

vi.mock("../../lib/prisma.js", () => ({
  default: { pipeline: { count: (...a) => mockCount(...a) }, $transaction: (...a) => mockTransaction(...a) },
}));

const { ensureDefaultPipelines } = await import("./pipelineSeedService.js");

describe("ensureDefaultPipelines", () => {
  beforeEach(() => vi.clearAllMocks());

  it("is a no-op when the organization already has a pipeline", async () => {
    mockCount.mockResolvedValueOnce(1);
    await ensureDefaultPipelines("org-1", "m-1");
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("creates exactly 3 pipelines, each with its 9 ordered stages in one insert", async () => {
    mockCount.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
    await ensureDefaultPipelines("org-1", "m-1");
    expect(mockCreate).toHaveBeenCalledTimes(3);
    expect(mockStageCreateMany).toHaveBeenCalledTimes(3);
    const stages = mockStageCreateMany.mock.calls[0][0].data;
    expect(stages.map((s) => s.name)).toEqual(["Discovery", "Qualified", "Proposal", "Negotiation", "Approval", "Won", "Lost", "Cancelled", "On Hold"]);
    expect(stages.map((s) => s.displayOrder)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(stages.find((s) => s.name === "Won").classification).toBe("Won");
  });

  it("re-checks inside the transaction and skips if another request already seeded", async () => {
    mockCount.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    await ensureDefaultPipelines("org-1", "m-1");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("treats losing a concurrent seeding race (unique violation) as success once pipelines exist", async () => {
    mockCount.mockResolvedValueOnce(0).mockResolvedValueOnce(3);
    mockTransaction.mockRejectedValueOnce(Object.assign(new Error("Unique constraint failed"), { code: "P2002" }));
    await expect(ensureDefaultPipelines("org-1", "m-1")).resolves.toBeUndefined();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCount = vi.fn();
const mockCreate = vi.fn().mockResolvedValue({ id: "pipeline-1" });
const mockStageCreate = vi.fn().mockResolvedValue({});
const mockTransaction = vi.fn(async (fn) => fn({ pipeline: { count: mockCount, create: mockCreate }, pipelineStage: { create: mockStageCreate } }));

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

  it("creates exactly 3 pipelines, each with 9 stages, for a brand-new organization", async () => {
    mockCount.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
    await ensureDefaultPipelines("org-1", "m-1");
    expect(mockCreate).toHaveBeenCalledTimes(3);
    expect(mockStageCreate).toHaveBeenCalledTimes(27);
  });

  it("re-checks inside the transaction and skips if another request already seeded", async () => {
    mockCount.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    await ensureDefaultPipelines("org-1", "m-1");
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

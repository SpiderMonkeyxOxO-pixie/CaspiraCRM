import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGet = vi.fn();
const mockPost = vi.fn();
vi.mock("../../Helpers/axiosInstance", () => ({
  default: { get: (...args) => mockGet(...args), post: (...args) => mockPost(...args) },
}));

const { fetchProviderStatus, requestNarrative, requestExploration } = await import("./aiGatewayClient");

describe("aiGatewayClient", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
  });

  it("fetchProviderStatus GETs /ai/providers and unwraps the providers array", async () => {
    mockGet.mockResolvedValue({ data: { providers: [{ id: "anthropic", configured: false }] } });
    const result = await fetchProviderStatus();
    expect(mockGet).toHaveBeenCalledWith("/ai/providers");
    expect(result).toEqual([{ id: "anthropic", configured: false }]);
  });

  it("requestNarrative POSTs /ai/narrative with the payload and returns the response body", async () => {
    mockPost.mockResolvedValue({ data: { narrative: "Hello", numbersVerified: true, provider: { id: "anthropic" } } });
    const result = await requestNarrative({ executiveSummary: "x", facts: { a: 1 } });
    expect(mockPost).toHaveBeenCalledWith("/ai/narrative", { provider: undefined, executiveSummary: "x", facts: { a: 1 } });
    expect(result.narrative).toBe("Hello");
  });

  it("requestExploration POSTs /ai/explore with the payload and returns the response body", async () => {
    mockPost.mockResolvedValue({ data: { findings: [], truncated: false, provider: {}, disclaimer: "d" } });
    const result = await requestExploration({ scopeLabel: "Executive", records: {} });
    expect(mockPost).toHaveBeenCalledWith("/ai/explore", { provider: undefined, question: undefined, scopeLabel: "Executive", records: {} });
    expect(result.disclaimer).toBe("d");
  });

  it("propagates a rejected request rather than swallowing the error", async () => {
    mockPost.mockRejectedValue(Object.assign(new Error("Service Unavailable"), { response: { status: 503 } }));
    await expect(requestNarrative({ executiveSummary: "x", facts: {} })).rejects.toThrow("Service Unavailable");
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetProvider = vi.fn();
vi.mock("./providerRegistry.js", () => ({ getProvider: (...args) => mockGetProvider(...args) }));

import { generateNarrative, generateExploration } from "./aiGatewayService.js";

function fakeProvider(completeImpl) {
  return { id: "fake", label: "Fake Provider", complete: completeImpl };
}

describe("aiGatewayService", () => {
  beforeEach(() => { mockGetProvider.mockReset(); });

  describe("generateNarrative", () => {
    const facts = { openPipelineValue: "$482,300", openPipelineCount: 14 };

    it("returns the model's narrative when every number is verified against facts", async () => {
      mockGetProvider.mockReturnValue(fakeProvider(async () => ({
        text: "Pipeline holds at $482,300 across 14 deals.", modelUsed: "fake-model-v1",
      })));
      const result = await generateNarrative({ executiveSummary: "Original deterministic summary.", facts });
      expect(result.narrative).toBe("Pipeline holds at $482,300 across 14 deals.");
      expect(result.numbersVerified).toBe(true);
      expect(result.provider).toEqual({ id: "fake", label: "Fake Provider", model: "fake-model-v1" });
    });

    it("falls back to the original deterministic summary when the model fabricates a number", async () => {
      mockGetProvider.mockReturnValue(fakeProvider(async () => ({
        text: "Pipeline holds at $999,999,999 across 14 deals.", modelUsed: "fake-model-v1",
      })));
      const result = await generateNarrative({ executiveSummary: "Original deterministic summary.", facts });
      expect(result.narrative).toBe("Original deterministic summary.");
      expect(result.numbersVerified).toBe(false);
    });

    it("falls back when the model returns empty text", async () => {
      mockGetProvider.mockReturnValue(fakeProvider(async () => ({ text: "   ", modelUsed: "fake-model-v1" })));
      const result = await generateNarrative({ executiveSummary: "Original deterministic summary.", facts });
      expect(result.narrative).toBe("Original deterministic summary.");
    });

    it("surfaces a clean timeout error without waiting the real 25s wall-clock delay", async () => {
      vi.useFakeTimers();
      mockGetProvider.mockReturnValue(fakeProvider(() => new Promise(() => {}))); // never resolves on its own
      const pending = generateNarrative({ executiveSummary: "x", facts: {} });
      const assertion = expect(pending).rejects.toMatchObject({ status: 504 });
      await vi.advanceTimersByTimeAsync(25000);
      await assertion;
      vi.useRealTimers();
    });
  });

  describe("generateExploration", () => {
    const records = { deals: [{ _id: "d1", name: "Acme Deal" }], companies: [{ _id: "c1", name: "Acme" }] };

    it("returns findings whose citations resolve against the sent records", async () => {
      mockGetProvider.mockReturnValue(fakeProvider(async () => ({
        text: JSON.stringify({ findings: [{ title: "Stalled deal", observation: "d1 has been idle.", citedRecordIds: ["d1"] }] }),
        modelUsed: "fake-model-v1",
      })));
      const result = await generateExploration({ role: "Super-Admin", scopeLabel: "Executive", records });
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0].citedRecordIds).toEqual(["d1"]);
    });

    it("drops citedRecordIds that don't correspond to any sent record — untrusted model output", async () => {
      mockGetProvider.mockReturnValue(fakeProvider(async () => ({
        text: JSON.stringify({ findings: [{ title: "x", observation: "y", citedRecordIds: ["d1", "totally-invented-id"] }] }),
        modelUsed: "fake-model-v1",
      })));
      const result = await generateExploration({ role: "Super-Admin", scopeLabel: "Executive", records });
      expect(result.findings[0].citedRecordIds).toEqual(["d1"]);
    });

    it("drops a suggestedAction whose affectedRecordId does not resolve", async () => {
      mockGetProvider.mockReturnValue(fakeProvider(async () => ({
        text: JSON.stringify({ findings: [{
          title: "x", observation: "y", citedRecordIds: ["d1"],
          suggestedAction: { type: "create_follow_up", label: "Follow up", reason: "r", affectedRecordId: "does-not-exist", affectedRecordType: "Deal" },
        }] }),
        modelUsed: "fake-model-v1",
      })));
      const result = await generateExploration({ role: "Super-Admin", scopeLabel: "Executive", records });
      expect(result.findings[0].suggestedAction).toBeUndefined();
    });

    it("keeps a suggestedAction whose affectedRecordId does resolve", async () => {
      mockGetProvider.mockReturnValue(fakeProvider(async () => ({
        text: JSON.stringify({ findings: [{
          title: "x", observation: "y", citedRecordIds: ["d1"],
          suggestedAction: { type: "create_follow_up", label: "Follow up", reason: "r", affectedRecordId: "d1", affectedRecordType: "Deal" },
        }] }),
        modelUsed: "fake-model-v1",
      })));
      const result = await generateExploration({ role: "Super-Admin", scopeLabel: "Executive", records });
      expect(result.findings[0].suggestedAction.affectedRecordId).toBe("d1");
    });

    it("rejects a suggestedAction whose type is outside the known enum, via schema validation", async () => {
      mockGetProvider.mockReturnValue(fakeProvider(async () => ({
        text: JSON.stringify({ findings: [{
          title: "x", observation: "y", citedRecordIds: ["d1"],
          suggestedAction: { type: "delete_everything", label: "Nope", reason: "r", affectedRecordId: "d1", affectedRecordType: "Deal" },
        }] }),
        modelUsed: "fake-model-v1",
      })));
      await expect(generateExploration({ role: "Super-Admin", scopeLabel: "Executive", records })).rejects.toMatchObject({ status: 502 });
    });

    it("throws a clean 502 when the model returns non-JSON text", async () => {
      mockGetProvider.mockReturnValue(fakeProvider(async () => ({ text: "not json at all", modelUsed: "fake-model-v1" })));
      await expect(generateExploration({ role: "Super-Admin", scopeLabel: "Executive", records })).rejects.toMatchObject({ status: 502 });
    });

    it("caps large record sets and reports truncated: true", async () => {
      const manyDeals = Array.from({ length: 50 }, (_, i) => ({ _id: `d${i}` }));
      mockGetProvider.mockReturnValue(fakeProvider(async () => ({ text: JSON.stringify({ findings: [] }), modelUsed: "fake-model-v1" })));
      const result = await generateExploration({ role: "Super-Admin", scopeLabel: "Executive", records: { deals: manyDeals } });
      expect(result.truncated).toBe(true);
    });
  });
});

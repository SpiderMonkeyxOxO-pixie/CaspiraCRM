import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const mockFindUnique = vi.fn();
vi.mock("../lib/prisma.js", () => ({
  default: { user: { findUnique: (...args) => mockFindUnique(...args) } },
}));

const mockListProviderStatuses = vi.fn();
vi.mock("../services/ai/providerRegistry.js", () => ({
  listProviderStatuses: (...args) => mockListProviderStatuses(...args),
}));

const mockGenerateNarrative = vi.fn();
const mockGenerateExploration = vi.fn();
vi.mock("../services/ai/aiGatewayService.js", () => ({
  generateNarrative: (...args) => mockGenerateNarrative(...args),
  generateExploration: (...args) => mockGenerateExploration(...args),
}));

const app = (await import("../app.js")).default;
const { signToken } = await import("../utils/jwt.js");
const { _resetCooldowns } = await import("../services/ai/guardrails.js");

const AUTH_USER = { id: "user-1", role: "Super-Admin", email: "owner@test.com" };
const token = signToken({ sub: AUTH_USER.id });

describe("aiRoutes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetCooldowns();
    mockFindUnique.mockResolvedValue(AUTH_USER);
  });

  it("rejects an unauthenticated request with 401", async () => {
    const res = await request(app).get("/api/v1/ai/providers");
    expect(res.status).toBe(401);
  });

  describe("GET /providers", () => {
    it("returns the provider statuses list when authenticated", async () => {
      mockListProviderStatuses.mockReturnValue([
        { id: "anthropic", label: "Anthropic (Claude)", configured: false, defaultModel: "claude-haiku-4-5-20251001" },
      ]);
      const res = await request(app).get("/api/v1/ai/providers").set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.providers).toHaveLength(1);
      expect(res.body.providers[0].id).toBe("anthropic");
    });
  });

  describe("POST /narrative", () => {
    it("returns 400 when executiveSummary is missing", async () => {
      const res = await request(app).post("/api/v1/ai/narrative").set("Authorization", `Bearer ${token}`).send({ facts: {} });
      expect(res.status).toBe(400);
    });

    it("returns 503 when no provider is configured", async () => {
      mockGenerateNarrative.mockRejectedValue(Object.assign(new Error("No AI provider is configured on this server."), { status: 503 }));
      const res = await request(app).post("/api/v1/ai/narrative").set("Authorization", `Bearer ${token}`).send({ executiveSummary: "x", facts: {} });
      expect(res.status).toBe(503);
    });

    it("returns the generated narrative on success", async () => {
      mockGenerateNarrative.mockResolvedValue({
        narrative: "Hello narrative", numbersVerified: true,
        provider: { id: "anthropic", label: "Anthropic (Claude)", model: "m" },
      });
      const res = await request(app).post("/api/v1/ai/narrative").set("Authorization", `Bearer ${token}`).send({ executiveSummary: "x", facts: {} });
      expect(res.status).toBe(200);
      expect(res.body.narrative).toBe("Hello narrative");
      expect(res.body.provider.id).toBe("anthropic");
      expect(res.body.generatedAt).toBeTruthy();
    });

    it("returns 429 on a second rapid request from the same user", async () => {
      mockGenerateNarrative.mockResolvedValue({
        narrative: "Hello", numbersVerified: true, provider: { id: "anthropic", label: "Anthropic (Claude)", model: "m" },
      });
      await request(app).post("/api/v1/ai/narrative").set("Authorization", `Bearer ${token}`).send({ executiveSummary: "x", facts: {} });
      const res = await request(app).post("/api/v1/ai/narrative").set("Authorization", `Bearer ${token}`).send({ executiveSummary: "x", facts: {} });
      expect(res.status).toBe(429);
    });
  });

  describe("POST /explore", () => {
    it("returns 400 when records is missing", async () => {
      const res = await request(app).post("/api/v1/ai/explore").set("Authorization", `Bearer ${token}`).send({ scopeLabel: "Executive" });
      expect(res.status).toBe(400);
    });

    it("returns findings with the attribution disclaimer on success", async () => {
      mockGenerateExploration.mockResolvedValue({
        findings: [{ title: "Stalled deal", observation: "Idle for 20 days.", citedRecordIds: ["d1"] }],
        truncated: false,
        provider: { id: "anthropic", label: "Anthropic (Claude)", model: "m" },
      });
      const res = await request(app).post("/api/v1/ai/explore").set("Authorization", `Bearer ${token}`).send({
        scopeLabel: "Executive", records: {},
      });
      expect(res.status).toBe(200);
      expect(res.body.findings).toHaveLength(1);
      expect(res.body.disclaimer).toMatch(/Anthropic/);
      expect(res.body.disclaimer).toMatch(/Not verified by the deterministic engine/);
    });
  });
});

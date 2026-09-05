import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { listProviderStatuses, getProvider, PROVIDER_ORDER } from "./providerRegistry.js";

describe("providerRegistry", () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
  });
  afterEach(() => { process.env = { ...originalEnv }; });

  it("listProviderStatuses reports all three providers as unconfigured when no keys are set", () => {
    const statuses = listProviderStatuses();
    expect(statuses).toHaveLength(3);
    expect(statuses.every((s) => s.configured === false)).toBe(true);
    expect(statuses.map((s) => s.id)).toEqual(PROVIDER_ORDER);
  });

  it("listProviderStatuses reflects a configured provider without leaking the key value", () => {
    process.env.OPENAI_API_KEY = "sk-real-looking-key";
    const statuses = listProviderStatuses();
    const openai = statuses.find((s) => s.id === "openai");
    expect(openai.configured).toBe(true);
    expect(JSON.stringify(statuses)).not.toContain("sk-real-looking-key");
  });

  it("getProvider throws a 503 when no provider is configured", () => {
    expect(() => getProvider()).toThrow(/no ai provider is configured/i);
    try { getProvider(); } catch (e) { expect(e.status).toBe(503); }
  });

  it("getProvider auto-picks the first configured provider in PROVIDER_ORDER when id is omitted", () => {
    process.env.OPENAI_API_KEY = "sk-fake";
    const provider = getProvider();
    expect(provider.id).toBe("openai");
  });

  it("getProvider throws a 400 for an unknown provider id", () => {
    try { getProvider("not-a-real-provider"); } catch (e) { expect(e.status).toBe(400); }
  });

  it("getProvider throws a 503 for a valid but unconfigured provider id", () => {
    process.env.OPENAI_API_KEY = "sk-fake"; // configure a different one
    try { getProvider("anthropic"); throw new Error("should have thrown"); } catch (e) { expect(e.status).toBe(503); }
  });
});

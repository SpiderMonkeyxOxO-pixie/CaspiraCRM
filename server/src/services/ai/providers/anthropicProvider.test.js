import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@anthropic-ai/sdk", () => {
  const create = vi.fn().mockResolvedValue({
    model: "claude-haiku-4-5-20251001",
    content: [{ type: "text", text: "Hello from Claude." }],
    usage: { input_tokens: 10, output_tokens: 5 },
  });
  return { default: vi.fn().mockImplementation(() => ({ messages: { create } })) };
});

import Anthropic from "@anthropic-ai/sdk";
import { isConfigured, complete, envVar, id, label } from "./anthropicProvider.js";

describe("anthropicProvider", () => {
  const originalEnv = { ...process.env };
  beforeEach(() => { delete process.env.ANTHROPIC_API_KEY; });
  afterEach(() => { process.env = { ...originalEnv }; });

  it("isConfigured is false when the key is unset or blank", () => {
    expect(isConfigured()).toBe(false);
    process.env.ANTHROPIC_API_KEY = "   ";
    expect(isConfigured()).toBe(false);
  });

  it("isConfigured is true once a non-blank key is set — presence only, never validated", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-fake-for-test";
    expect(isConfigured()).toBe(true);
  });

  it("exposes the expected uniform provider identity", () => {
    expect(id).toBe("anthropic");
    expect(label).toBe("Anthropic (Claude)");
    expect(envVar).toBe("ANTHROPIC_API_KEY");
  });

  it("complete() calls the SDK and returns the uniform {text, modelUsed, usage} shape — no real network call", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-fake-for-test";
    const result = await complete({ system: "sys", prompt: "hi", maxTokens: 100 });
    expect(result).toEqual({ text: "Hello from Claude.", modelUsed: "claude-haiku-4-5-20251001", usage: { inputTokens: 10, outputTokens: 5 } });
    expect(Anthropic).toHaveBeenCalledWith({ apiKey: "sk-ant-fake-for-test" });
  });
});

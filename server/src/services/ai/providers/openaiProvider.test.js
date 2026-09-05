import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("openai", () => {
  const create = vi.fn().mockResolvedValue({
    model: "gpt-4o-mini",
    choices: [{ message: { content: "Hello from GPT." } }],
    usage: { prompt_tokens: 12, completion_tokens: 6 },
  });
  return { default: vi.fn().mockImplementation(() => ({ chat: { completions: { create } } })) };
});

import OpenAI from "openai";
import { isConfigured, complete, envVar, id, label } from "./openaiProvider.js";

describe("openaiProvider", () => {
  const originalEnv = { ...process.env };
  beforeEach(() => { delete process.env.OPENAI_API_KEY; });
  afterEach(() => { process.env = { ...originalEnv }; });

  it("isConfigured is false when unset", () => {
    expect(isConfigured()).toBe(false);
  });

  it("isConfigured is true once set", () => {
    process.env.OPENAI_API_KEY = "sk-fake-for-test";
    expect(isConfigured()).toBe(true);
  });

  it("exposes the expected uniform provider identity", () => {
    expect(id).toBe("openai");
    expect(label).toBe("OpenAI");
    expect(envVar).toBe("OPENAI_API_KEY");
  });

  it("complete() returns the uniform shape — no real network call", async () => {
    process.env.OPENAI_API_KEY = "sk-fake-for-test";
    const result = await complete({ system: "sys", prompt: "hi", maxTokens: 100 });
    expect(result).toEqual({ text: "Hello from GPT.", modelUsed: "gpt-4o-mini", usage: { inputTokens: 12, outputTokens: 6 } });
    expect(OpenAI).toHaveBeenCalledWith({ apiKey: "sk-fake-for-test" });
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("openai", () => {
  const create = vi.fn().mockResolvedValue({
    model: "anthropic/claude-3.5-haiku",
    choices: [{ message: { content: "Hello via OpenRouter." } }],
    usage: { prompt_tokens: 8, completion_tokens: 4 },
  });
  return { default: vi.fn().mockImplementation(() => ({ chat: { completions: { create } } })) };
});

import OpenAI from "openai";
import { isConfigured, complete, envVar, id, label, defaultModel } from "./openrouterProvider.js";

describe("openrouterProvider", () => {
  const originalEnv = { ...process.env };
  beforeEach(() => { delete process.env.OPENROUTER_API_KEY; });
  afterEach(() => { process.env = { ...originalEnv }; });

  it("isConfigured is false when unset", () => {
    expect(isConfigured()).toBe(false);
  });

  it("isConfigured is true once set", () => {
    process.env.OPENROUTER_API_KEY = "sk-or-fake-for-test";
    expect(isConfigured()).toBe(true);
  });

  it("exposes the expected uniform provider identity and reuses the openai package rather than a 4th SDK", () => {
    expect(id).toBe("openrouter");
    expect(label).toBe("OpenRouter");
    expect(envVar).toBe("OPENROUTER_API_KEY");
    expect(defaultModel).toBe("openrouter/auto");
  });

  it("complete() points the openai client at OpenRouter's baseURL and returns the uniform shape", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-fake-for-test";
    const result = await complete({ system: "sys", prompt: "hi", maxTokens: 100 });
    expect(result).toEqual({ text: "Hello via OpenRouter.", modelUsed: "anthropic/claude-3.5-haiku", usage: { inputTokens: 8, outputTokens: 4 } });
    expect(OpenAI).toHaveBeenCalledWith(expect.objectContaining({ apiKey: "sk-or-fake-for-test", baseURL: "https://openrouter.ai/api/v1" }));
  });
});

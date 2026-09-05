// OpenRouter exposes an OpenAI-compatible API, so it reuses the `openai`
// package pointed at a different baseURL instead of needing its own SDK.
import OpenAI from "openai";

export const id = "openrouter";
export const label = "OpenRouter";
export const envVar = "OPENROUTER_API_KEY";
// "auto" lets OpenRouter pick a model for you; override via OPENROUTER_MODEL
// to pin a specific one (e.g. "anthropic/claude-3.5-haiku").
export const defaultModel = "openrouter/auto";

export function isConfigured() {
  return Boolean(process.env.OPENROUTER_API_KEY?.trim());
}

export async function complete({ system, prompt, maxTokens, model, signal }) {
  const client = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: "https://openrouter.ai/api/v1",
    defaultHeaders: {
      "HTTP-Referer": process.env.CLIENT_ORIGIN || "http://localhost:5173",
      "X-Title": "Caspira CRM",
    },
  });
  const response = await client.chat.completions.create(
    {
      model: model || process.env.OPENROUTER_MODEL || defaultModel,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
    },
    { signal }
  );
  const text = response.choices?.[0]?.message?.content || "";
  return {
    text,
    modelUsed: response.model,
    usage: { inputTokens: response.usage?.prompt_tokens ?? null, outputTokens: response.usage?.completion_tokens ?? null },
  };
}

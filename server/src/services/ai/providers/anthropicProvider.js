import Anthropic from "@anthropic-ai/sdk";

export const id = "anthropic";
export const label = "Anthropic (Claude)";
export const envVar = "ANTHROPIC_API_KEY";
// Haiku 4.5's real current model id — cheap, fast, appropriate default for
// short narrative/exploration calls. Override per-deployment via
// ANTHROPIC_MODEL without touching code.
export const defaultModel = "claude-haiku-4-5-20251001";

// Presence check only — this never validates that the key is authentic or
// has quota. A bad key still surfaces as a clean upstream-error response
// from complete(), not a false "configured" status.
export function isConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

export async function complete({ system, prompt, maxTokens, model, signal }) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await client.messages.create(
    {
      model: model || process.env.ANTHROPIC_MODEL || defaultModel,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: prompt }],
    },
    { signal }
  );
  const text = response.content.find((block) => block.type === "text")?.text || "";
  return {
    text,
    modelUsed: response.model,
    usage: { inputTokens: response.usage?.input_tokens ?? null, outputTokens: response.usage?.output_tokens ?? null },
  };
}

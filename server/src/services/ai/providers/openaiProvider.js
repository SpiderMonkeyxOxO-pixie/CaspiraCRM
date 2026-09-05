import OpenAI from "openai";

export const id = "openai";
export const label = "OpenAI";
export const envVar = "OPENAI_API_KEY";
// A reasonable low-cost default at time of writing — model availability
// changes over time and per-account, so this is deliberately overridable
// via OPENAI_MODEL rather than asserted as permanently correct.
export const defaultModel = "gpt-4o-mini";

export function isConfigured() {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

export async function complete({ system, prompt, maxTokens, model, signal }) {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await client.chat.completions.create(
    {
      model: model || process.env.OPENAI_MODEL || defaultModel,
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

// Backend Phase 9 — OpenRouter adapter (OpenAI-compatible chat completions,
// openrouter.ai/docs). Disabled by default: OpenRouter forwards requests to
// third-party hosts, so an organization must allow it explicitly.
import { aiRequest, aiStream } from "../common/http.js";
import { completeAiAdapter, parseJsonText } from "./contract.js";

const BASE = "https://openrouter.ai/api/v1";
const headers = (apiKey) => ({ Authorization: `Bearer ${apiKey}`, "X-Title": "Caspira CRM" });
const usageOf = (u) => ({ inputTokens: u?.prompt_tokens ?? 0, outputTokens: u?.completion_tokens ?? 0, cachedTokens: u?.prompt_tokens_details?.cached_tokens ?? 0 });

function body({ model, system, prompt, maxOutputTokens, outputSchema, stream }) {
  return {
    model, max_tokens: maxOutputTokens, stream: !!stream,
    messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
    ...(outputSchema && { response_format: { type: "json_schema", json_schema: { name: outputSchema.name, schema: outputSchema.schema } } }),
  };
}

export const openrouterAdapter = completeAiAdapter("openrouter", {
  label: "OpenRouter",
  async listModels({ apiKey, signal }) {
    const { data } = await aiRequest(`${BASE}/models`, { method: "GET", headers: headers(apiKey), signal, timeoutMs: 15_000 });
    return (data?.data || []).map((m) => ({ modelId: m.id, displayName: m.name || m.id }));
  },
  // The key endpoint is authenticated, so it proves the key works.
  async verifyCredentials({ apiKey, signal }) {
    await aiRequest(`${BASE}/key`, { method: "GET", headers: headers(apiKey), signal, timeoutMs: 15_000 });
    return { models: await this.listModels({ apiKey, signal }) };
  },
  async generate(params) {
    const { apiKey, signal, timeoutMs, stream, onDelta, outputSchema } = params;
    let text = "";
    let usage = usageOf(null);
    let id = null;
    let finishReason = null;
    if (!stream) {
      const { data } = await aiRequest(`${BASE}/chat/completions`, { headers: headers(apiKey), json: body(params), signal, timeoutMs });
      text = data?.choices?.[0]?.message?.content || "";
      finishReason = data?.choices?.[0]?.finish_reason || null;
      usage = usageOf(data?.usage);
      id = data?.id || null;
    } else {
      await aiStream(`${BASE}/chat/completions`, { headers: headers(apiKey), json: body(params), signal, timeoutMs }, ({ data }) => {
        if (!data || typeof data !== "object") return;
        const delta = data.choices?.[0]?.delta?.content || "";
        if (delta) { text += delta; onDelta?.(delta); }
        finishReason = data.choices?.[0]?.finish_reason || finishReason;
        if (data.usage) usage = usageOf(data.usage);
        id ||= data.id || null;
      });
    }
    return { text, json: outputSchema ? parseJsonText(text) : undefined, toolCalls: [], refusal: finishReason === "content_filter", finishReason, usage, providerRequestId: id, model: params.model };
  },
  normalizeUsage: usageOf,
});

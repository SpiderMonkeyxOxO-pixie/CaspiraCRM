// Backend Phase 9 — OpenAI adapter (Responses API,
// platform.openai.com/docs/api-reference/responses). Requests go out with
// store=false unless the organization's policy explicitly enables
// provider-side storage. Structured output uses a JSON-schema text format;
// tools are function tools whose calls are returned, never executed here.
import { aiRequest, aiStream } from "../common/http.js";
import { AiError, CATEGORIES } from "../common/errors.js";
import { completeAiAdapter, parseJsonText } from "./contract.js";

const BASE = "https://api.openai.com/v1";
const headers = (apiKey) => ({ Authorization: `Bearer ${apiKey}` });

export function normalizeOpenAiUsage(u) {
  return { inputTokens: u?.input_tokens ?? 0, outputTokens: u?.output_tokens ?? 0, cachedTokens: u?.input_tokens_details?.cached_tokens ?? 0 };
}

// Reads a complete Responses API object.
export function parseOpenAiResponse(data) {
  let text = "";
  let refusal = false;
  const toolCalls = [];
  for (const item of data?.output || []) {
    if (item.type === "message") {
      for (const c of item.content || []) {
        if (c.type === "output_text") text += c.text || "";
        if (c.type === "refusal") refusal = true;
      }
    } else if (item.type === "function_call") {
      toolCalls.push({ name: item.name, arguments: parseJsonText(item.arguments) ?? {} });
    }
  }
  return {
    text, refusal, toolCalls, finishReason: data?.status === "incomplete" ? data?.incomplete_details?.reason || "incomplete" : data?.status || "completed",
    usage: normalizeOpenAiUsage(data?.usage), providerRequestId: data?.id || null, model: data?.model || null,
  };
}

function body({ model, system, prompt, maxOutputTokens, outputSchema, tools, toolChoice, stream, providerStorage, safetyIdentifier }) {
  return {
    model, instructions: system, input: [{ role: "user", content: prompt }], max_output_tokens: maxOutputTokens,
    store: providerStorage === true, stream: !!stream,
    // Phase 11: HMAC-derived, versioned identifier (never a name, email or raw id).
    ...(safetyIdentifier && { safety_identifier: safetyIdentifier }),
    ...(outputSchema && { text: { format: { type: "json_schema", name: outputSchema.name, schema: outputSchema.schema, strict: false } } }),
    ...(tools?.length && { tools: tools.map((t) => ({ type: "function", name: t.name, description: t.description, parameters: t.parameters })) }),
    ...(toolChoice && { tool_choice: { type: "function", name: toolChoice } }),
  };
}

export const openaiAdapter = completeAiAdapter("openai", {
  label: "OpenAI",
  async listModels({ apiKey, signal }) {
    const { data } = await aiRequest(`${BASE}/models`, { method: "GET", headers: headers(apiKey), signal, timeoutMs: 15_000 });
    return (data?.data || []).map((m) => ({ modelId: m.id, displayName: m.id })).sort((a, b) => a.modelId.localeCompare(b.modelId));
  },
  async verifyCredentials(args) {
    return { models: await this.listModels(args) };
  },
  async generate(params) {
    const { apiKey, signal, timeoutMs, stream, onDelta, outputSchema } = params;
    let result;
    if (!stream) {
      const { data, requestId } = await aiRequest(`${BASE}/responses`, { headers: headers(apiKey), json: body(params), signal, timeoutMs });
      result = parseOpenAiResponse(data);
      result.providerRequestId ||= requestId;
    } else {
      let completed = null;
      let failed = null;
      let text = "";
      const { requestId } = await aiStream(`${BASE}/responses`, { headers: headers(apiKey), json: body(params), signal, timeoutMs }, ({ data }) => {
        if (!data || typeof data !== "object") return;
        if (data.type === "response.output_text.delta") { text += data.delta || ""; onDelta?.(data.delta || ""); }
        else if (data.type === "response.completed" || data.type === "response.incomplete") completed = data.response;
        else if (data.type === "response.failed" || data.type === "error") failed = data;
      });
      if (failed) throw new AiError(CATEGORIES.PROVIDER_UNAVAILABLE, "The AI provider reported a failure while streaming.", { providerCode: failed.response?.error?.code || failed.code });
      result = completed ? parseOpenAiResponse(completed) : { text, refusal: false, toolCalls: [], finishReason: "incomplete", usage: normalizeOpenAiUsage(null), providerRequestId: requestId, model: params.model };
      if (!result.text) result.text = text;
      result.providerRequestId ||= requestId;
    }
    if (outputSchema && !result.refusal) result.json = parseJsonText(result.text);
    return result;
  },
  normalizeUsage: normalizeOpenAiUsage,
});

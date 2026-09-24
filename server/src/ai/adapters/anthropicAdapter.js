// Backend Phase 9 — Anthropic adapter (Messages API,
// docs.anthropic.com/en/api/messages). Structured output is requested as a
// forced tool call whose input schema is the output schema; other tools
// are returned as requested calls, never executed here. No provider-side
// memory or storage feature is used.
import { aiRequest, aiStream } from "../common/http.js";
import { AiError, CATEGORIES } from "../common/errors.js";
import { completeAiAdapter, parseJsonText } from "./contract.js";

const BASE = "https://api.anthropic.com/v1";
const VERSION = "2023-06-01";
const headers = (apiKey) => ({ "x-api-key": apiKey, "anthropic-version": VERSION });
const RESULT_TOOL = "emit_result";

export function normalizeAnthropicUsage(u) {
  return { inputTokens: (u?.input_tokens ?? 0) + (u?.cache_creation_input_tokens ?? 0), outputTokens: u?.output_tokens ?? 0, cachedTokens: u?.cache_read_input_tokens ?? 0 };
}

export function parseAnthropicMessage(data, { structured = false } = {}) {
  let text = "";
  let json;
  const toolCalls = [];
  for (const block of data?.content || []) {
    if (block.type === "text") text += block.text || "";
    if (block.type === "tool_use") {
      if (structured && block.name === RESULT_TOOL) json = block.input;
      else toolCalls.push({ name: block.name, arguments: block.input ?? {} });
    }
  }
  return {
    text, json, toolCalls, refusal: data?.stop_reason === "refusal", finishReason: data?.stop_reason || null,
    usage: normalizeAnthropicUsage(data?.usage), providerRequestId: data?.id || null, model: data?.model || null,
  };
}

function body({ model, system, prompt, maxOutputTokens, outputSchema, tools, toolChoice, stream }) {
  const allTools = [
    ...(outputSchema ? [{ name: RESULT_TOOL, description: `Return the result as ${outputSchema.name}.`, input_schema: outputSchema.schema }] : []),
    ...(tools || []).map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })),
  ];
  const forced = outputSchema ? RESULT_TOOL : toolChoice || null;
  return {
    model, system, max_tokens: maxOutputTokens, messages: [{ role: "user", content: prompt }], stream: !!stream,
    ...(allTools.length && { tools: allTools }),
    ...(forced && { tool_choice: { type: "tool", name: forced } }),
  };
}

export const anthropicAdapter = completeAiAdapter("anthropic", {
  label: "Anthropic (Claude)",
  async listModels({ apiKey, signal }) {
    const { data } = await aiRequest(`${BASE}/models?limit=100`, { method: "GET", headers: headers(apiKey), signal, timeoutMs: 15_000 });
    return (data?.data || []).map((m) => ({ modelId: m.id, displayName: m.display_name || m.id }));
  },
  async verifyCredentials(args) {
    return { models: await this.listModels(args) };
  },
  async generate(params) {
    const { apiKey, signal, timeoutMs, stream, onDelta, outputSchema } = params;
    const structured = !!outputSchema;
    if (!stream) {
      const { data, requestId } = await aiRequest(`${BASE}/messages`, { headers: headers(apiKey), json: body(params), signal, timeoutMs });
      const out = parseAnthropicMessage(data, { structured });
      out.providerRequestId ||= requestId;
      if (structured && out.json === undefined) out.json = parseJsonText(out.text);
      return out;
    }
    // Streaming: rebuild the message from its events.
    const message = { id: null, model: params.model, content: [], stop_reason: null, usage: {} };
    let current = null;
    let failed = null;
    const { requestId } = await aiStream(`${BASE}/messages`, { headers: headers(apiKey), json: body(params), signal, timeoutMs }, ({ data }) => {
      if (!data || typeof data !== "object") return;
      if (data.type === "message_start") { message.id = data.message?.id; message.model = data.message?.model || message.model; Object.assign(message.usage, data.message?.usage || {}); }
      else if (data.type === "content_block_start") { current = { ...data.content_block, _json: "" }; if (current.type === "text") current.text = ""; message.content.push(current); }
      else if (data.type === "content_block_delta" && current) {
        if (data.delta?.type === "text_delta") { current.text += data.delta.text || ""; if (!structured) onDelta?.(data.delta.text || ""); }
        if (data.delta?.type === "input_json_delta") current._json += data.delta.partial_json || "";
      } else if (data.type === "content_block_stop" && current) {
        if (current.type === "tool_use") current.input = parseJsonText(current._json) ?? current.input ?? {};
        current = null;
      } else if (data.type === "message_delta") { message.stop_reason = data.delta?.stop_reason ?? message.stop_reason; Object.assign(message.usage, data.usage || {}); }
      else if (data.type === "error") failed = data.error;
    });
    if (failed) throw new AiError(failed.type === "overloaded_error" ? CATEGORIES.PROVIDER_UNAVAILABLE : CATEGORIES.UNKNOWN, "The AI provider reported a failure while streaming.", { providerCode: failed.type });
    const out = parseAnthropicMessage(message, { structured });
    out.providerRequestId ||= requestId;
    return out;
  },
  normalizeUsage: normalizeAnthropicUsage,
});

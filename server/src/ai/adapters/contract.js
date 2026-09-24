// Backend Phase 9 — the provider-neutral AI adapter contract.
//
//   verifyCredentials({ apiKey, signal })      → { models: [{ modelId, displayName }] }
//   listModels({ apiKey, signal })             → [{ modelId, displayName }]
//   generate({ apiKey, model, system, prompt, maxOutputTokens, outputSchema,
//              tools, toolChoice, stream, onDelta, providerStorage, signal, timeoutMs })
//        → { text, json, toolCalls: [{ name, arguments }], refusal, finishReason,
//            usage: { inputTokens, outputTokens, cachedTokens }, providerRequestId, model }
//   cancel                                    — through the AbortSignal passed to generate
//   requestToolCall                           — tools are returned as requested calls; the
//                                               gateway decides, adapters never execute them
//   embed                                     — declared; unsupported in Phase 9
//   normalizeUsage / normalizeError / getRateLimitState
//
// Anything a provider doesn't support returns an explicit unsupported
// result instead of silently doing nothing.
import { AiError, CATEGORIES } from "../common/errors.js";

export const AI_OPERATIONS = ["verifyCredentials", "listModels", "generate", "embed", "normalizeUsage", "normalizeError", "getRateLimitState"];

export const unsupported = (providerKey, operation) => ({ supported: false, providerKey, operation, reason: `${providerKey} does not support ${operation} in this phase.` });

export function completeAiAdapter(providerKey, partial) {
  const adapter = { providerKey, ...partial };
  for (const op of AI_OPERATIONS) {
    if (typeof adapter[op] !== "function") adapter[op] = async () => unsupported(providerKey, op);
  }
  if (!partial.normalizeError) adapter.normalizeError = (err) => (err instanceof AiError ? err : new AiError(CATEGORIES.UNKNOWN, "The AI provider request failed."));
  adapter.supports = (op) => typeof partial[op] === "function";
  return adapter;
}

export const emptyUsage = () => ({ inputTokens: 0, outputTokens: 0, cachedTokens: 0 });

// Parses JSON text a model returned (tolerates a fenced block).
export function parseJsonText(text) {
  const trimmed = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { return JSON.parse(trimmed); } catch { return undefined; }
}

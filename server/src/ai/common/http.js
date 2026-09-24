// Backend Phase 9 — the only way the AI gateway talks to a provider.
// Timeouts, cancellation, Retry-After parsing, error classification and
// server-sent-event parsing in one place. Request and response bodies are
// never logged. Tests swap the transport, so no test ever reaches a real
// provider.
import { AiError, CATEGORIES, classifyProviderHttp } from "./errors.js";
import { parseRetryAfter } from "../../integrations/common/http.js";

const defaultTransport = (url, init) => fetch(url, init);
let transport = defaultTransport;
export const setAiTransport = (fn) => { transport = fn; };
export const resetAiTransport = () => { transport = defaultTransport; };

// Sets a hard deadline and links the caller's abort signal.
function deadline(timeoutMs, signal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);
  const onAbort = () => controller.abort(new Error("cancelled"));
  if (signal) {
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }
  return { signal: controller.signal, done: () => { clearTimeout(timer); signal?.removeEventListener?.("abort", onAbort); }, controller };
}

function abortError(signal) {
  const reason = String(signal?.reason?.message || "");
  if (reason === "cancelled") return new AiError(CATEGORIES.UNKNOWN, "The request was cancelled.", { details: { cancelled: true } });
  return new AiError(CATEGORIES.TIMEOUT, "The AI provider didn't answer in time.");
}

async function send(url, { method = "POST", headers = {}, json, timeoutMs = 30_000, signal } = {}) {
  const d = deadline(timeoutMs, signal);
  const init = { method, headers: { Accept: "application/json", ...headers }, signal: d.signal };
  if (json !== undefined) { init.body = JSON.stringify(json); init.headers["Content-Type"] = "application/json"; }
  try {
    const response = await transport(url, init);
    return { response, d };
  } catch (err) {
    d.done();
    if (d.signal.aborted) throw abortError(d.signal);
    throw new AiError(CATEGORIES.PROVIDER_UNAVAILABLE, "The AI provider couldn't be reached.", { status: 0, details: { network: err?.name || "error" } });
  }
}

async function failFrom(response) {
  const text = await response.text().catch(() => "");
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  return classifyProviderHttp(response.status, { retryAfterMs: parseRetryAfter(response.headers), body });
}

// JSON request → { status, data, headers, requestId }.
export async function aiRequest(url, options = {}) {
  const { response, d } = await send(url, options);
  try {
    if (!response.ok) throw await failFrom(response);
    const text = await response.text();
    if (text.length > 5_000_000) throw new AiError(CATEGORIES.INVALID_REQUEST, "The AI provider's response was too large.");
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { throw new AiError(CATEGORIES.PROVIDER_UNAVAILABLE, "The AI provider returned an unreadable response."); }
    return { status: response.status, data, headers: response.headers, requestId: response.headers?.get?.("x-request-id") || response.headers?.get?.("request-id") || null };
  } catch (err) {
    if (d.signal.aborted && !(err instanceof AiError)) throw abortError(d.signal);
    throw err;
  } finally {
    d.done();
  }
}

// Server-sent events: calls onEvent({ event, data }) for each event, where
// data is parsed JSON when possible. Resolves when the stream ends.
export async function aiStream(url, options = {}, onEvent) {
  const { response, d } = await send(url, { ...options, headers: { ...options.headers, Accept: "text/event-stream" } });
  try {
    if (!response.ok) throw await failFrom(response);
    const requestId = response.headers?.get?.("x-request-id") || response.headers?.get?.("request-id") || null;
    const reader = response.body?.getReader?.();
    const decoder = new TextDecoder();
    let buffer = "";
    const flush = (block) => {
      let event = "message";
      const dataLines = [];
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
      }
      if (!dataLines.length) return;
      const raw = dataLines.join("\n");
      if (raw === "[DONE]") return;
      let data = raw;
      try { data = JSON.parse(raw); } catch { /* keep text */ }
      onEvent({ event, data });
    };
    if (!reader) {
      for (const block of (await response.text()).split(/\r?\n\r?\n/)) flush(block);
      return { requestId };
    }
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.search(/\r?\n\r?\n/)) >= 0) {
        flush(buffer.slice(0, idx));
        buffer = buffer.slice(idx).replace(/^\r?\n\r?\n/, "");
      }
    }
    if (buffer.trim()) flush(buffer);
    return { requestId };
  } catch (err) {
    if (d.signal.aborted && !(err instanceof AiError)) throw abortError(d.signal);
    throw err;
  } finally {
    d.done();
  }
}

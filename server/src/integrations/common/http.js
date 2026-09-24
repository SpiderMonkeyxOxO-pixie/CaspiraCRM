// Backend Phase 8 — the only way the integration layer talks to a provider.
// Timeouts, Retry-After / rate-limit header parsing, error normalization and
// usage counting in one place. Request and response bodies are never logged.
//
// `transport` is replaceable: tests (and the in-process simulator) swap in a
// function with the same (url, init) → Response-like signature.
import { IntegrationError, KINDS, classifyHttp } from "./errors.js";

let transport = (url, init) => fetch(url, init);
export const setTransport = (fn) => { transport = fn; };
export const resetTransport = () => { transport = (url, init) => fetch(url, init); };

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 5_000_000;

// Retry-After is seconds or an HTTP date; x-ratelimit-reset is epoch seconds.
export function parseRetryAfter(headers, now = Date.now()) {
  const get = (h) => (typeof headers?.get === "function" ? headers.get(h) : headers?.[h] ?? headers?.[h.toLowerCase()]);
  const ra = get("retry-after");
  if (ra) {
    if (/^\d+$/.test(ra)) return Number(ra) * 1000;
    const at = Date.parse(ra);
    if (!Number.isNaN(at)) return Math.max(0, at - now);
  }
  const reset = get("x-ratelimit-reset");
  const remaining = get("x-ratelimit-remaining");
  if (reset && remaining === "0" && /^\d+$/.test(reset)) return Math.max(0, Number(reset) * 1000 - now);
  return null;
}

export function rateLimitSnapshot(headers) {
  const get = (h) => (typeof headers?.get === "function" ? headers.get(h) : null);
  const remaining = get("x-ratelimit-remaining");
  const limit = get("x-ratelimit-limit");
  return remaining || limit ? { remaining: remaining ? Number(remaining) : null, limit: limit ? Number(limit) : null, reset: get("x-ratelimit-reset") } : null;
}

// → { status, data, headers, rateLimit }; throws IntegrationError on failure.
export async function providerRequest(url, { method = "GET", headers = {}, json, form, bearer, basic, timeoutMs = DEFAULT_TIMEOUT_MS, onUsage } = {}) {
  const init = { method, headers: { Accept: "application/json", ...headers } };
  if (bearer) init.headers.Authorization = `Bearer ${bearer}`;
  if (basic) init.headers.Authorization = `Basic ${Buffer.from(`${basic.user}:${basic.pass}`).toString("base64")}`;
  if (json !== undefined) { init.body = JSON.stringify(json); init.headers["Content-Type"] = "application/json"; }
  if (form) { init.body = new URLSearchParams(form).toString(); init.headers["Content-Type"] = "application/x-www-form-urlencoded"; }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  init.signal = controller.signal;
  let response;
  try {
    response = await transport(url, init);
  } catch (err) {
    onUsage?.({ error: true });
    throw new IntegrationError(KINDS.TRANSIENT, err?.name === "AbortError" ? "The provider didn't answer in time." : "The provider couldn't be reached.", { status: 0 });
  } finally {
    clearTimeout(timer);
  }
  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) throw new IntegrationError(KINDS.PERMANENT, "The provider's response was too large.");
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  const retryAfterMs = parseRetryAfter(response.headers);
  onUsage?.({ rateLimited: response.status === 429, error: !response.ok });
  if (!response.ok) throw classifyHttp(response.status, { retryAfterMs, body: data });
  // Slack reports errors as 200 { ok: false }.
  if (data && typeof data === "object" && data.ok === false && data.error) {
    const e = data.error;
    if (/invalid_auth|token_revoked|account_inactive|not_authed|token_expired/.test(e)) throw new IntegrationError(KINDS.AUTH_INVALID, "The provider rejected the stored credentials. Reauthorize the connection.", { providerCode: e });
    if (/missing_scope/.test(e)) throw new IntegrationError(KINDS.SCOPE_MISSING, "A required permission (scope) is missing. Reauthorize with the needed scope.", { providerCode: e });
    if (/ratelimited/.test(e)) throw new IntegrationError(KINDS.RATE_LIMITED, "The provider is rate limiting this connection.", { retryAfterMs: retryAfterMs ?? 60_000, providerCode: e });
    throw new IntegrationError(KINDS.PERMANENT, "The provider rejected the request.", { providerCode: e });
  }
  return { status: response.status, data, headers: response.headers, rateLimit: rateLimitSnapshot(response.headers) };
}

// Backend Phase 9 — normalized AI errors. Every provider or gateway failure
// becomes one category, so retries, budgets, the circuit breaker and the
// API response never depend on a provider's own error shape. Messages are
// safe to store and show: no keys, provider bodies, prompts or stack traces.
export const CATEGORIES = {
  AUTHENTICATION: "authentication", // the provider rejected the key → reverify, never retried
  PERMISSION: "permission", // the caller lacks a CRM permission, or the key lacks model access
  RATE_LIMITED: "rate_limited", // provider or CRM rate limit → retry after the delay
  BUDGET: "budget", // a hard budget would be exceeded
  POLICY: "policy", // the organization's AI policy refuses the request
  INVALID_REQUEST: "invalid_request", // bad input, unknown model, oversized context
  CONTENT_REFUSED: "content_refused", // the model refused, or the output failed validation
  TIMEOUT: "timeout",
  PROVIDER_UNAVAILABLE: "provider_unavailable", // 5xx, network, circuit open → retried with backoff
  UNKNOWN: "unknown",
};

export class AiError extends Error {
  constructor(category, message, { status = null, retryAfterMs = null, providerCode = null, details = null } = {}) {
    super(message);
    this.category = category;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
    this.providerCode = providerCode ? String(providerCode).slice(0, 80) : null;
    this.details = details;
  }
  get retryable() {
    return this.category === CATEGORIES.PROVIDER_UNAVAILABLE || this.category === CATEGORIES.TIMEOUT || (this.category === CATEGORIES.RATE_LIMITED && (this.retryAfterMs ?? 0) <= 5_000);
  }
}

export const httpStatusFor = (err) => ({
  [CATEGORIES.AUTHENTICATION]: 502, [CATEGORIES.PERMISSION]: 403, [CATEGORIES.RATE_LIMITED]: 429, [CATEGORIES.BUDGET]: 409,
  [CATEGORIES.POLICY]: 403, [CATEGORIES.INVALID_REQUEST]: 422, [CATEGORIES.CONTENT_REFUSED]: 422, [CATEGORIES.TIMEOUT]: 504,
  [CATEGORIES.PROVIDER_UNAVAILABLE]: 502, [CATEGORIES.UNKNOWN]: 500,
}[err.category] || 500);

// httpStatus/code: explicit API outcomes (e.g. governance 404/409); err.status
// is the provider's HTTP status and is never used for the response.
export const sendAiError = (res, err) =>
  res.status(err.httpStatus || httpStatusFor(err)).json({
    code: err.code || `AI_${err.category.toUpperCase()}`, message: err.message,
    ...(err.retryAfterMs && { retryAfterSeconds: Math.ceil(err.retryAfterMs / 1000) }),
    ...(err.details && { details: err.details }),
  });

// Classifies a provider HTTP status (OpenAI, Anthropic and OpenRouter share
// the same broad meanings).
export function classifyProviderHttp(status, { retryAfterMs = null, body = null } = {}) {
  const hint = typeof body === "object" && body ? body.error?.type || body.error?.code || body.type || null : null;
  if (status === 401) return new AiError(CATEGORIES.AUTHENTICATION, "The AI provider rejected the organization's API key. Update or reverify the key.", { status, providerCode: hint });
  if (status === 403) return new AiError(CATEGORIES.PERMISSION, "The API key isn't allowed to use this model or feature at the provider.", { status, providerCode: hint });
  if (status === 404) return new AiError(CATEGORIES.INVALID_REQUEST, "The model isn't available to this API key.", { status, providerCode: hint });
  if (status === 408) return new AiError(CATEGORIES.TIMEOUT, "The AI provider didn't answer in time.", { status });
  if (status === 429) {
    if (/quota|insufficient|billing|credit/i.test(String(hint || ""))) return new AiError(CATEGORIES.RATE_LIMITED, "The provider account has no remaining quota. Check billing at the provider.", { status, retryAfterMs: retryAfterMs ?? 3_600_000, providerCode: hint });
    return new AiError(CATEGORIES.RATE_LIMITED, "The AI provider is rate limiting this organization.", { status, retryAfterMs: retryAfterMs ?? 30_000, providerCode: hint });
  }
  if (status === 529 || status >= 500 || status === 0) return new AiError(CATEGORIES.PROVIDER_UNAVAILABLE, "The AI provider is temporarily unavailable.", { status, retryAfterMs, providerCode: hint });
  if (status === 400 || status === 413 || status === 422) return new AiError(CATEGORIES.INVALID_REQUEST, "The AI provider rejected the request.", { status, providerCode: hint });
  return new AiError(CATEGORIES.UNKNOWN, "The AI provider request failed.", { status, providerCode: hint });
}

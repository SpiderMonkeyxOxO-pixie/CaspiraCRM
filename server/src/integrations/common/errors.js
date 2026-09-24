// Backend Phase 8 — normalized integration errors. Every provider failure
// becomes one of these kinds, so retry, reauthorization and circuit-breaker
// decisions never depend on a provider's own error shape. Messages are safe
// to show and store: no tokens, codes, payloads or stack traces.
export const KINDS = {
  AUTH_INVALID: "auth_invalid", // credentials rejected → Reauthorization Required, never retried
  SCOPE_MISSING: "scope_missing", // permission denied for a missing scope → reauthorize with more scopes
  RATE_LIMITED: "rate_limited", // retry after the provider's delay
  TRANSIENT: "transient", // 5xx / network → retry with backoff
  PERMANENT: "permanent", // validation / not found → never retried
  NOT_CONFIGURED: "not_configured",
  UNSUPPORTED: "unsupported",
  POLICY: "policy_denied",
};

export class IntegrationError extends Error {
  constructor(kind, message, { status = null, retryAfterMs = null, providerCode = null } = {}) {
    super(message);
    this.kind = kind;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
    this.providerCode = providerCode ? String(providerCode).slice(0, 80) : null;
  }
  get retryable() {
    return this.kind === KINDS.RATE_LIMITED || this.kind === KINDS.TRANSIENT;
  }
}

// An operation a provider doesn't support: an explicit result, never a
// silent no-op.
export const unsupported = (providerKey, operation, reason = null) => ({
  supported: false, providerKey, operation, reason: reason || `${providerKey} does not support ${operation}.`,
});

export const httpStatusFor = (err) => ({
  [KINDS.AUTH_INVALID]: 409, [KINDS.SCOPE_MISSING]: 409, [KINDS.RATE_LIMITED]: 429, [KINDS.TRANSIENT]: 502,
  [KINDS.PERMANENT]: 422, [KINDS.NOT_CONFIGURED]: 409, [KINDS.UNSUPPORTED]: 422, [KINDS.POLICY]: 403,
}[err.kind] || 500);

export const sendIntegrationError = (res, err) =>
  res.status(httpStatusFor(err)).json({ code: `INTEGRATION_${err.kind.toUpperCase()}`, message: err.message, ...(err.retryAfterMs && { retryAfterSeconds: Math.ceil(err.retryAfterMs / 1000) }) });

// Classifies an HTTP response from a provider.
export function classifyHttp(status, { retryAfterMs = null, providerCode = null, body = null } = {}) {
  const hint = typeof body === "object" && body ? body.error || body.code || body.message : null;
  if (status === 401) return new IntegrationError(KINDS.AUTH_INVALID, "The provider rejected the stored credentials. Reauthorize the connection.", { status, providerCode: hint || providerCode });
  if (status === 403) {
    if (/rate|limit/i.test(String(hint || ""))) return new IntegrationError(KINDS.RATE_LIMITED, "The provider is rate limiting this connection.", { status, retryAfterMs: retryAfterMs ?? 60_000, providerCode: hint });
    return new IntegrationError(KINDS.SCOPE_MISSING, "The provider refused this request — a permission (scope) may be missing.", { status, providerCode: hint || providerCode });
  }
  if (status === 429) return new IntegrationError(KINDS.RATE_LIMITED, "The provider is rate limiting this connection.", { status, retryAfterMs: retryAfterMs ?? 60_000, providerCode: hint });
  if (status >= 500 || status === 0) return new IntegrationError(KINDS.TRANSIENT, "The provider is temporarily unavailable.", { status, retryAfterMs, providerCode: hint });
  return new IntegrationError(KINDS.PERMANENT, "The provider rejected the request.", { status, providerCode: hint || providerCode });
}

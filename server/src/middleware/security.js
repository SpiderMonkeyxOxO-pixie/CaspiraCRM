// Backend Phase 13 — HTTP hardening shared by every API route: security
// headers, no shared caching of authenticated responses, a CORS allowlist,
// JSON content-type enforcement for request bodies and a handler timeout.
// The reverse proxy repeats the headers for static content; the API sets
// them itself so a misconfigured proxy can't silently drop them.
const strictProfile = () => ["staging", "production"].includes(process.env.APP_ENV);

export function securityHeaders(req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  // API responses are data, never documents; the docs UI needs its own scripts.
  if (!req.path.startsWith("/api/v1/docs")) res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  // HSTS only once HTTPS has been proven for the whole host (never preload here).
  if (process.env.HSTS_ENABLED === "true") res.setHeader("Strict-Transport-Security", `max-age=${Number(process.env.HSTS_MAX_AGE) || 15552000}; includeSubDomains`);
  // Authenticated CRM data must never be stored by a shared cache.
  if (req.path.startsWith("/api/")) res.setHeader("Cache-Control", "no-store");
  res.removeHeader("X-Powered-By");
  next();
}

export function allowedOrigins(env = process.env) {
  const list = String(env.CORS_ALLOWED_ORIGINS || env.CLIENT_ORIGIN || "http://localhost:5173").split(",").map((s) => s.trim()).filter(Boolean);
  return list.filter((o) => o !== "*");
}

// express `trust proxy`: a hop count, or explicit addresses/subnets. Never `true`.
export function trustProxySetting(value) {
  if (!value) return false;
  if (/^\d+$/.test(String(value))) return Number(value);
  if (["true", "*", "all"].includes(String(value).toLowerCase())) return strictProfile() ? false : 1;
  return String(value).split(",").map((s) => s.trim()).filter(Boolean);
}

// Mutating requests with a body must be JSON (webhooks with raw bodies are
// mounted before this and never reach it).
export function requireJsonBody(req, res, next) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();
  const length = Number(req.headers["content-length"] || 0);
  const chunked = /chunked/i.test(req.headers["transfer-encoding"] || "");
  if (!length && !chunked) return next();
  if (req.is("application/json")) return next();
  return res.status(415).json({ code: "UNSUPPORTED_MEDIA_TYPE", message: "Request bodies must be application/json.", correlationId: req.correlationId });
}

// Ends a handler that runs too long (streaming endpoints are exempt).
export function requestTimeout(ms = Number(process.env.API_REQUEST_TIMEOUT_MS) || 120_000) {
  return (req, res, next) => {
    if (/\/events$|\/stream/.test(req.path) || String(req.headers.accept || "").includes("text/event-stream")) return next();
    const timer = setTimeout(() => {
      if (!res.headersSent) res.status(503).json({ code: "REQUEST_TIMEOUT", message: "The request took too long. Please try again.", correlationId: req.correlationId });
    }, ms);
    timer.unref?.();
    res.on("finish", () => clearTimeout(timer));
    res.on("close", () => clearTimeout(timer));
    next();
  };
}

// The legacy bearer-token /api/v1/user API (self-registration, 7-day tokens)
// is off in staging and production unless explicitly re-enabled.
export function legacyUserApiEnabled(env = process.env) {
  if (!["staging", "production"].includes(env.APP_ENV)) return true;
  return env.LEGACY_USER_API === "true";
}

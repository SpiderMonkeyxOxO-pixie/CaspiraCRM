// Backend Phase 13 — environment profiles and startup validation.
//
// APP_ENV selects the profile: development | test | staging | production
// (defaulting from NODE_ENV). Development and test keep today's convenient
// defaults. Staging and production NEVER fall back to development defaults:
// a missing, malformed or insecure setting is an error and the process
// refuses to start. Pure function — no I/O beyond the injected readers.
import { readSecret, SECRET_NAMES } from "./secrets.js";

export const PROFILES = ["development", "test", "staging", "production"];
export const STRICT = new Set(["staging", "production"]);
export const CONFIG_SCHEMA_VERSION = 1;

// Values that must never protect a staging or production system.
const WEAK = ["dev-secret", "secret", "changeme", "change-me", "password", "postgres", "caspira", "caspira_dev_password", "admin", "123456", "caspira123!", "example", "placeholder", "test"];
const looksWeak = (v) => {
  const s = String(v || "").trim().toLowerCase();
  if (!s) return true;
  if (WEAK.includes(s)) return true;
  if (/^(x+|0+|1+|a+)$/.test(s)) return true;
  if (/change[-_ ]?me|replace[-_ ]?me|your[-_ ]|<.*>|example|placeholder|dev[-_]?password/.test(s)) return true;
  return false;
};
const isHttps = (u) => { try { return new URL(u).protocol === "https:"; } catch { return false; } };
const isLocal = (u) => { try { return ["localhost", "127.0.0.1", "::1", "0.0.0.0"].includes(new URL(u).hostname); } catch { return false; } };
const truthy = (v) => ["1", "true", "yes", "on"].includes(String(v || "").toLowerCase());

export function profileOf(env) {
  const explicit = (env.APP_ENV || "").toLowerCase();
  if (explicit) return explicit;
  if (env.NODE_ENV === "production") return "production";
  if (env.NODE_ENV === "test" || env.VITEST) return "test";
  return "development";
}

// → { profile, errors[], warnings[], apply{} (env values to set), secretSources{}, secretValues[] }
export function resolveConfig(env = process.env, readers = {}) {
  const errors = []; const warnings = []; const apply = {}; const secretSources = {}; const secretValues = [];
  const profile = profileOf(env);
  if (!PROFILES.includes(profile)) {
    return { profile, errors: [`APP_ENV must be one of ${PROFILES.join(", ")}.`], warnings, apply, secretSources, secretValues };
  }
  const strict = STRICT.has(profile);
  const secret = (name) => {
    const r = readSecret(name, env, readers);
    secretSources[name] = r.source;
    if (r.error) errors.push(r.error);
    if (r.value) secretValues.push(r.value);
    if (strict && r.source === "env" && !truthy(env.ALLOW_ENV_SECRETS)) {
      errors.push(`${name} must be provided as a secret file (${name}_FILE or ${env.SECRETS_DIR || "/run/secrets"}/${name.toLowerCase()}), not a plain environment variable.`);
    }
    return r.value;
  };

  // ── Database: DATABASE_URL, or parts with a password secret ───────────────
  let databaseUrl = secret("DATABASE_URL");
  const dbPassword = secret("DB_PASSWORD");
  if (!databaseUrl && env.DB_HOST && env.DB_NAME && env.DB_USER && dbPassword) {
    const params = new URLSearchParams({ schema: env.DB_SCHEMA || "public" });
    if (env.DB_CONNECTION_LIMIT) params.set("connection_limit", env.DB_CONNECTION_LIMIT);
    if (env.DB_POOL_TIMEOUT) params.set("pool_timeout", env.DB_POOL_TIMEOUT);
    if (env.DB_SSLMODE) params.set("sslmode", env.DB_SSLMODE);
    databaseUrl = `postgresql://${encodeURIComponent(env.DB_USER)}:${encodeURIComponent(dbPassword)}@${env.DB_HOST}:${env.DB_PORT || 5432}/${encodeURIComponent(env.DB_NAME)}?${params}`;
  }
  if (databaseUrl) apply.DATABASE_URL = databaseUrl;
  if (!databaseUrl) (strict ? errors : warnings).push("No database configured (DATABASE_URL or DB_HOST/DB_NAME/DB_USER with DB_PASSWORD).");
  if (strict && databaseUrl) {
    try {
      const u = new URL(databaseUrl);
      if (looksWeak(decodeURIComponent(u.password))) errors.push("The database password is empty or a known default.");
      if (["postgres"].includes(decodeURIComponent(u.username))) errors.push("The application must not connect as the postgres superuser; use the least-privilege runtime role.");
    } catch { errors.push("DATABASE_URL is malformed."); }
  }

  // ── Redis ─────────────────────────────────────────────────────────────────
  let redisUrl = secret("REDIS_URL");
  const redisPassword = secret("REDIS_PASSWORD");
  if (!redisUrl && env.REDIS_HOST) redisUrl = `redis://${redisPassword ? `:${encodeURIComponent(redisPassword)}@` : ""}${env.REDIS_HOST}:${env.REDIS_PORT || 6379}`;
  if (redisUrl) apply.REDIS_URL = redisUrl;
  if (strict) {
    if (!redisUrl) errors.push("No Redis configured (REDIS_URL or REDIS_HOST with REDIS_PASSWORD).");
    else { try { const u = new URL(redisUrl); if (looksWeak(decodeURIComponent(u.password))) errors.push("Redis must require a password in staging and production."); } catch { errors.push("REDIS_URL is malformed."); } }
  }

  // ── Signing and encryption keys ───────────────────────────────────────────
  const jwt = secret("JWT_SECRET");
  if (jwt) apply.JWT_SECRET = jwt;
  if (strict) {
    if (!jwt) errors.push("JWT_SECRET is required.");
    else if (jwt.length < 32 || looksWeak(jwt)) errors.push("JWT_SECRET must be at least 32 random characters and not a default.");
  }
  const keys = secret("INTEGRATIONS_KEYS");
  if (keys) apply.INTEGRATIONS_KEYS = keys;
  if (strict) {
    if (!keys) errors.push("INTEGRATIONS_KEYS (the credential-vault master keyring) is required.");
    else if (/:(A{43}=|0{64})/.test(keys)) errors.push("INTEGRATIONS_KEYS contains an all-zero development key.");
  }
  const safety = secret("AI_SAFETY_ID_SECRET");
  if (safety) apply.AI_SAFETY_ID_SECRET = safety;
  if (strict && (!safety || safety.length < 32 || looksWeak(safety))) errors.push("AI_SAFETY_ID_SECRET must be at least 32 random characters.");
  for (const optional of ["JWT_SECRET_PREVIOUS", "METRICS_TOKEN", "SMTP_PASSWORD", "OBJECT_STORAGE_SECRET_KEY", "PLATFORM_AUTOMATION_TOKEN_PEPPER"]) {
    const v = secret(optional);
    if (v) apply[optional] = v;
    if (strict && v && looksWeak(v)) errors.push(`${optional} is a known default.`);
  }
  if (strict && !apply.PLATFORM_AUTOMATION_TOKEN_PEPPER) errors.push("PLATFORM_AUTOMATION_TOKEN_PEPPER is required (hashes deployment and backup automation tokens).");

  // ── Web surface ───────────────────────────────────────────────────────────
  const origins = String(env.CORS_ALLOWED_ORIGINS || env.CLIENT_ORIGIN || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (origins.includes("*")) (strict ? errors : warnings).push("A wildcard CORS origin can't be combined with credentialed requests.");
  if (strict) {
    if (!origins.length) errors.push("CLIENT_ORIGIN (or CORS_ALLOWED_ORIGINS) is required.");
    for (const o of origins) if (!isHttps(o) || isLocal(o)) errors.push(`Allowed origin ${o} must be an https public origin.`);
    const publicUrl = env.PUBLIC_API_URL || env.APP_URL;
    if (!publicUrl) errors.push("PUBLIC_API_URL is required.");
    else if (!isHttps(publicUrl)) errors.push("PUBLIC_API_URL must use https (TLS enforcement).");
    if (env.REQUIRE_HTTPS !== undefined && !truthy(env.REQUIRE_HTTPS)) errors.push("REQUIRE_HTTPS can't be disabled.");
    if (env.COOKIE_SECURE !== undefined && !truthy(env.COOKIE_SECURE)) errors.push("Session cookies must be Secure (COOKIE_SECURE can't be false).");
    if ((env.COOKIE_SAMESITE || "lax").toLowerCase() === "none" && !truthy(env.ALLOW_SAMESITE_NONE)) errors.push("COOKIE_SAMESITE=none is not allowed without ALLOW_SAMESITE_NONE (cross-site cookie review).");
    const tp = String(env.TRUST_PROXY || "");
    if (!tp) errors.push("TRUST_PROXY must name the proxy hop count (e.g. 1) or the proxy addresses.");
    else if (["true", "*", "all"].includes(tp.toLowerCase())) errors.push("TRUST_PROXY=true trusts every hop (spoofable client IPs); set the hop count or proxy addresses.");
    if (truthy(env.DEBUG) || truthy(env.ANALYTICS_DEBUG) || ["debug", "trace"].includes(String(env.LOG_LEVEL || "").toLowerCase())) errors.push("Debug logging is not allowed in staging or production.");
    if (truthy(env.ALLOW_SYSTEM_OWNER_BOOTSTRAP)) errors.push("ALLOW_SYSTEM_OWNER_BOOTSTRAP must be off; bootstrap the System Owner once, then remove it.");
    if (env.NODE_ENV !== "production") errors.push("NODE_ENV must be production in staging and production (disables simulators and development defaults).");
    if (truthy(env.INTEGRATIONS_ALLOW_PRIVATE_WEBHOOK_TARGETS)) errors.push("Private webhook targets (SSRF risk) can't be allowed in staging or production.");
  }

  // ── Operations ────────────────────────────────────────────────────────────
  if (strict) {
    if (!env.BACKUP_REPO_PRIMARY) errors.push("BACKUP_REPO_PRIMARY (primary backup destination) is required.");
    if (profile === "production" && !env.BACKUP_REPO_OFFSITE) errors.push("BACKUP_REPO_OFFSITE (off-host backup copy) is required in production.");
    const audit = Number(env.AUDIT_LOG_RETENTION_DAYS);
    if (!Number.isInteger(audit) || audit < 90) errors.push("AUDIT_LOG_RETENTION_DAYS must be set (whole days, at least 90).");
    if (!env.MONITORING_ENV_LABEL) warnings.push("MONITORING_ENV_LABEL is not set; APP_ENV is used as the monitoring label.");
    if (env.SMTP_HOST && /mailpit|localhost|127\.0\.0\.1/.test(env.SMTP_HOST)) warnings.push("SMTP_HOST points at a local mail catcher; no real email will be delivered.");
    if (truthy(env.LEGACY_USER_API)) warnings.push("The legacy /api/v1/user bearer-token API is enabled.");
  }
  apply.APP_ENV = profile;
  apply.MONITORING_ENV_LABEL = env.MONITORING_ENV_LABEL || profile;
  apply.RATE_LIMIT_PREFIX = env.RATE_LIMIT_PREFIX || `rl:${profile}:`;
  return { profile, errors, warnings, apply, secretSources, secretValues };
}

export { SECRET_NAMES, looksWeak };

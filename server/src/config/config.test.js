import { describe, it, expect } from "vitest";
import { resolveConfig, profileOf } from "./validate.js";
import { readSecret, makeRedactor } from "./secrets.js";

// A strong, file-based production configuration (all secrets as files).
const strong = {
  JWT_SECRET: "Jq8v2Lr0Zx7PpT4sWm1Ky9Hd3Nb6Fc5Ge0Ua2Ro8Vi4Ts7Ql1Yx9Kw3Mn6Bb2Cc",
  DB_PASSWORD: "p0Zr7Lq2Vx9Kt4Ns1Wm8Hy3Jd6Fb5Gc0Ua2Ro8Vi4Te",
  REDIS_PASSWORD: "r4Yx9Kw3Mn6Bb2Cc7Pp0Zr7Lq2Vx9Kt4Ns1Wm8Hy",
  INTEGRATIONS_KEYS: "1:3q2+7w1uX1xg0pYk8aF3m2HqN9Lr6Vb4Ts5Ze8Jc0Wo=",
  AI_SAFETY_ID_SECRET: "Ai7Sf3Ty9Id2Se8Cr4Et6Kx1Qz5Lm0Np3Vb7Hj2Gd9Fs4",
  PLATFORM_AUTOMATION_TOKEN_PEPPER: "Pp9Ep8Pe7Rr6Tt5Oo4Kk3Ee2Nn1Ss0Aa9Ll8Tt7Yy6Qq5Ww",
};
const files = (all) => { const map = Object.fromEntries(Object.entries(all).filter(([, v]) => v !== undefined)); return ({ readFile: (p) => { const k = Object.keys(map).find((name) => p.endsWith(`/${name.toLowerCase()}`)); if (!k) throw new Error("ENOENT"); return map[k]; }, exists: (p) => Object.keys(map).some((name) => p.endsWith(`/${name.toLowerCase()}`)) }); };
const prodEnv = (over = {}) => ({
  APP_ENV: "production", NODE_ENV: "production", SECRETS_DIR: "/run/secrets", DB_HOST: "db", DB_NAME: "caspira_crm", DB_USER: "caspira_app", REDIS_HOST: "redis",
  CLIENT_ORIGIN: "https://crm.example.com", PUBLIC_API_URL: "https://api.example.com", TRUST_PROXY: "1", BACKUP_REPO_PRIMARY: "repo1", BACKUP_REPO_OFFSITE: "repo2", AUDIT_LOG_RETENTION_DAYS: "730", MONITORING_ENV_LABEL: "production", ...over,
});
const resolve = (env, secrets = strong) => resolveConfig(env, files(secrets));

describe("environment profiles", () => {
  it("selects the profile from APP_ENV, else NODE_ENV", () => {
    expect(profileOf({ APP_ENV: "staging" })).toBe("staging");
    expect(profileOf({ NODE_ENV: "production" })).toBe("production");
    expect(profileOf({})).toBe("development");
    expect(resolveConfig({ APP_ENV: "qa" }).errors[0]).toMatch(/APP_ENV must be one of/);
  });
  it("development keeps working with no secrets and no files (compatibility)", () => {
    const r = resolveConfig({ DATABASE_URL: "postgresql://caspira:caspira_dev_password@localhost:5434/db" }, files({}));
    expect(r.profile).toBe("development");
    expect(r.errors).toEqual([]);
    expect(r.apply.DATABASE_URL).toMatch(/^postgresql:\/\//);
  });
  it("a complete production configuration from secret files is accepted and assembled", () => {
    const r = resolve(prodEnv());
    expect(r.errors).toEqual([]);
    expect(r.apply.DATABASE_URL).toMatch(/^postgresql:\/\/caspira_app:.+@db:5432\/caspira_crm\?schema=public/);
    expect(r.apply.REDIS_URL).toMatch(/^redis:\/\/:.+@redis:6379$/);
    expect(r.secretSources.JWT_SECRET).toBe("secrets_dir");
    expect(r.apply.RATE_LIMIT_PREFIX).toBe("rl:production:");
  });
});

describe("production configuration is refused when insecure", () => {
  const errorsFor = (env, secrets) => resolve(env, secrets).errors.join("\n");
  it("missing secrets", () => {
    const e = errorsFor(prodEnv(), {});
    expect(e).toMatch(/JWT_SECRET is required/);
    expect(e).toMatch(/No database configured/);
    expect(e).toMatch(/INTEGRATIONS_KEYS/);
    expect(e).toMatch(/PLATFORM_AUTOMATION_TOKEN_PEPPER/);
  });
  it("default or weak passwords and keys", () => {
    expect(errorsFor(prodEnv(), { ...strong, DB_PASSWORD: "caspira_dev_password" })).toMatch(/database password is empty or a known default/);
    expect(errorsFor(prodEnv(), { ...strong, JWT_SECRET: "dev-secret" })).toMatch(/JWT_SECRET must be at least 32/);
    expect(errorsFor(prodEnv(), { ...strong, REDIS_PASSWORD: "changeme" })).toMatch(/Redis must require a password/);
    expect(errorsFor(prodEnv({ DB_USER: "postgres" }))).toMatch(/must not connect as the postgres superuser/);
    expect(errorsFor(prodEnv(), { ...strong, INTEGRATIONS_KEYS: `1:${"A".repeat(43)}=` })).toMatch(/all-zero development key/);
  });
  it("secrets passed as plain environment variables", () => {
    expect(resolveConfig({ ...prodEnv(), JWT_SECRET: strong.JWT_SECRET }, files({ ...strong, JWT_SECRET: undefined })).errors.join("\n")).toMatch(/JWT_SECRET must be provided as a secret file/);
  });
  it("debug mode, wildcard credentialed CORS, http origins and insecure cookies", () => {
    expect(errorsFor(prodEnv({ DEBUG: "true" }))).toMatch(/Debug logging is not allowed/);
    expect(errorsFor(prodEnv({ LOG_LEVEL: "debug" }))).toMatch(/Debug logging/);
    expect(errorsFor(prodEnv({ CORS_ALLOWED_ORIGINS: "*" }))).toMatch(/wildcard CORS origin/);
    expect(errorsFor(prodEnv({ CLIENT_ORIGIN: "http://crm.example.com" }))).toMatch(/must be an https public origin/);
    expect(errorsFor(prodEnv({ PUBLIC_API_URL: "http://api.example.com" }))).toMatch(/must use https/);
    expect(errorsFor(prodEnv({ COOKIE_SECURE: "false" }))).toMatch(/Session cookies must be Secure/);
    expect(errorsFor(prodEnv({ REQUIRE_HTTPS: "false" }))).toMatch(/REQUIRE_HTTPS can't be disabled/);
  });
  it("unrestricted trusted proxies, missing backups and audit retention, bootstrap left on", () => {
    expect(errorsFor(prodEnv({ TRUST_PROXY: "true" }))).toMatch(/TRUST_PROXY=true trusts every hop/);
    expect(errorsFor(prodEnv({ TRUST_PROXY: "" }))).toMatch(/TRUST_PROXY must name/);
    expect(errorsFor(prodEnv({ BACKUP_REPO_PRIMARY: "" }))).toMatch(/BACKUP_REPO_PRIMARY/);
    expect(errorsFor(prodEnv({ BACKUP_REPO_OFFSITE: "" }))).toMatch(/BACKUP_REPO_OFFSITE/);
    expect(errorsFor(prodEnv({ AUDIT_LOG_RETENTION_DAYS: "" }))).toMatch(/AUDIT_LOG_RETENTION_DAYS must be set/);
    expect(errorsFor(prodEnv({ ALLOW_SYSTEM_OWNER_BOOTSTRAP: "true" }))).toMatch(/ALLOW_SYSTEM_OWNER_BOOTSTRAP must be off/);
    expect(errorsFor(prodEnv({ NODE_ENV: "development" }))).toMatch(/NODE_ENV must be production/);
  });
  it("staging is held to the same rules (no silent development fallback)", () => {
    const r = resolve({ APP_ENV: "staging", NODE_ENV: "production" }, {});
    expect(r.errors.length).toBeGreaterThan(5);
    // Staging does not require an off-site copy; production does.
    expect(resolve(prodEnv({ APP_ENV: "staging", BACKUP_REPO_OFFSITE: "" })).errors).toEqual([]);
  });
});

describe("secret handling", () => {
  it("prefers NAME_FILE, then the secrets directory, then (dev only) the environment", () => {
    const readers = { readFile: (p) => (p === "/custom/jwt" ? "from-file\n" : "from-dir\n"), exists: () => true };
    expect(readSecret("JWT_SECRET", { JWT_SECRET_FILE: "/custom/jwt" }, readers)).toEqual({ value: "from-file", source: "file" });
    expect(readSecret("JWT_SECRET", {}, readers)).toEqual({ value: "from-dir", source: "secrets_dir" });
    expect(readSecret("JWT_SECRET", { JWT_SECRET: "x" }, { readFile: () => { throw new Error(); }, exists: () => false })).toEqual({ value: "x", source: "env" });
    expect(readSecret("JWT_SECRET", { JWT_SECRET_FILE: "/missing" }, { readFile: () => { throw new Error(); }, exists: () => false }).error).toMatch(/can't be read/);
  });
  it("masks secret values in log text", () => {
    const redact = makeRedactor([strong.JWT_SECRET, "short"]);
    expect(redact(`token ${strong.JWT_SECRET} used`)).toBe("token [REDACTED] used");
    expect(redact("short values are not masked")).toBe("short values are not masked");
  });
  it("never includes secret values in errors or warnings", () => {
    const r = resolve(prodEnv({ DEBUG: "true" }), { ...strong, DB_PASSWORD: "caspira_dev_password" });
    const text = [...r.errors, ...r.warnings].join("\n");
    for (const v of Object.values(strong)) expect(text).not.toContain(v);
    expect(text).not.toContain("caspira_dev_password");
  });
});

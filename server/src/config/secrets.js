// Backend Phase 13 — the one place secrets are read. In staging and
// production every secret comes from a file: `<NAME>_FILE=/run/secrets/...`
// (Docker Compose secrets) or `/run/secrets/<name>` by convention. Plain
// environment variables remain available in development and tests only.
// Values are never logged; callers get the value, the loader records only
// where it came from.
import fs from "node:fs";
import path from "node:path";

export const SECRETS_DIR_DEFAULT = "/run/secrets";

// Names of every secret the platform consumes (metadata lives in the
// secret inventory; values never do).
export const SECRET_NAMES = [
  "JWT_SECRET", "JWT_SECRET_PREVIOUS", "DB_PASSWORD", "DATABASE_URL", "REDIS_PASSWORD", "REDIS_URL", "INTEGRATIONS_KEYS", "AI_SAFETY_ID_SECRET",
  "METRICS_TOKEN", "SMTP_PASSWORD", "OBJECT_STORAGE_SECRET_KEY", "PLATFORM_AUTOMATION_TOKEN_PEPPER",
];

// → { value, source: "file" | "secrets_dir" | "env" | null }
export function readSecret(name, env = process.env, { readFile = fs.readFileSync, exists = fs.existsSync } = {}) {
  const fileVar = env[`${name}_FILE`];
  if (fileVar) {
    try { return { value: String(readFile(fileVar, "utf8")).replace(/\r?\n$/, ""), source: "file" }; }
    catch { return { value: null, source: "file", error: `${name}_FILE is set but the file can't be read.` }; }
  }
  const dir = env.SECRETS_DIR || SECRETS_DIR_DEFAULT;
  const conventional = path.posix.join(dir, name.toLowerCase());
  try {
    if (exists(conventional)) return { value: String(readFile(conventional, "utf8")).replace(/\r?\n$/, ""), source: "secrets_dir" };
  } catch { /* fall through */ }
  if (env[name] !== undefined && env[name] !== "") return { value: env[name], source: "env" };
  return { value: null, source: null };
}

// Replaces known secret values in any string (logs, error text).
export function makeRedactor(values) {
  const list = [...new Set(values.filter((v) => typeof v === "string" && v.length >= 8))].sort((a, b) => b.length - a.length);
  return (text) => {
    let out = String(text);
    for (const v of list) if (out.includes(v)) out = out.split(v).join("[REDACTED]");
    return out;
  };
}

// Wraps console methods so a secret value can't be printed by accident.
let installed = false;
export function installLogRedaction(values) {
  if (installed) return;
  installed = true;
  const redact = makeRedactor(values);
  for (const method of ["log", "info", "warn", "error", "debug"]) {
    const original = console[method].bind(console);
    console[method] = (...args) => original(...args.map((a) => {
      if (typeof a === "string") return redact(a);
      if (a instanceof Error) { const e = new Error(redact(a.message)); e.name = a.name; e.stack = a.stack ? redact(a.stack) : undefined; e.code = a.code; return e; }
      return a;
    }));
  }
}

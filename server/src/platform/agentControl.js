// Backend Phase 13 — the control channel to the backup agent.
//
// The API and worker never run database tools, never mount the Docker socket
// and never hold backup credentials. They write small, validated request
// files into a dedicated control volume (BACKUP_CONTROL_DIR); the isolated
// backup-agent container (deploy/production/backup-agent) executes them with
// pgBackRest and writes result and status files back. Requests are an
// allowlist of operations with typed parameters — never commands.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { PlatformError } from "./common.js";

export const REQUEST_TYPES = {
  backup: (p) => ({ type: oneOf(p.type, ["full", "diff", "incr"], "type") }),
  logical: () => ({}),
  configuration: () => ({}),
  object_backup: () => ({}),
  check: () => ({}),
  verify: () => ({}),
  info: () => ({}),
  expire: (p) => ({ retentionFull: int(p.retentionFull, 1, 52, "retentionFull"), retentionDiff: int(p.retentionDiff, 1, 90, "retentionDiff") }),
  restore: (p) => ({
    restoreId: token(p.restoreId, "restoreId"), set: p.set ? label(p.set) : null,
    target: p.target ? isoTime(p.target) : null, targetType: oneOf(p.targetType || "latest", ["latest", "time"], "targetType"),
    repo: p.repo == null ? null : int(p.repo, 1, 2, "repo"),
  }),
  restore_cleanup: (p) => ({ restoreId: token(p.restoreId, "restoreId") }),
  object_restore: (p) => ({ restoreId: token(p.restoreId, "restoreId"), versionTime: p.versionTime ? isoTime(p.versionTime) : null }),
};

function oneOf(v, list, name) { if (!list.includes(v)) throw new PlatformError(422, "INVALID_REQUEST", `${name} must be one of ${list.join(", ")}.`); return v; }
function int(v, min, max, name) { const n = Number(v); if (!Number.isInteger(n) || n < min || n > max) throw new PlatformError(422, "INVALID_REQUEST", `${name} must be ${min}–${max}.`); return n; }
function token(v, name) { if (!/^[A-Za-z0-9_-]{6,64}$/.test(String(v || ""))) throw new PlatformError(422, "INVALID_REQUEST", `${name} is invalid.`); return String(v); }
function label(v) { if (!/^\d{8}-\d{6}F(_\d{8}-\d{6}[DI])?$/.test(String(v))) throw new PlatformError(422, "INVALID_REQUEST", "Backup set label is invalid."); return String(v); }
function isoTime(v) { const d = new Date(v); if (Number.isNaN(d.getTime())) throw new PlatformError(422, "INVALID_REQUEST", "Recovery target time is invalid."); return d.toISOString(); }

export const controlDir = (env = process.env) => env.BACKUP_CONTROL_DIR || null;
export const agentConfigured = (env = process.env) => !!controlDir(env);

const ensureDirs = (dir) => { for (const d of ["requests", "results", "results/processed", "status"]) fs.mkdirSync(path.join(dir, d), { recursive: true }); };

// Atomic write (temp file + rename) so the agent never reads half a request.
export function writeRequest({ id = crypto.randomUUID(), type, params = {}, environment, correlationId }, dir = controlDir()) {
  if (!dir) throw new PlatformError(503, "AGENT_NOT_CONFIGURED", "The backup agent is not configured in this environment (BACKUP_CONTROL_DIR).");
  const validate = REQUEST_TYPES[type];
  if (!validate) throw new PlatformError(422, "INVALID_REQUEST", `Unknown agent operation ${type}.`);
  const body = { id, type, params: validate(params || {}), environment, correlationId: correlationId || null, createdAt: new Date().toISOString(), protocol: 1 };
  ensureDirs(dir);
  const final = path.join(dir, "requests", `${id}.json`);
  const tmp = `${final}.tmp`;
  // Group-readable so the backup agent (another uid, same control group) can read it.
  fs.writeFileSync(tmp, JSON.stringify(body), { mode: 0o660 });
  fs.renameSync(tmp, final);
  return body;
}

// A request the agent hasn't picked up yet (it removes the file when the job starts).
export function requestPending(id, dir = controlDir()) {
  return !!dir && fs.existsSync(path.join(dir, "requests", `${id}.json`));
}

// Results written by the agent: { id, type, status: succeeded|failed, exitCode, startedAt, completedAt, output, error }.
export function readResults(dir = controlDir(), { limit = 50 } = {}) {
  if (!dir) return [];
  ensureDirs(dir);
  const files = fs.readdirSync(path.join(dir, "results")).filter((f) => f.endsWith(".json")).slice(0, limit);
  const out = [];
  for (const f of files) {
    const full = path.join(dir, "results", f);
    try { out.push({ file: full, result: JSON.parse(fs.readFileSync(full, "utf8")) }); }
    catch { out.push({ file: full, result: null }); }
  }
  return out;
}

export function markProcessed(file) {
  const dest = path.join(path.dirname(file), "processed", path.basename(file));
  try { fs.renameSync(file, dest); } catch { /* already moved by another worker */ }
}

// Agent status: heartbeat, pgBackRest info JSON, pg_stat_archiver and repository disk usage.
export function readStatus(dir = controlDir()) {
  if (!dir) return null;
  const read = (name) => { try { return JSON.parse(fs.readFileSync(path.join(dir, "status", name), "utf8")); } catch { return null; } };
  return { heartbeat: read("heartbeat.json"), info: read("info.json"), archiver: read("archiver.json"), repository: read("repository.json") };
}

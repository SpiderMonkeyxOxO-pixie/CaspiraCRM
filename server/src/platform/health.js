// Backend Phase 13 — detailed health, readiness components and capacity.
// Public /health and /ready stay minimal; this detail is served only to
// platform.health.read (it names components and ages, never secrets,
// hostnames or connection strings). A third-party provider outage degrades a
// component; it never marks the API process dead.
import fs from "node:fs";
import prisma from "../lib/prisma.js";
import redis from "../lib/redis.js";
import { verifyMailerConnection } from "../lib/mailer.js";
import { SECRET_NAMES, readSecret } from "../config/secrets.js";
import { currentEnvironment, toJson } from "./common.js";
import { backupStatus } from "./backups.js";
import { knownMigrations } from "./releases.js";

const withTimeout = (p, ms = 3000) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error("timeout")), ms))]);
const timed = async (fn) => { const t = Date.now(); try { const detail = await withTimeout(fn()); return { status: "ok", ms: Date.now() - t, ...(detail && typeof detail === "object" ? detail : {}) }; } catch (e) { return { status: "unavailable", ms: Date.now() - t, reason: e?.message === "timeout" ? "timeout" : "error" }; } };

export const HEARTBEAT_KEYS = { worker: "worker", scheduler: "platform-scheduler" };
export async function writeHeartbeat(name) {
  try { await redis.set(`hb:${currentEnvironment()}:${name}`, new Date().toISOString(), "EX", 3600); } catch { /* health reports it */ }
}
async function heartbeatAge(name) {
  const v = await redis.get(`hb:${currentEnvironment()}:${name}`);
  if (!v) throw new Error("missing");
  return { ageSeconds: Math.round((Date.now() - new Date(v)) / 1000) };
}

// Free and total bytes of a filesystem path (Node 18.15+ statfs).
export function diskUsage(p = process.env.CAPACITY_CHECK_PATH || process.cwd()) {
  try {
    const s = fs.statfsSync(p);
    const total = s.blocks * s.bsize; const free = s.bavail * s.bsize;
    return { path: p === process.cwd() ? "application volume" : "configured volume", totalBytes: total, freeBytes: free, usedPercent: total ? Math.round(((total - free) / total) * 1000) / 10 : null };
  } catch { return null; }
}

export async function databaseCapacity() {
  const [size] = await prisma.$queryRaw`SELECT pg_database_size(current_database())::bigint AS bytes`;
  const [conns] = await prisma.$queryRaw`SELECT count(*)::int AS used, current_setting('max_connections')::int AS max FROM pg_stat_activity`;
  const [locks] = await prisma.$queryRaw`SELECT count(*)::int AS waiting FROM pg_locks WHERE NOT granted`;
  const [slow] = await prisma.$queryRaw`SELECT count(*)::int AS n FROM pg_stat_activity WHERE state = 'active' AND now() - query_start > interval '30 seconds'`;
  return { sizeBytes: Number(size.bytes), connectionsUsed: conns.used, connectionsMax: conns.max, connectionUsePercent: Math.round((conns.used / conns.max) * 1000) / 10, waitingLocks: locks.waiting, longRunningQueries: slow.n };
}

export async function detailedHealth() {
  const now = new Date();
  const [database, redisCheck, mailer, worker, scheduler, migrations, capacity] = await Promise.all([
    timed(() => prisma.$queryRaw`SELECT 1`.then(() => null)),
    timed(() => redis.ping().then(() => null)),
    timed(() => verifyMailerConnection().then(() => null)),
    timed(() => heartbeatAge(HEARTBEAT_KEYS.worker)),
    timed(() => heartbeatAge(HEARTBEAT_KEYS.scheduler)),
    timed(async () => {
      const rows = await prisma.$queryRaw`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`;
      const applied = rows.map((r) => r.migration_name);
      const known = knownMigrations();
      const pending = known.filter((m) => !applied.includes(m));
      const unknown = applied.filter((m) => !known.includes(m));
      return { applied: applied.length, latest: applied[applied.length - 1] || null, pending: pending.length, unknownToThisBuild: unknown.length, compatible: unknown.length === 0 };
    }),
    timed(() => databaseCapacity()),
  ]);
  const backups = await backupStatus(now).catch(() => null);
  const secrets = Object.fromEntries(["JWT_SECRET", "INTEGRATIONS_KEYS", "AI_SAFETY_ID_SECRET", "PLATFORM_AUTOMATION_TOKEN_PEPPER"].map((n) => [n, process.env[n] || readSecret(n).value ? "present" : "missing"]));
  const staleHeartbeat = (c, max) => c.status === "ok" && c.ageSeconds > max;
  const checks = {
    liveness: { status: "ok" },
    database, redis: redisCheck,
    // Email is a third-party dependency: degraded, never fatal.
    email: { ...mailer, critical: false },
    queue: redisCheck.status === "ok" ? { status: "ok" } : { status: "unavailable" },
    worker: staleHeartbeat(worker, 120) ? { ...worker, status: "stale" } : worker,
    scheduler: staleHeartbeat(scheduler, 300) ? { ...scheduler, status: "stale" } : scheduler,
    migrations: migrations.status === "ok" && !migrations.compatible ? { ...migrations, status: "incompatible" } : migrations,
    backups: backups ? { status: !backups.agentConfigured ? "not_configured" : backups.lastBackupAgeHours !== null && backups.lastBackupAgeHours < 26 ? "ok" : "stale", lastBackupAt: backups.lastBackupAt, lastVerifiedAt: backups.lastVerifiedAt, lastSuccessfulRestoreDrillAt: backups.lastSuccessfulRestoreDrillAt } : { status: "unknown" },
    walArchive: backups?.walArchive ? { status: backups.walArchive.lagMinutes !== null && backups.walArchive.lagMinutes <= (backups.policy?.walArchiveMaxLagMinutes || 15) ? "ok" : "lagging", ...backups.walArchive } : { status: backups?.agentConfigured ? "unknown" : "not_configured" },
    secrets: { status: Object.values(secrets).every((v) => v === "present") ? "ok" : "missing", ...secrets },
    objectStorage: { status: process.env.OBJECT_STORAGE_ENDPOINT ? "configured" : "not_configured", note: "No object-storage data exists yet (the Documents service is not built)." },
  };
  const disk = diskUsage();
  const critical = ["database", "redis", "migrations", "secrets"];
  const unhealthy = critical.some((k) => !["ok"].includes(checks[k].status));
  const degraded = !unhealthy && Object.entries(checks).some(([k, v]) => k !== "objectStorage" && !["ok", "configured"].includes(v.status));
  const overall = unhealthy ? "unhealthy" : degraded ? "degraded" : "healthy";
  return toJson({ environment: currentEnvironment(), overall, checkedAt: now.toISOString(), checks, capacity: { disk, database: capacity.status === "ok" ? capacity : null, memory: { rssBytes: process.memoryUsage().rss, heapUsedBytes: process.memoryUsage().heapUsed } }, secretNamesTracked: SECRET_NAMES.length });
}

export async function recordHealthSnapshot() {
  const h = await detailedHealth();
  await prisma.systemHealthSnapshot.create({ data: { environment: h.environment, overall: h.overall, checks: h.checks, capacity: h.capacity } });
  const cutoff = new Date(Date.now() - 14 * 86_400_000);
  await prisma.systemHealthSnapshot.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return h;
}

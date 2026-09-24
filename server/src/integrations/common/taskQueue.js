// Backend Phase 8 — the fair task queue for integration work (sync runs,
// webhook events, outbound deliveries, credential refresh, health checks,
// subscription renewal).
//
// Fairness and throttling: at most one running task per connection, at most
// ORG_CONCURRENCY per organization, and organizations with the fewest
// running tasks go first — one organization or provider can't monopolize
// the worker. Claiming is atomic (updateMany on status), so the api and the
// worker can both drain the queue safely.
//
// Retries: exponential backoff with jitter, or the provider's Retry-After;
// permanent failures (validation, revoked credentials) are never retried;
// exhausted retries go to Dead Letter for inspection.
import os from "node:os";
import prisma from "../../lib/prisma.js";
import { KINDS } from "./errors.js";

export const ORG_CONCURRENCY = 2;
const STALE_LOCK_MS = 15 * 60 * 1000;
const BASE_DELAY_MS = 30_000;
const MAX_DELAY_MS = 60 * 60 * 1000;
const WORKER_ID = `${os.hostname()}:${process.pid}`;

export function backoffMs(attempt, retryAfterMs = null, random = Math.random) {
  if (retryAfterMs) return retryAfterMs + Math.floor(random() * 1000);
  const base = Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
  return Math.floor(base * (0.5 + random())); // jitter: 50–150 %
}

export async function enqueueTask({ organizationId, connectionId = null, kind, refId, runAfter = new Date(), maxAttempts = 5, dedupeKey = null }, db = prisma) {
  if (dedupeKey) {
    const existing = await db.integrationTask.findUnique({ where: { dedupeKey } });
    if (existing) return existing;
  }
  try {
    return await db.integrationTask.create({ data: { organizationId, connectionId, kind, refId, runAfter, maxAttempts, dedupeKey } });
  } catch (err) {
    if (err?.code === "P2002" && dedupeKey) return db.integrationTask.findUnique({ where: { dedupeKey } });
    throw err;
  }
}

// Picks the next runnable task respecting per-connection and per-org limits.
export async function claimNextTask(kinds = null, db = prisma, now = new Date()) {
  await db.integrationTask.updateMany({ where: { status: "Running", lockedAt: { lt: new Date(now - STALE_LOCK_MS) } }, data: { status: "Queued", lockedAt: null, lockedBy: null } });
  const candidates = await db.integrationTask.findMany({ where: { status: "Queued", runAfter: { lte: now }, ...(kinds && { kind: { in: kinds } }) }, orderBy: { createdAt: "asc" }, take: 50 });
  if (!candidates.length) return null;
  const running = await db.integrationTask.findMany({ where: { status: "Running" }, select: { organizationId: true, connectionId: true } });
  const busyConnections = new Set(running.map((r) => r.connectionId).filter(Boolean));
  const perOrg = new Map();
  for (const r of running) perOrg.set(r.organizationId, (perOrg.get(r.organizationId) || 0) + 1);
  const eligible = candidates
    .filter((t) => !(t.connectionId && busyConnections.has(t.connectionId)) && (perOrg.get(t.organizationId) || 0) < ORG_CONCURRENCY)
    .sort((a, b) => (perOrg.get(a.organizationId) || 0) - (perOrg.get(b.organizationId) || 0) || a.createdAt - b.createdAt);
  for (const task of eligible) {
    const claimed = await db.integrationTask.updateMany({ where: { id: task.id, status: "Queued" }, data: { status: "Running", lockedAt: now, lockedBy: WORKER_ID } });
    if (claimed.count === 1) return { ...task, status: "Running" };
  }
  return null;
}

export async function completeTask(task, db = prisma) {
  await db.integrationTask.update({ where: { id: task.id }, data: { status: "Done", lockedAt: null, lastError: null, lastErrorCode: null } });
}

// Decides retry vs. give up. Permanent errors fail at once; retryable ones
// back off; exhausted ones become Dead Letter.
export async function failTask(task, err, db = prisma) {
  const attempts = task.attempts + 1;
  const permanent = !err?.retryable || err.kind === KINDS.AUTH_INVALID;
  const message = String(err?.message || "Task failed").slice(0, 300);
  if (permanent) {
    await db.integrationTask.update({ where: { id: task.id }, data: { status: "Failed", attempts, lockedAt: null, lastErrorCode: err?.kind || "error", lastError: message } });
    return "Failed";
  }
  if (attempts >= task.maxAttempts) {
    await db.integrationTask.update({ where: { id: task.id }, data: { status: "Dead Letter", attempts, lockedAt: null, lastErrorCode: err.kind, lastError: message } });
    return "Dead Letter";
  }
  await db.integrationTask.update({ where: { id: task.id }, data: { status: "Queued", attempts, lockedAt: null, lockedBy: null, runAfter: new Date(Date.now() + backoffMs(attempts, err.retryAfterMs)), lastErrorCode: err.kind, lastError: message } });
  return "Retrying";
}

// Runs due tasks with the given handlers ({ kind: async (task) => void }).
let draining = false;
export async function drainTasks(handlers, { max = 20, db = prisma, onDeadLetter = {} } = {}) {
  if (draining) return 0;
  draining = true;
  let done = 0;
  try {
    for (; done < max; done += 1) {
      const task = await claimNextTask(Object.keys(handlers), db);
      if (!task) break;
      try {
        await handlers[task.kind](task);
        await completeTask(task, db);
      } catch (err) {
        const outcome = await failTask(task, err, db);
        if (outcome === "Dead Letter" && onDeadLetter[task.kind]) await onDeadLetter[task.kind](task).catch(() => {});
      }
    }
  } finally {
    draining = false;
  }
  return done;
}

// Dead letters: listed for inspection, retried only by a person.
export async function retryDeadLetter(taskId, organizationId, db = prisma) {
  const updated = await db.integrationTask.updateMany({ where: { id: taskId, organizationId, status: { in: ["Dead Letter", "Failed"] } }, data: { status: "Queued", attempts: 0, runAfter: new Date(), lastError: null } });
  return updated.count === 1;
}

// Backend Phase 11 — governance jobs for the existing worker (idempotent):
// alerts, SLO measurement, automatic rollback, exception/dataset/evidence
// expiry, review-queue feeding, drift checks, and the evaluation worker.
// Heartbeats let the health endpoint report the worker, scheduler, evaluation
// worker and monitoring collector.
import prisma from "../../lib/prisma.js";
import { evaluateAlerts, measureSlos, checkDrift } from "./monitoring.js";
import { checkAutomaticRollback } from "./releases.js";
import { expireExceptions, feedReviewQueues } from "./reviews.js";
import { expireDatasets } from "./evaluation/datasets.js";
import { runQueuedEvaluations } from "./evaluation/runner.js";

export const heartbeats = { governance: null, evaluation: null, slo: null };
let lastSlo = 0;

export async function expireIncidentEvidence(now = new Date()) {
  return (await prisma.aiIncidentEvidence.deleteMany({ where: { expiresAt: { lt: now } } })).count;
}

async function beat(redis, key) {
  heartbeats[key] = new Date().toISOString();
  if (redis) await redis.set(`ai:heartbeat:${key}`, heartbeats[key], "EX", 3600).catch(() => {});
}

export async function runGovernanceMaintenance({ redis = null, now = new Date() } = {}) {
  const results = {};
  const jobs = {
    alerts: () => evaluateAlerts(now), rollback: () => checkAutomaticRollback(now), exceptions: () => expireExceptions(now), datasets: () => expireDatasets(now),
    evidence: () => expireIncidentEvidence(now), reviews: () => feedReviewQueues(), drift: () => checkDrift(now),
  };
  if (now - lastSlo > 15 * 60_000) { jobs.slos = () => measureSlos(now); lastSlo = now.getTime(); }
  for (const [name, fn] of Object.entries(jobs)) {
    try { const r = await fn(); results[name] = Array.isArray(r) ? `${r.length} measured` : r; } catch (err) { results[name] = `error: ${err.message}`; }
  }
  await beat(redis, "governance");
  if (jobs.slos) await beat(redis, "slo");
  return results;
}

export async function runEvaluationWorker({ redis = null } = {}) {
  const n = await runQueuedEvaluations({ max: 1 });
  await beat(redis, "evaluation");
  return n;
}

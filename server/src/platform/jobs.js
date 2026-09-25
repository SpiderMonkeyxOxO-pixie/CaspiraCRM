// Backend Phase 13 — platform job runner and schedule.
//
// Each job runs under a database lease (distributed lock: only one worker
// holds a job at a time, and a crashed holder's lease expires), with a
// timeout, bounded retries with backoff, cancellation on shutdown, a run
// history (metrics) and audit events for failures. Three consecutive failed
// runs dead-letter the job and open a finding. Everything is idempotent:
// a job re-run after a worker restart picks up where the data says it is.
import os from "node:os";
import crypto from "node:crypto";
import prisma from "../lib/prisma.js";
import { currentEnvironment, platformAudit, systemActor, toJson } from "./common.js";
import { writeHeartbeat, HEARTBEAT_KEYS, recordHealthSnapshot } from "./health.js";
import { scheduleDueBackups, dispatchQueued, ingestAgentResults, timeOutStuckJobs, syncArtifactsFromStatus } from "./backups.js";
import { checkDrillSchedule, startDrill } from "./restores.js";
import { agentConfigured } from "./agentControl.js";
import { runAllRetention } from "./retention.js";
import { markRotationsDue } from "./secretInventory.js";
import { expireExceptions, recordFinding } from "./findings.js";
import { flagStuckDeployments } from "./deployments.js";
import { evaluateAlerts } from "./alerts.js";
import { drillReminders } from "./disasterRecovery.js";

const HOLDER = `${os.hostname()}:${process.pid}:${crypto.randomBytes(3).toString("hex")}`;
const controller = new AbortController();
export const cancelPlatformJobs = () => controller.abort();

export async function acquireLease(jobKey, ttlMs, now = new Date()) {
  const leaseUntil = new Date(now.getTime() + ttlMs);
  try {
    await prisma.platformJobLease.create({ data: { jobKey, holder: HOLDER, leaseUntil } });
    return true;
  } catch {
    const { count } = await prisma.platformJobLease.updateMany({ where: { jobKey, OR: [{ leaseUntil: { lt: now } }, { holder: HOLDER }] }, data: { holder: HOLDER, leaseUntil } });
    return count === 1;
  }
}
export async function releaseLease(jobKey) {
  await prisma.platformJobLease.updateMany({ where: { jobKey, holder: HOLDER }, data: { leaseUntil: new Date(0) } }).catch(() => {});
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function runPlatformJob(jobKey, fn, { timeoutMs = 120_000, retries = 2, backoffMs = 1000 } = {}) {
  if (controller.signal.aborted) return { skipped: "shutting down" };
  if (!(await acquireLease(jobKey, timeoutMs + 30_000))) return { skipped: "lease held elsewhere" };
  const environment = currentEnvironment();
  let attempt = 0; let lastError = null;
  try {
    while (attempt <= retries) {
      attempt += 1;
      const run = await prisma.platformJobRun.create({ data: { jobKey, environment, status: "Running", attempt } });
      const started = Date.now();
      try {
        const result = await Promise.race([fn({ signal: controller.signal }), sleep(timeoutMs).then(() => { throw Object.assign(new Error("timeout"), { timeout: true }); })]);
        await prisma.platformJobRun.update({ where: { id: run.id }, data: { status: "Succeeded", finishedAt: new Date(), durationMs: Date.now() - started, result: toJson(result ?? null) } });
        return { ok: true, result };
      } catch (err) {
        lastError = err;
        await prisma.platformJobRun.update({ where: { id: run.id }, data: { status: err.timeout ? "Timed out" : "Failed", finishedAt: new Date(), durationMs: Date.now() - started, error: String(err?.code || err?.message || "error").slice(0, 200) } }).catch(() => {});
        if (err.timeout || controller.signal.aborted) break;
        if (attempt <= retries) await sleep(backoffMs * 2 ** (attempt - 1));
      }
    }
    // Dead letter after three consecutive failed runs.
    const recent = await prisma.platformJobRun.findMany({ where: { jobKey, environment }, orderBy: { startedAt: "desc" }, take: 3 * (retries + 1) });
    const lastThreeRuns = [...new Map(recent.map((r) => [r.startedAt.toISOString().slice(0, 16), r])).values()].slice(0, 3);
    if (lastThreeRuns.length === 3 && lastThreeRuns.every((r) => r.status !== "Succeeded")) {
      await prisma.platformJobRun.create({ data: { jobKey, environment, status: "Dead letter", attempt, finishedAt: new Date(), error: String(lastError?.code || lastError?.message || "error").slice(0, 200) } });
      await recordFinding({ category: "configuration", source: "platform-jobs", title: `Platform job ${jobKey} keeps failing`, severity: "High", component: jobKey, fingerprint: `job-dead-letter:${jobKey}` });
    }
    await platformAudit(systemActor(), "job.failed", "PlatformJob", jobKey, { result: "Failure", reason: String(lastError?.code || "error").slice(0, 100) });
    return { ok: false };
  } finally {
    await releaseLease(jobKey);
  }
}

// Schedule: [jobKey, intervalMs, fn, options]
const SYSTEM_REQ = () => ({ ...systemActor(), user: null });
export const PLATFORM_SCHEDULE = [
  ["alerts.evaluate", 60_000, () => evaluateAlerts(), { timeoutMs: 50_000 }],
  ["backups.schedule", 60_000, () => scheduleDueBackups().then((j) => ({ queued: j.length }))],
  ["backups.dispatch", 30_000, () => dispatchQueued()],
  ["backups.ingest", 30_000, () => ingestAgentResults()],
  ["backups.sync", 60_000, () => syncArtifactsFromStatus()],
  ["backups.timeouts", 300_000, () => timeOutStuckJobs()],
  ["restores.drill_schedule", 3_600_000, async () => {
    const r = await checkDrillSchedule();
    // Automated drill when overdue and the agent is available (isolated target only).
    if (r?.overdue && agentConfigured()) { const d = await startDrill(SYSTEM_REQ(), { scenario: "Scheduled drill: latest point into an isolated target" }).catch(() => null); return { ...r, started: d?.publicId || null }; }
    return r;
  }],
  ["health.snapshot", 300_000, () => recordHealthSnapshot().then((h) => ({ overall: h.overall }))],
  ["security.exceptions_expire", 3_600_000, () => expireExceptions()],
  ["secrets.rotation_reminders", 86_400_000, () => markRotationsDue()],
  ["deployments.stuck", 600_000, () => flagStuckDeployments()],
  ["dr.drill_reminders", 86_400_000, () => drillReminders()],
  ["retention.run", 86_400_000, () => runAllRetention(), { timeoutMs: 1_800_000, retries: 0 }],
];

// Called by the worker every tick; runs whatever is due.
const lastRun = new Map();
export async function platformTick(now = Date.now()) {
  await writeHeartbeat(HEARTBEAT_KEYS.scheduler);
  if (process.env.PLATFORM_JOBS_ENABLED === "false") return [];
  const ran = [];
  for (const [key, every, fn, opts] of PLATFORM_SCHEDULE) {
    if (now - (lastRun.get(key) || 0) < every) continue;
    lastRun.set(key, now);
    ran.push([key, await runPlatformJob(key, fn, opts || {}).catch(() => ({ ok: false }))]);
  }
  return ran;
}

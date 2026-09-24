import "dotenv/config";
import http from "node:http";
import { Worker } from "bullmq";
import redis from "./lib/redis.js";
import { EMAIL_QUEUE_NAME } from "./queues/emailQueue.js";
import { sendMail } from "./lib/mailer.js";
import prisma from "./lib/prisma.js";
import { assertVaultReady } from "./integrations/credentials/vault.js";
import { drainOutbox } from "./services/outboxService.js";
import { runSalesDeadlineSweep } from "./jobs/sales/salesDeadlineJobs.js";
import { runSlaSweep } from "./jobs/support/slaJobs.js";
import { runFinanceSweep } from "./jobs/finance/financeJobs.js";
import { runTaskCycle, runMaintenanceCycle } from "./integrations/worker/integrationJobs.js";
import { runAiMaintenance } from "./ai/jobs/aiJobs.js";
import { assertAiModeSafe } from "./ai/common/mode.js";
import { onAuditEvent } from "./services/auditService.js";
import { emitFromAudit } from "./integrations/outbound-webhooks/outboundService.js";
import { indexFromAudit } from "./ai/copilot/retrieval/indexer.js";
import { runCopilotIndexing, runCopilotMaintenance } from "./ai/copilot/jobs.js";
import { runGovernanceMaintenance, runEvaluationWorker } from "./ai/governance/jobs.js";
import { runWarehouseCycle } from "./analytics/warehouse/jobs.js";
import { runDueSchedules } from "./analytics/reports/scheduleService.js";
import { runExportCycle, expireExports } from "./analytics/exports/exportService.js";

// Outbound CRM webhooks for events recorded by worker jobs too.
onAuditEvent(emitFromAudit);
// Backend Phase 10 — Copilot: changes to indexable records queue a reindex.
onAuditEvent((e) => indexFromAudit(e).catch(() => {}));

try {
  assertVaultReady();
} catch (err) {
  console.error(`[worker] Integrations: ${err.message} Refusing to start.`);
  process.exit(1);
}

const worker = new Worker(
  EMAIL_QUEUE_NAME,
  async (job) => {
    console.log(`[worker] processing job ${job.id} (${job.name})`);
    const { to, subject, html, text, outboxEventId } = job.data;
    await sendMail({ to, subject, html, text });
    if (outboxEventId) {
      await prisma.outboxEvent.update({
        where: { id: outboxEventId },
        data: { status: "Sent", processedAt: new Date() },
      }).catch(() => {}); // event may already be gone/handled — non-fatal
    }
    return { delivered: true };
  },
  { connection: redis, concurrency: 5 }
);

worker.on("completed", (job) => console.log(`[worker] job ${job.id} completed`));
worker.on("failed", async (job, err) => {
  console.error(`[worker] job ${job?.id} failed:`, err.message);
  const outboxEventId = job?.data?.outboxEventId;
  if (outboxEventId && job.attemptsMade >= (job.opts.attempts || 1)) {
    await prisma.outboxEvent.update({
      where: { id: outboxEventId },
      data: { status: "Failed", lastError: err.message },
    }).catch(() => {});
  }
});

// Outbox poller — the transactional outbox table is the durable source of
// truth (mutation + outbox row committed together, see
// services/outboxService.js). This periodically picks up `Pending` rows
// that haven't been enqueued yet (e.g. after a worker restart or a missed
// enqueue) and pushes them onto the BullMQ queue.
const POLL_INTERVAL_MS = Number(process.env.OUTBOX_POLL_INTERVAL_MS) || 5000;
const pollTimer = setInterval(() => {
  drainOutbox().catch((err) => console.error("[worker] outbox poll error:", err.message));
}, POLL_INTERVAL_MS);

// Backend Phase 3 — deterministic Sales deadline sweep (quote expiration,
// contract expiration, renewal-notice deadlines, overdue obligations).
// Every check is idempotent and only ever creates an internal
// notification or flips a stored status the domain model already defines
// — never approves, confirms, activates, renews, or terminates anything.
const SALES_SWEEP_INTERVAL_MS = Number(process.env.SALES_DEADLINE_SWEEP_INTERVAL_MS) || 15 * 60 * 1000;
const salesSweepTimer = setInterval(() => {
  runSalesDeadlineSweep().catch((err) => console.error("[worker] sales deadline sweep error:", err.message));
}, SALES_SWEEP_INTERVAL_MS);

// Backend Phase 4 — SLA sweep: breaches (recorded at their due time),
// warnings, and resuming clocks left paused. Idempotent; never resolves,
// re-prioritizes or messages customers.
const SLA_SWEEP_INTERVAL_MS = Number(process.env.SUPPORT_SLA_SWEEP_INTERVAL_MS) || 60 * 1000;
const slaSweepTimer = setInterval(() => {
  runSlaSweep().catch((err) => console.error("[worker] SLA sweep error:", err.message));
}, SLA_SWEEP_INTERVAL_MS);

// Backend Phase 6 — Finance sweep: overdue and due-soon invoices and bills,
// periods nearing their end, unreconciled statement lines. Internal
// notifications only; never approves, posts, pays or closes anything.
const FINANCE_SWEEP_INTERVAL_MS = Number(process.env.FINANCE_SWEEP_INTERVAL_MS) || 60 * 60 * 1000;
const financeSweepTimer = setInterval(() => {
  runFinanceSweep().catch((err) => console.error("[worker] finance sweep error:", err.message));
}, FINANCE_SWEEP_INTERVAL_MS);

// Backend Phase 8 — integrations: the fair task queue every 15 s (sync runs,
// webhook events, outbound deliveries), and maintenance every 5 min
// (scheduled incremental syncs, token refresh, health checks, retention).
const INTEGRATION_TASK_INTERVAL_MS = Number(process.env.INTEGRATION_TASK_INTERVAL_MS) || 15_000;
const integrationTaskTimer = setInterval(() => {
  runTaskCycle().catch((err) => console.error("[worker] integration tasks error:", err.message));
}, INTEGRATION_TASK_INTERVAL_MS);
const INTEGRATION_MAINTENANCE_INTERVAL_MS = Number(process.env.INTEGRATION_MAINTENANCE_INTERVAL_MS) || 5 * 60_000;
// Backend Phase 9 — AI: budget reservations, proposal expiry, budget periods,
// stale requests, retention and daily re-verification, every 5 minutes.
assertAiModeSafe();
const AI_MAINTENANCE_INTERVAL_MS = Number(process.env.AI_MAINTENANCE_INTERVAL_MS) || 5 * 60_000;
const aiMaintenanceTimer = setInterval(() => {
  runAiMaintenance().catch((err) => console.error("[worker] AI maintenance error:", err.message));
}, AI_MAINTENANCE_INTERVAL_MS);
// Backend Phase 10 — Copilot indexing every 10 s; workflow/memory expiry,
// stale answers, retention and the hourly index sweep every 5 minutes.
const COPILOT_INDEX_INTERVAL_MS = Number(process.env.COPILOT_INDEX_INTERVAL_MS) || 10_000;
const copilotIndexTimer = setInterval(() => {
  runCopilotIndexing().catch((err) => console.error("[worker] Copilot indexing error:", err.message));
}, COPILOT_INDEX_INTERVAL_MS);
const copilotMaintenanceTimer = setInterval(() => {
  runCopilotMaintenance().catch((err) => console.error("[worker] Copilot maintenance error:", err.message));
}, AI_MAINTENANCE_INTERVAL_MS);
// Backend Phase 11 — AI governance: alerts, automatic rollback, expiries,
// review queues and drift every minute (SLOs every 15 min); the evaluation
// worker runs one queued evaluation at a time.
const GOVERNANCE_INTERVAL_MS = Number(process.env.AI_GOVERNANCE_INTERVAL_MS) || 60_000;
const governanceTimer = setInterval(() => {
  runGovernanceMaintenance({ redis }).catch((err) => console.error("[worker] AI governance error:", err.message));
}, GOVERNANCE_INTERVAL_MS);
let evaluating = false;
const evaluationTimer = setInterval(() => {
  if (evaluating) return;
  evaluating = true;
  runEvaluationWorker({ redis }).catch((err) => console.error("[worker] AI evaluation error:", err.message)).finally(() => { evaluating = false; });
}, Number(process.env.AI_EVALUATION_INTERVAL_MS) || 15_000);
// Backend Phase 12 — analytics: warehouse loads (scheduler, retries, snapshots,
// reconciliation, view refresh) every minute; due report schedules and queued
// exports every 30 s; export expiry with the analytics cycle. Each loop skips a
// tick while its previous run is still going.
const ANALYTICS_INTERVAL_MS = Number(process.env.ANALYTICS_INTERVAL_MS) || 60_000;
let warehouseBusy = false;
const analyticsTimer = setInterval(() => {
  if (warehouseBusy || process.env.ANALYTICS_WAREHOUSE_ENABLED === "false") return;
  warehouseBusy = true;
  Promise.all([runWarehouseCycle(), expireExports()]).catch((err) => console.error("[worker] analytics warehouse error:", err.message)).finally(() => { warehouseBusy = false; });
}, ANALYTICS_INTERVAL_MS);
let deliveryBusy = false;
const analyticsDeliveryTimer = setInterval(() => {
  if (deliveryBusy) return;
  deliveryBusy = true;
  runDueSchedules().then(() => runExportCycle()).catch((err) => console.error("[worker] analytics delivery error:", err.message)).finally(() => { deliveryBusy = false; });
}, Number(process.env.ANALYTICS_DELIVERY_INTERVAL_MS) || 30_000);
const integrationMaintenanceTimer = setInterval(() => {
  runMaintenanceCycle().catch((err) => console.error("[worker] integration maintenance error:", err.message));
}, INTEGRATION_MAINTENANCE_INTERVAL_MS);

// Independent liveness endpoint — separate from the api's own /health, per
// Backend Phase 1's "independent health or liveness check" requirement.
const WORKER_PORT = process.env.WORKER_PORT || 4001;
const healthServer = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
  } else {
    res.writeHead(404);
    res.end();
  }
});
healthServer.listen(WORKER_PORT, () => console.log(`[worker] health listener on port ${WORKER_PORT}`));

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[worker] ${signal} received, shutting down gracefully...`);
  clearInterval(pollTimer);
  clearInterval(salesSweepTimer);
  clearInterval(slaSweepTimer);
  clearInterval(financeSweepTimer);
  clearInterval(integrationTaskTimer);
  clearInterval(integrationMaintenanceTimer);
  clearInterval(aiMaintenanceTimer);
  clearInterval(copilotIndexTimer);
  clearInterval(copilotMaintenanceTimer);
  clearInterval(governanceTimer);
  clearInterval(evaluationTimer);
  clearInterval(analyticsTimer);
  clearInterval(analyticsDeliveryTimer);
  healthServer.close();
  await worker.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

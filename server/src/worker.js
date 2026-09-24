import "dotenv/config";
import http from "node:http";
import { Worker } from "bullmq";
import redis from "./lib/redis.js";
import { EMAIL_QUEUE_NAME } from "./queues/emailQueue.js";
import { sendMail } from "./lib/mailer.js";
import prisma from "./lib/prisma.js";
import { drainOutbox } from "./services/outboxService.js";
import { runSalesDeadlineSweep } from "./jobs/sales/salesDeadlineJobs.js";
import { runSlaSweep } from "./jobs/support/slaJobs.js";
import { runFinanceSweep } from "./jobs/finance/financeJobs.js";

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
  healthServer.close();
  await worker.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

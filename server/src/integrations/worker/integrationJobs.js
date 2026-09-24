// Backend Phase 8 — integration background work for the existing worker:
// the fair task queue (sync runs, webhook events, outbound deliveries),
// scheduled incremental syncs, credential refresh, connection health
// checks, webhook subscription renewal and data retention. Every job is
// idempotent. None approves, posts, pays, deletes CRM records or calls AI.
import { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma.js";
import { drainTasks } from "../common/taskQueue.js";
import { executeRun, queueSyncRun } from "../synchronization/syncService.js";
import { refreshConnection, accessTokenFor, recordOutcome, isUsable } from "../connections/connectionService.js";
import { getAdapter } from "../providers/registry.js";
import { purgeOAuthStates } from "../oauth/oauthService.js";
import { integrationLog } from "../common/audit.js";
import { processWebhookEvent, renewSubscriptions } from "../webhooks/webhookService.js";
import { deliver, markDeliveryDeadLetter } from "../outbound-webhooks/outboundService.js";

const handlers = {};
export function registerTaskHandler(kind, fn) { handlers[kind] = fn; }
registerTaskHandler("sync", (task) => executeRun(task.refId));
registerTaskHandler("webhook_event", (task) => processWebhookEvent(task.refId));
registerTaskHandler("outbound_delivery", (task) => deliver(task.refId));
const onDeadLetter = { outbound_delivery: (task) => markDeliveryDeadLetter(task.refId) };

export const runTaskCycle = () => drainTasks(handlers, { max: 25, onDeadLetter });

// Enabled configurations with a schedule, after their confirmed initial sync.
export async function scheduleIncrementalSyncs(now = new Date()) {
  const configs = await prisma.integrationSyncConfiguration.findMany({ where: { enabled: true, scheduleMinutes: { not: null }, initialSyncCompletedAt: { not: null } } });
  let queued = 0;
  for (const config of configs) {
    const connection = await prisma.integrationConnection.findUnique({ where: { id: config.connectionId } });
    if (!connection || !isUsable(connection)) continue;
    const checkpoint = await prisma.integrationSyncCheckpoint.findUnique({ where: { syncConfigurationId: config.id } });
    if (checkpoint?.expiredAt) continue; // needs a person and a preview
    const last = await prisma.integrationSyncRun.findFirst({ where: { syncConfigurationId: config.id, kind: "Sync" }, orderBy: { createdAt: "desc" } });
    if (last && ["Queued", "Running"].includes(last.status)) continue;
    if (last && now - last.createdAt < config.scheduleMinutes * 60_000) continue;
    await queueSyncRun({ connection, config, trigger: "Schedule" });
    queued += 1;
  }
  return queued;
}

// Access tokens expiring within 10 minutes are refreshed ahead of time.
export async function refreshExpiringCredentials(now = new Date()) {
  const soon = new Date(now.getTime() + 10 * 60_000);
  const creds = await prisma.integrationCredential.findMany({ where: { credentialType: "access_token", status: "Active", expiresAt: { lt: soon }, connectionId: { not: null } }, select: { connectionId: true }, take: 100 });
  let refreshed = 0;
  for (const { connectionId } of creds) {
    const connection = await prisma.integrationConnection.findUnique({ where: { id: connectionId } });
    if (!connection || !isUsable(connection)) continue;
    const hasRefresh = await prisma.integrationCredential.count({ where: { connectionId, credentialType: "refresh_token", status: "Active" } });
    if (!hasRefresh) continue;
    try { await refreshConnection(connection); refreshed += 1; } catch { /* recorded on the connection */ }
  }
  return refreshed;
}

// Connections not verified for 12 hours get an identity call.
export async function healthChecks(now = new Date()) {
  const stale = await prisma.integrationConnection.findMany({ where: { status: { in: ["Connected", "Connected with Warnings"] }, pausedAt: null, OR: [{ lastVerifiedAt: null }, { lastVerifiedAt: { lt: new Date(now - 12 * 3600_000) } }] }, take: 50 });
  let checked = 0;
  for (const connection of stale) {
    const adapter = getAdapter(connection.providerKey, connection.mode);
    try {
      const token = await accessTokenFor(connection);
      await adapter.testConnection({ accessToken: token });
      await prisma.integrationConnection.update({ where: { id: connection.id }, data: { lastVerifiedAt: now } });
      await recordOutcome(connection);
    } catch (err) {
      await recordOutcome(connection, err);
      await integrationLog({ organizationId: connection.organizationId, connectionId: connection.id, level: "warning", event: "health.failed", message: err.message || "Health check failed." });
    }
    checked += 1;
  }
  return checked;
}

// Retention: raw payloads are redacted after the policy's retention period;
// audit metadata is never removed.
export async function applyRetention(now = new Date()) {
  const out = {};
  out.oauthStates = await purgeOAuthStates(now);
  out.webhookPayloads = (await prisma.integrationWebhookEvent.updateMany({ where: { payloadExpiresAt: { lt: now }, NOT: { payload: { equals: Prisma.DbNull } } }, data: { payload: Prisma.DbNull } })).count;
  out.deliveryPayloads = (await prisma.integrationOutboundDelivery.updateMany({ where: { payloadExpiresAt: { lt: now }, NOT: { payload: { equals: Prisma.DbNull } } }, data: { payload: Prisma.DbNull } })).count;
  out.conflictSnapshots = (await prisma.integrationConflict.updateMany({ where: { status: "Resolved", snapshotExpiresAt: { lt: now } }, data: { crmValues: {}, providerValues: {} } })).count;
  out.previews = (await prisma.integrationSyncRun.updateMany({ where: { kind: "Preview", previewExpiresAt: { lt: new Date(now - 86_400_000) }, NOT: { preview: { equals: Prisma.DbNull } } }, data: { preview: Prisma.DbNull } })).count;
  out.logs = (await prisma.integrationLog.deleteMany({ where: { createdAt: { lt: new Date(now - 90 * 86_400_000) } } })).count;
  out.tasks = (await prisma.integrationTask.deleteMany({ where: { status: { in: ["Done", "Cancelled"] }, updatedAt: { lt: new Date(now - 30 * 86_400_000) } } })).count;
  return out;
}

export async function runMaintenanceCycle() {
  const results = {};
  for (const [name, fn] of Object.entries({ scheduled: scheduleIncrementalSyncs, refreshed: refreshExpiringCredentials, health: healthChecks, renewed: renewSubscriptions, retention: applyRetention })) {
    try { results[name] = await fn(); } catch (err) { results[name] = `error: ${err.message}`; }
  }
  return results;
}

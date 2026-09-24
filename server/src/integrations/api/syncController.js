// Backend Phase 8 — sync configurations, previews, runs, conflicts,
// mappings, logs, usage and audit.
//
// Functional scope: configuring, previewing or running a sync also needs
// the caller's own grant on the CRM module the capability writes to
// (activities, tasks, reconciliation), so a Sales manager can't import into
// Finance and vice versa.
import prisma from "../../lib/prisma.js";
import { hasGrant } from "../../utils/grants.js";
import { IntegrationError, KINDS, sendIntegrationError } from "../common/errors.js";
import { integrationAudit } from "../common/audit.js";
import { drainTasks, retryDeadLetter } from "../common/taskQueue.js";
import { getPolicy, assertDirectionAllowed } from "../policies/policyService.js";
import { loadConnection, canManage, connectionVisibilityWhere, assertCallable } from "../connections/connectionService.js";
import { createPreview, queueSyncRun, executeRun } from "../synchronization/syncService.js";
import { SYNCABLE_ENTITY_TYPES } from "../synchronization/transformers.js";
import { resolveConflict, serializeConflict } from "../conflicts/conflictService.js";

const who = (req) => req.membership?.id || null;
const guard = (fn) => async (req, res, next) => {
  try {
    await fn(req, res, next);
  } catch (err) {
    if (err instanceof IntegrationError) return sendIntegrationError(res, err);
    return next(err);
  }
};
const forbidden = (res, message) => res.status(403).json({ code: "RBAC_FORBIDDEN", message });
const notFound = (res, what) => res.status(404).json({ code: "INTEGRATION_NOT_FOUND", message: `${what} not found.` });

// CRM module each capability writes into → the grant needed on it.
const MODULE_GRANTS = { activities: ["activities", "edit"], tasks: ["tasks", "create"], reconciliation: ["reconciliation", "create"], notifications: ["integration_connections", "edit"] };
export function assertFunctionalScope(req, capability) {
  const need = MODULE_GRANTS[capability.crmModule];
  if (!need) throw new IntegrationError(KINDS.UNSUPPORTED, capability.unavailableReason || "This capability can't be synchronized.");
  if (!hasGrant(req, need[0], need[1])) throw new IntegrationError(KINDS.POLICY, `This capability writes to ${capability.crmModule}; your role needs ${need[0]}:${need[1]}.`);
}

// The person may act on this connection's sync: their own personal
// connection, or any connection with integration_sync rights.
function assertSyncAccess(req, connection, action) {
  if (connection.ownershipType === "User Connection" && connection.connectedMembershipId !== who(req) && !hasGrant(req, "integration_connections", "create_organization")) throw new IntegrationError(KINDS.POLICY, "This is someone else's personal connection.");
  if (!hasGrant(req, "integration_sync", action)) throw new IntegrationError(KINDS.POLICY, `You need integration_sync:${action}.`);
}

const kickWorker = () => setImmediate(() => { drainTasks({ sync: (t) => executeRun(t.refId) }, { max: 5 }).catch(() => {}); });

const serializeRun = (r) => ({
  _id: r.id, connectionId: r.connectionId, syncConfigurationId: r.syncConfigurationId, capability: r.capability, kind: r.kind, trigger: r.trigger, direction: r.direction, status: r.status,
  startedAt: r.startedAt, completedAt: r.completedAt, discovered: r.discovered, created: r.created, updated: r.updated, skipped: r.skipped, conflicts: r.conflicts, failures: r.failures,
  apiCalls: r.apiCalls, rateLimitState: r.rateLimitState, checkpointBefore: r.checkpointBefore ? "stored" : null, checkpointAfter: r.checkpointAfter ? "stored" : null,
  preview: r.kind === "Preview" ? r.preview : undefined, previewExpiresAt: r.previewExpiresAt, confirmedAt: r.confirmedAt, initiatedByMembershipId: r.initiatedByMembershipId,
  correlationId: r.correlationId, errorCode: r.errorCode, errorMessage: r.errorMessage, createdAt: r.createdAt,
});

// ---- Configurations -------------------------------------------------------------

export const listConfigurations = guard(async (req, res) => {
  const connection = await loadConnection(req, req.params.connectionId);
  if (!connection) return notFound(res, "Connection");
  const configs = await prisma.integrationSyncConfiguration.findMany({ where: { connectionId: connection.id }, orderBy: { createdAt: "asc" } });
  const checkpoints = await prisma.integrationSyncCheckpoint.findMany({ where: { connectionId: connection.id } });
  res.json({ syncConfigurations: configs.map((c) => { const cp = checkpoints.find((k) => k.syncConfigurationId === c.id); return { ...c, _id: c.id, checkpoint: cp ? { lastSuccessAt: cp.lastSuccessAt, version: cp.checkpointVersion, expired: !!cp.expiredAt } : null }; }) });
});

// Creates or updates the configuration for one capability. Safe defaults;
// Two Way needs the policy to allow it, a capable adapter and an explicit
// confirmation — it is never switched on silently.
export const saveConfiguration = guard(async (req, res) => {
  const connection = await loadConnection(req, req.params.connectionId);
  if (!connection) return notFound(res, "Connection");
  assertSyncAccess(req, connection, "configure");
  const provider = await prisma.integrationProvider.findUnique({ where: { key: connection.providerKey } });
  const capability = (provider.capabilities || []).find((c) => c.key === req.body.capability);
  if (!capability) return res.status(400).json({ code: "INTEGRATION_VALIDATION", message: "Unknown capability." });
  if (capability.requiresPhase) throw new IntegrationError(KINDS.UNSUPPORTED, capability.unavailableReason);
  if (!SYNCABLE_ENTITY_TYPES.includes(capability.entityType)) throw new IntegrationError(KINDS.UNSUPPORTED, "This capability is an explicit action (link, draft, notify), not a sync.");
  assertFunctionalScope(req, capability);
  const policy = await getPolicy(req.organizationId);
  const direction = req.body.direction || "Import Only";
  if (!["Import Only", "Export Only", "Two Way"].includes(direction)) return res.status(400).json({ code: "INTEGRATION_VALIDATION", message: "direction: Import Only, Export Only or Two Way." });
  assertDirectionAllowed(policy, direction);
  if (capability.financeReadOnly && direction !== "Import Only") throw new IntegrationError(KINDS.POLICY, "Finance providers are read-only: Import Only.");
  if (direction !== "Import Only" && capability.direction === "Import Only" && !capability.twoWayCapable) throw new IntegrationError(KINDS.POLICY, `${capability.name} is import-only.`);
  if (direction === "Two Way" && req.body.confirmTwoWay !== true) return res.status(400).json({ code: "INTEGRATION_CONFIRMATION_REQUIRED", message: "Two-way sync sends CRM changes to the provider. Send confirmTwoWay: true to enable it." });
  const filters = req.body.filters && typeof req.body.filters === "object" ? { projectId: req.body.filters.projectId || undefined, financialAccountId: req.body.filters.financialAccountId || undefined, calendarIds: Array.isArray(req.body.filters.calendarIds) ? req.body.filters.calendarIds.slice(0, 20) : undefined, repositories: Array.isArray(req.body.filters.repositories) ? req.body.filters.repositories.slice(0, 20) : undefined } : {};
  if (capability.entityType === "issue" && filters.projectId && !(await prisma.project.findFirst({ where: { id: filters.projectId, organizationId: req.organizationId } }))) return res.status(400).json({ code: "INTEGRATION_VALIDATION", message: "filters.projectId must be a project in this organization." });
  if (capability.entityType === "financial_transaction" && filters.financialAccountId && !(await prisma.financialAccount.findFirst({ where: { id: filters.financialAccountId, organizationId: req.organizationId } }))) return res.status(400).json({ code: "INTEGRATION_VALIDATION", message: "filters.financialAccountId must be a financial account in this organization." });
  const schedule = req.body.scheduleMinutes === null || req.body.scheduleMinutes === undefined ? null : Number(req.body.scheduleMinutes);
  if (schedule !== null && (!Number.isInteger(schedule) || schedule < policy.maxSyncFrequencyMinutes)) return res.status(400).json({ code: "INTEGRATION_POLICY_DENIED", message: `The policy allows syncing at most every ${policy.maxSyncFrequencyMinutes} minutes.` });
  const data = {
    direction, sourceOfTruth: req.body.sourceOfTruth === "Provider" ? "Provider" : "CRM", filters, fieldMapping: {},
    conflictPolicy: ["Manual", "Keep CRM"].includes(req.body.conflictPolicy) ? req.body.conflictPolicy : policy.defaultConflictPolicy === "Keep Provider" ? "Manual" : policy.defaultConflictPolicy,
    deletionPolicy: "No Deletions", scheduleMinutes: schedule, updatedByMembershipId: who(req),
    ...(direction === "Two Way" ? { twoWayConfirmedAt: new Date(), twoWayConfirmedByMembershipId: who(req) } : { twoWayConfirmedAt: null, twoWayConfirmedByMembershipId: null }),
  };
  const existing = await prisma.integrationSyncConfiguration.findUnique({ where: { connectionId_capability_entityType: { connectionId: connection.id, capability: capability.key, entityType: capability.entityType } } });
  if (existing && req.body.version !== undefined && Number(req.body.version) !== existing.version) return res.status(409).json({ code: "INTEGRATION_VERSION_CONFLICT", message: "The configuration was updated by someone else." });
  const config = existing
    ? await prisma.integrationSyncConfiguration.update({ where: { id: existing.id }, data: { ...data, version: { increment: 1 } } })
    : await prisma.integrationSyncConfiguration.create({ data: { ...data, organizationId: req.organizationId, connectionId: connection.id, capability: capability.key, entityType: capability.entityType, enabled: false, createdByMembershipId: who(req) } });
  await integrationAudit(req, existing ? "integrations.sync_configuration.updated" : "integrations.sync_configuration.created", "IntegrationSyncConfiguration", config.id, { before: existing ? { direction: existing.direction, conflictPolicy: existing.conflictPolicy } : null, after: { capability: capability.key, direction, conflictPolicy: data.conflictPolicy, twoWayConfirmed: direction === "Two Way" } });
  return res.status(existing ? 200 : 201).json({ syncConfiguration: { ...config, _id: config.id } });
});

// ---- Preview and runs -------------------------------------------------------------

async function configFor(req, connection, id) {
  const config = await prisma.integrationSyncConfiguration.findFirst({ where: { id, connectionId: connection.id } });
  if (!config) throw new IntegrationError(KINDS.PERMANENT, "Sync configuration not found for this connection.");
  const provider = await prisma.integrationProvider.findUnique({ where: { key: connection.providerKey } });
  assertFunctionalScope(req, (provider.capabilities || []).find((c) => c.key === config.capability));
  return config;
}

export const createSyncPreview = guard(async (req, res) => {
  const connection = await loadConnection(req, req.params.connectionId);
  if (!connection) return notFound(res, "Connection");
  assertSyncAccess(req, connection, "preview");
  const config = await configFor(req, connection, req.body.syncConfigurationId);
  const run = await createPreview(req, connection, config);
  await integrationAudit(req, "integrations.sync.preview_created", "IntegrationSyncRun", run.id, { after: { capability: config.capability, counts: run.preview.counts } });
  return res.status(201).json({ syncRun: serializeRun(run), note: "Nothing has been written. Confirm to run the sync, or let the preview expire." });
});

// Runs a sync. An initial sync (or one after an expired change token) needs
// a confirmed, unexpired preview; later incremental runs don't.
export const runSync = guard(async (req, res) => {
  const connection = await loadConnection(req, req.params.connectionId);
  if (!connection) return notFound(res, "Connection");
  assertSyncAccess(req, connection, "execute");
  assertCallable(connection);
  if (connection.pausedAt) throw new IntegrationError(KINDS.POLICY, "The connection is paused. Resume it first.");
  let preview = null;
  let config;
  if (req.body.previewRunId) {
    preview = await prisma.integrationSyncRun.findFirst({ where: { id: req.body.previewRunId, connectionId: connection.id, kind: "Preview" } });
    if (!preview) return notFound(res, "Preview");
    if (req.body.confirm !== true) return res.status(400).json({ code: "INTEGRATION_CONFIRMATION_REQUIRED", message: "Confirm the preview (confirm: true) to run the sync." });
    if (preview.status !== "Awaiting Confirmation") return res.status(409).json({ code: "INTEGRATION_INVALID_TRANSITION", message: `This preview is ${preview.status.toLowerCase()}.` });
    if (preview.previewExpiresAt < new Date()) {
      await prisma.integrationSyncRun.update({ where: { id: preview.id }, data: { status: "Expired" } });
      return res.status(409).json({ code: "INTEGRATION_PREVIEW_EXPIRED", message: "The preview expired. Create a new one." });
    }
    config = await configFor(req, connection, preview.syncConfigurationId);
  } else {
    config = await configFor(req, connection, req.body.syncConfigurationId);
    const checkpoint = await prisma.integrationSyncCheckpoint.findUnique({ where: { syncConfigurationId: config.id } });
    if (!config.initialSyncCompletedAt || checkpoint?.expiredAt) return res.status(409).json({ code: "INTEGRATION_PREVIEW_REQUIRED", message: "The first sync (and any sync after an expired change token) needs a confirmed preview." });
  }
  const running = await prisma.integrationSyncRun.findFirst({ where: { syncConfigurationId: config.id, status: { in: ["Queued", "Running"] } } });
  if (running) return res.status(409).json({ code: "INTEGRATION_SYNC_RUNNING", message: "A sync for this configuration is already queued or running.", syncRunId: running.id });
  if (preview) {
    const confirmed = await prisma.integrationSyncRun.updateMany({ where: { id: preview.id, status: "Awaiting Confirmation" }, data: { status: "Completed", confirmedAt: new Date(), confirmedByMembershipId: who(req) } });
    if (confirmed.count !== 1) return res.status(409).json({ code: "INTEGRATION_INVALID_TRANSITION", message: "This preview was already confirmed." });
  }
  if (!config.enabled) await prisma.integrationSyncConfiguration.update({ where: { id: config.id }, data: { enabled: true } });
  const run = await queueSyncRun({ connection, config, membershipId: who(req), trigger: "Manual", previewRun: preview });
  await integrationAudit(req, "integrations.sync.started", "IntegrationSyncRun", run.id, { after: { capability: config.capability, direction: config.direction, fromPreview: preview?.id || null } });
  kickWorker();
  return res.status(202).json({ syncRun: serializeRun(run) });
});

export const cancelRun = guard(async (req, res) => {
  const run = await prisma.integrationSyncRun.findFirst({ where: { id: req.params.runId, organizationId: req.organizationId } });
  if (!run) return notFound(res, "Sync run");
  const connection = await loadConnection(req, run.connectionId);
  if (!connection) return notFound(res, "Sync run");
  assertSyncAccess(req, connection, "cancel");
  const cancelled = await prisma.integrationSyncRun.updateMany({ where: { id: run.id, status: { in: ["Queued", "Running", "Awaiting Confirmation", "Rate Limited", "Paused"] } }, data: { status: "Cancelled", completedAt: new Date() } });
  if (cancelled.count !== 1) return res.status(409).json({ code: "INTEGRATION_INVALID_TRANSITION", message: `This run is ${run.status.toLowerCase()}.` });
  await prisma.integrationTask.updateMany({ where: { kind: "sync", refId: run.id, status: "Queued" }, data: { status: "Cancelled" } });
  await integrationAudit(req, "integrations.sync.cancelled", "IntegrationSyncRun", run.id);
  return res.json({ syncRun: serializeRun(await prisma.integrationSyncRun.findUnique({ where: { id: run.id } })), note: "Records already committed stay; the checkpoint didn't advance." });
});

const visibleConnectionIds = async (req) => (await prisma.integrationConnection.findMany({ where: { organizationId: req.organizationId, ...connectionVisibilityWhere(req) }, select: { id: true } })).map((c) => c.id);

export const listRuns = guard(async (req, res) => {
  const where = { organizationId: req.organizationId, connectionId: { in: await visibleConnectionIds(req) } };
  if (req.query.connectionId) {
    const c = await loadConnection(req, req.query.connectionId);
    if (!c) return notFound(res, "Connection");
    where.connectionId = c.id;
  }
  if (req.query.status) where.status = req.query.status;
  if (req.query.kind) where.kind = req.query.kind;
  const runs = await prisma.integrationSyncRun.findMany({ where, orderBy: { createdAt: "desc" }, take: Math.min(200, Number(req.query.limit) || 50) });
  return res.json({ syncRuns: runs.map(serializeRun) });
});

export const getRun = guard(async (req, res) => {
  const run = await prisma.integrationSyncRun.findFirst({ where: { id: req.params.runId, organizationId: req.organizationId, connectionId: { in: await visibleConnectionIds(req) } } });
  if (!run) return notFound(res, "Sync run");
  return res.json({ syncRun: serializeRun(run) });
});

// ---- Conflicts and mappings ----------------------------------------------------------

export const listConflicts = guard(async (req, res) => {
  const where = { organizationId: req.organizationId, connectionId: { in: await visibleConnectionIds(req) }, status: req.query.status || "Open" };
  const conflicts = await prisma.integrationConflict.findMany({ where, orderBy: { detectedAt: "desc" }, take: 200 });
  return res.json({ conflicts: conflicts.map((c) => serializeConflict(req, c)) });
});

export const resolveConflictHandler = guard(async (req, res) => {
  const conflict = await prisma.integrationConflict.findFirst({ where: { id: req.params.conflictId, organizationId: req.organizationId, connectionId: { in: await visibleConnectionIds(req) } } });
  if (!conflict) return notFound(res, "Conflict");
  const connection = await prisma.integrationConnection.findUnique({ where: { id: conflict.connectionId } });
  if (!canManage(req, connection) && !hasGrant(req, "integration_conflicts", "resolve")) return forbidden(res, "You can't resolve this conflict.");
  const resolved = await resolveConflict(req, conflict, { resolution: req.body.resolution, selectedFields: req.body.selectedFields, reason: typeof req.body.reason === "string" ? req.body.reason.slice(0, 500) : null });
  await integrationAudit(req, "integrations.conflict.resolved", "IntegrationConflict", conflict.id, { after: { resolution: resolved.resolution, fields: conflict.fields } });
  return res.json({ conflict: serializeConflict(req, resolved) });
});

export const listMappings = guard(async (req, res) => {
  const connection = await loadConnection(req, req.params.connectionId);
  if (!connection) return notFound(res, "Connection");
  const mappings = await prisma.integrationRecordMapping.findMany({ where: { connectionId: connection.id, ...(req.query.syncState && { syncState: req.query.syncState }) }, orderBy: { updatedAt: "desc" }, take: 500 });
  return res.json({ mappings: mappings.map((m) => ({ _id: m.id, providerEntityType: m.providerEntityType, externalId: m.externalId, crmEntityType: m.crmEntityType, crmRecordId: m.crmRecordId, syncState: m.syncState, lastSyncedAt: m.lastSyncedAt, lastWriteOrigin: m.lastWriteOrigin })) });
});

// ---- Logs, usage, audit, dead letters ------------------------------------------------------

export const listLogs = guard(async (req, res) => {
  const ids = await visibleConnectionIds(req);
  const logs = await prisma.integrationLog.findMany({ where: { organizationId: req.organizationId, OR: [{ connectionId: null }, { connectionId: { in: ids } }], ...(req.query.level && { level: req.query.level }) }, orderBy: { createdAt: "desc" }, take: Math.min(500, Number(req.query.limit) || 100) });
  return res.json({ logs });
});

export const usage = guard(async (req, res) => {
  const ids = await visibleConnectionIds(req);
  const since = new Date(Date.now() - 30 * 86_400_000);
  const rows = await prisma.integrationUsage.findMany({ where: { organizationId: req.organizationId, connectionId: { in: ids }, day: { gte: since } }, orderBy: { day: "asc" } });
  const connections = await prisma.integrationConnection.findMany({ where: { id: { in: ids } }, select: { id: true, publicId: true, providerKey: true, name: true, status: true, rateLimitedUntil: true, circuitOpenUntil: true, consecutiveFailures: true } });
  const totals = {};
  for (const r of rows) {
    const t = (totals[r.connectionId] ||= { apiCalls: 0, rateLimitHits: 0, errors: 0, recordsIn: 0, recordsOut: 0 });
    for (const k of Object.keys(t)) t[k] += r[k];
  }
  const tasks = await prisma.integrationTask.groupBy({ by: ["status"], where: { organizationId: req.organizationId }, _count: { _all: true } });
  return res.json({
    period: "last 30 days",
    connections: connections.map((c) => ({ connectionId: c.publicId, providerKey: c.providerKey, name: c.name, status: c.status, rateLimitedUntil: c.rateLimitedUntil, circuitOpenUntil: c.circuitOpenUntil, consecutiveFailures: c.consecutiveFailures, ...(totals[c.id] || { apiCalls: 0, rateLimitHits: 0, errors: 0, recordsIn: 0, recordsOut: 0 }) })),
    queue: Object.fromEntries(tasks.map((t) => [t.status, t._count._all])),
  });
});

export const listAudit = guard(async (req, res) => {
  const events = await prisma.auditEvent.findMany({ where: { organizationId: req.organizationId, action: { startsWith: "integrations." } }, orderBy: { createdAt: "desc" }, take: Math.min(500, Number(req.query.limit) || 100) });
  return res.json({ auditEvents: events.map((e) => ({ _id: e.id, action: e.action, targetType: e.targetType, targetId: e.targetId, result: e.result, reason: e.reason, actorMembershipId: e.actorMembershipId, createdAt: e.createdAt, after: e.afterData })) });
});

export const listDeadLetters = guard(async (req, res) => {
  const tasks = await prisma.integrationTask.findMany({ where: { organizationId: req.organizationId, status: { in: ["Dead Letter", "Failed"] } }, orderBy: { updatedAt: "desc" }, take: 200 });
  return res.json({ deadLetters: tasks.map((t) => ({ _id: t.id, kind: t.kind, status: t.status, attempts: t.attempts, lastErrorCode: t.lastErrorCode, lastError: t.lastError, updatedAt: t.updatedAt })) });
});

export const retryDeadLetterHandler = guard(async (req, res) => {
  if (!(await retryDeadLetter(req.params.taskId, req.organizationId))) return notFound(res, "Dead letter");
  await integrationAudit(req, "integrations.dead_letter.retried", "IntegrationTask", req.params.taskId);
  kickWorker();
  return res.json({ ok: true });
});

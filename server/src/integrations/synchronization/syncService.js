// Backend Phase 8 — synchronization.
//
// Safe defaults: Import Only, nothing runs until a person has seen a
// preview of an initial sync and confirmed it, no deletions in either
// direction, conflicts resolved by a person, restricted fields never sent.
//
// preview  → a bounded sample (at most PREVIEW_LIMIT records): what would be
//            created, updated, skipped, conflicted or tombstoned, plus the
//            estimated API usage. Nothing is written except the preview run.
// sync run → pages through the provider from the stored checkpoint. Each
//            page is committed in one transaction; the checkpoint advances
//            only after every page has committed, so a failed run can be
//            retried from the same place and replays are idempotent
//            (mapping uniqueness + checksums).
// Loop prevention: a record whose checksum equals what we last wrote or
// last read is skipped; a provider echo of our own export is recognised by
// the outbound checksum.
import crypto from "node:crypto";
import prisma from "../../lib/prisma.js";
import { IntegrationError, KINDS } from "../common/errors.js";
import { integrationLog, integrationAudit } from "../common/audit.js";
import { enqueueTask } from "../common/taskQueue.js";
import { getAdapter } from "../providers/registry.js";
import { getPolicy, restrictedFields, filterOutbound } from "../policies/policyService.js";
import { accessTokenFor, assertCallable, recordOutcome } from "../connections/connectionService.js";
import { normalize, applyToCrm, crmFields, loadCrmRecord, checksum } from "./transformers.js";

export const PREVIEW_LIMIT = 20;
const PAGE_SIZE = 25;
const PREVIEW_TTL_MS = 30 * 60 * 1000;
const MAX_PAGES_PER_RUN = 40;

export const correlation = () => crypto.randomUUID();

async function day(connection, counts, db = prisma) {
  const d = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
  await db.integrationUsage.upsert({
    where: { connectionId_day: { connectionId: connection.id, day: d } },
    create: { organizationId: connection.organizationId, connectionId: connection.id, day: d, ...counts },
    update: Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, { increment: v }])),
  });
}

// Decides what a normalized record means for its mapping and CRM record.
export function classify({ normalized, mapping, crmRecord, entityType }) {
  if (mapping?.syncState === "Disconnected") return { action: "skip", reason: "Mapping disconnected" };
  if (normalized.deleted) return { action: mapping ? "tombstone" : "skip", reason: "Deleted at the provider — the CRM record is kept" };
  if (!mapping) return { action: "create" };
  if (normalized.checksum === mapping.lastInboundChecksum) return { action: "skip", reason: "Unchanged" };
  if (mapping.lastOutboundChecksum && normalized.checksum === mapping.lastOutboundChecksum) return { action: "skip", reason: "Echo of a CRM change we sent" };
  const current = crmFields(entityType, crmRecord);
  const crmChanged = current && mapping.lastInboundChecksum && checksum(current) !== mapping.lastInboundChecksum && checksum(current) !== mapping.lastOutboundChecksum;
  if (crmChanged) return { action: "conflict", crmValues: current };
  return { action: "update" };
}

function capabilityOf(provider, key) {
  const cap = (provider.capabilities || []).find((c) => c.key === key);
  if (!cap) throw new IntegrationError(KINDS.PERMANENT, "Unknown capability for this provider.");
  if (cap.requiresPhase) throw new IntegrationError(KINDS.UNSUPPORTED, cap.unavailableReason);
  return cap;
}

async function readPage(adapter, connection, config, { cursor, deltaToken, limit }) {
  if (!adapter.supports("pullChanges")) throw new IntegrationError(KINDS.UNSUPPORTED, "This provider adapter can't read changes yet — only the simulator can in this phase for this capability.");
  const token = await accessTokenFor(connection);
  return adapter.pullChanges({ accessToken: token, entityType: config.entityType, cursor, deltaToken, limit, filters: config.filters || {}, tenantId: connection.externalTenantId || null });
}

const summary = (n, extra = {}) => ({ externalId: n.externalId, title: n.fields.title || n.fields.description || n.externalId, ...extra });

// ---- Preview ------------------------------------------------------------------

export async function createPreview(req, connection, config) {
  assertCallable(connection);
  const provider = await prisma.integrationProvider.findUnique({ where: { key: connection.providerKey } });
  const cap = capabilityOf(provider, config.capability);
  const missing = (cap.requiredScopes || []).filter((s) => !(connection.grantedScopes || []).includes(s));
  if (missing.length) throw new IntegrationError(KINDS.SCOPE_MISSING, `Missing scopes for this capability: ${missing.join(", ")}. Reauthorize to add them.`);
  const adapter = getAdapter(connection.providerKey, connection.mode);
  const checkpoint = await prisma.integrationSyncCheckpoint.findUnique({ where: { syncConfigurationId: config.id } });
  const fromScratch = !checkpoint?.cursor || !!checkpoint?.expiredAt;
  const policy = await getPolicy(connection.organizationId);

  const plan = { create: [], update: [], skip: [], conflict: [], tombstone: [] };
  let cursor = null;
  let apiCalls = 0;
  let deltaToken = fromScratch ? null : checkpoint.cursor;
  let sampled = 0;
  try {
    while (sampled < PREVIEW_LIMIT) {
      const page = await readPage(adapter, connection, config, { cursor, deltaToken, limit: Math.min(10, PREVIEW_LIMIT - sampled) });
      apiCalls += 1;
      for (const raw of page.items || []) {
        const n = normalize(connection.providerKey, connection.mode, config.entityType, raw);
        if (n.skip || raw.category === "security") { plan.skip.push(summary(n, { reason: "Not imported (pull request, or an authentication/security message)" })); continue; }
        const mapping = await prisma.integrationRecordMapping.findUnique({ where: { connectionId_providerEntityType_externalId: { connectionId: connection.id, providerEntityType: config.entityType, externalId: n.externalId } } });
        const crmRecord = mapping ? await loadCrmRecord(prisma, config.entityType, mapping.crmRecordId) : null;
        const c = classify({ normalized: n, mapping, crmRecord, entityType: config.entityType });
        plan[c.action === "tombstone" ? "tombstone" : c.action].push(summary(n, c.reason ? { reason: c.reason } : {}));
        sampled += 1;
      }
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
      deltaToken = null;
    }
    await recordOutcome(connection);
  } catch (err) {
    if (err instanceof IntegrationError) await recordOutcome(connection, err);
    throw err;
  }

  const preview = {
    sampleLimit: PREVIEW_LIMIT, sampled, fromScratch, counts: Object.fromEntries(Object.entries(plan).map(([k, v]) => [k, v.length])),
    // Titles and ids only — no bodies or personal data beyond what identifies the record.
    records: Object.fromEntries(Object.entries(plan).map(([k, v]) => [k, v.slice(0, 50)])),
    restrictedFieldsExcluded: restrictedFields(policy), unmappedProviderFields: "Provider fields outside the mapping are not imported.",
    estimatedApiUsage: { previewCalls: apiCalls, fullRun: `about 1 call per ${PAGE_SIZE} records` },
    direction: config.direction, deletionPolicy: config.deletionPolicy, conflictPolicy: config.conflictPolicy,
    notes: ["Nothing has been written.", "Provider deletions never delete CRM records.", config.direction === "Import Only" ? "Nothing is sent to the provider." : "Changes to CRM records will be sent to the provider after confirmation."],
  };
  const run = await prisma.integrationSyncRun.create({
    data: {
      organizationId: connection.organizationId, connectionId: connection.id, syncConfigurationId: config.id, capability: config.capability, kind: "Preview", trigger: "Manual", direction: config.direction,
      status: "Awaiting Confirmation", startedAt: new Date(), completedAt: new Date(), discovered: sampled, apiCalls, preview, previewExpiresAt: new Date(Date.now() + PREVIEW_TTL_MS),
      checkpointBefore: checkpoint?.cursor || null, initiatedByMembershipId: req.membership?.id || null, correlationId: correlation(),
    },
  });
  await day(connection, { apiCalls });
  return run;
}

// ---- Runs -----------------------------------------------------------------------

export async function queueSyncRun({ connection, config, membershipId = null, trigger = "Manual", previewRun = null }) {
  const run = await prisma.integrationSyncRun.create({
    data: {
      organizationId: connection.organizationId, connectionId: connection.id, syncConfigurationId: config.id, capability: config.capability, kind: "Sync", trigger, direction: config.direction,
      status: "Queued", initiatedByMembershipId: membershipId, correlationId: previewRun?.correlationId || correlation(),
    },
  });
  await enqueueTask({ organizationId: connection.organizationId, connectionId: connection.id, kind: "sync", refId: run.id, dedupeKey: `sync:${run.id}` });
  return run;
}

async function processRecord(tx, { connection, config, run, normalized, providerKey, counts }) {
  const key = { connectionId: connection.id, providerEntityType: config.entityType, externalId: normalized.externalId };
  const mapping = await tx.integrationRecordMapping.findUnique({ where: { connectionId_providerEntityType_externalId: key } });
  const crmRecord = mapping ? await loadCrmRecord(tx, config.entityType, mapping.crmRecordId) : null;
  const c = classify({ normalized, mapping, crmRecord, entityType: config.entityType });
  const now = new Date();
  if (c.action === "skip") { counts.skipped += 1; return; }
  if (c.action === "tombstone") {
    // Never a hard delete: the mapping is marked and the CRM record stays.
    await tx.integrationRecordMapping.update({ where: { id: mapping.id }, data: { syncState: "Tombstoned", externalVersion: normalized.externalVersion, lastSyncedAt: now } });
    counts.skipped += 1;
    counts.warnings.push(`${normalized.externalId} was deleted at the provider; the CRM record was kept.`);
    return;
  }
  if (c.action === "conflict") {
    const policy = await getPolicy(connection.organizationId, tx);
    const restricted = new Set(restrictedFields(policy).map((f) => f.toLowerCase()));
    const fields = Object.keys(normalized.fields).filter((f) => JSON.stringify(normalized.fields[f]) !== JSON.stringify(c.crmValues[f]));
    const redact = (vals) => Object.fromEntries(Object.entries(vals).map(([k, v]) => [k, restricted.has(k.toLowerCase()) ? "[restricted]" : v]));
    if (config.conflictPolicy === "Keep CRM") { await tx.integrationRecordMapping.update({ where: { id: mapping.id }, data: { lastInboundChecksum: normalized.checksum, externalVersion: normalized.externalVersion, lastSyncedAt: now } }); counts.skipped += 1; return; }
    const open = await tx.integrationConflict.findFirst({ where: { mappingId: mapping.id, status: "Open" } });
    if (!open) {
      await tx.integrationConflict.create({
        data: {
          organizationId: connection.organizationId, connectionId: connection.id, mappingId: mapping.id, entityType: config.entityType, crmRecordId: mapping.crmRecordId, externalId: normalized.externalId,
          fields, crmValues: redact(c.crmValues), providerValues: redact(normalized.fields), restrictedFields: fields.filter((f) => restricted.has(f.toLowerCase())),
          snapshotExpiresAt: new Date(Date.now() + 90 * 86_400_000),
        },
      });
    }
    await tx.integrationRecordMapping.update({ where: { id: mapping.id }, data: { syncState: "Conflict" } });
    counts.conflicts += 1;
    return;
  }
  const record = await applyToCrm(tx, { entityType: config.entityType, connection, config, run, normalized, existingId: mapping?.crmRecordId || null, providerKey });
  if (mapping) {
    await tx.integrationRecordMapping.update({ where: { id: mapping.id }, data: { lastInboundChecksum: normalized.checksum, externalVersion: normalized.externalVersion, lastSyncedAt: now, syncState: "Active", lastWriteOrigin: "Provider" } });
    counts.updated += 1;
  } else {
    await tx.integrationRecordMapping.create({ data: { organizationId: connection.organizationId, ...key, externalVersion: normalized.externalVersion, crmEntityType: config.entityType, crmRecordId: record.id, lastInboundChecksum: normalized.checksum, lastSyncedAt: now, lastWriteOrigin: "Provider" } });
    counts.created += 1;
  }
}

// Two-way / export: CRM-side edits sent to the provider, after egress filtering.
async function exportChanges({ adapter, connection, config, run, counts }) {
  if (config.direction === "Import Only") return;
  if (!adapter.supports("pushChanges")) { counts.warnings.push("This provider adapter can't send changes; the export step was skipped."); return; }
  const policy = await getPolicy(connection.organizationId);
  const mappings = await prisma.integrationRecordMapping.findMany({ where: { connectionId: connection.id, providerEntityType: config.entityType, syncState: "Active" }, take: 200 });
  for (const m of mappings) {
    const crm = crmFields(config.entityType, await loadCrmRecord(prisma, config.entityType, m.crmRecordId));
    if (!crm) continue;
    const sum = checksum(crm);
    if (sum === m.lastInboundChecksum || sum === m.lastOutboundChecksum) continue; // nothing new from the CRM side
    const { payload, removedFields } = filterOutbound(crm, policy, { providerKey: connection.providerKey });
    const token = await accessTokenFor(connection);
    await adapter.pushChanges({ accessToken: token, entityType: config.entityType, externalId: m.externalId, fields: payload, idempotencyKey: `${run.id}:${m.id}:${sum}` });
    await prisma.integrationRecordMapping.update({ where: { id: m.id }, data: { lastOutboundChecksum: sum, lastWriteOrigin: "CRM", lastSyncedAt: new Date() } });
    counts.exported += 1;
    if (removedFields.length) counts.warnings.push(`Restricted fields withheld from ${m.externalId}: ${removedFields.join(", ")}`);
  }
}

export async function executeRun(runId) {
  let run = await prisma.integrationSyncRun.findUnique({ where: { id: runId } });
  if (!run || ["Cancelled", "Completed", "Completed with Warnings"].includes(run.status)) return;
  const connection = await prisma.integrationConnection.findUnique({ where: { id: run.connectionId } });
  const config = await prisma.integrationSyncConfiguration.findUnique({ where: { id: run.syncConfigurationId } });
  if (!config?.enabled) { await prisma.integrationSyncRun.update({ where: { id: run.id }, data: { status: "Cancelled", completedAt: new Date(), errorCode: "configuration_disabled", errorMessage: "The sync configuration is disabled." } }); return; }
  if (connection.pausedAt) { await prisma.integrationSyncRun.update({ where: { id: run.id }, data: { status: "Paused", errorMessage: "The connection is paused." } }); return; }
  const adapter = getAdapter(connection.providerKey, connection.mode);
  const checkpoint = await prisma.integrationSyncCheckpoint.upsert({
    where: { syncConfigurationId: config.id },
    create: { organizationId: connection.organizationId, connectionId: connection.id, syncConfigurationId: config.id, capability: config.capability, entityType: config.entityType },
    update: {},
  });
  if (checkpoint.expiredAt) throw new IntegrationError(KINDS.PERMANENT, "The provider's change token expired. Run a new sync preview — a full resync is never started automatically.");
  run = await prisma.integrationSyncRun.update({ where: { id: run.id }, data: { status: "Running", startedAt: run.startedAt || new Date(), checkpointBefore: checkpoint.cursor } });
  const counts = { created: 0, updated: 0, skipped: 0, conflicts: 0, failures: 0, discovered: 0, exported: 0, apiCalls: 0, warnings: [] };
  let cursor = null;
  let deltaToken = checkpoint.cursor || null;
  let finalToken = null;
  try {
    assertCallable(connection);
    for (let page = 0; page < MAX_PAGES_PER_RUN; page += 1) {
      const fresh = await prisma.integrationSyncRun.findUnique({ where: { id: run.id }, select: { status: true } });
      if (fresh.status === "Cancelled") return; // cancelled between pages; checkpoint untouched
      const result = await readPage(adapter, connection, config, { cursor, deltaToken, limit: PAGE_SIZE });
      counts.apiCalls += 1;
      const items = result.items || [];
      counts.discovered += items.length;
      await prisma.$transaction(async (tx) => {
        for (const raw of items) {
          const n = normalize(connection.providerKey, connection.mode, config.entityType, raw);
          if (n.skip || raw.category === "security") { counts.skipped += 1; continue; }
          await processRecord(tx, { connection, config, run, normalized: n, providerKey: connection.providerKey, counts });
        }
      }, { timeout: 60_000 });
      if (!result.nextCursor) { finalToken = result.deltaToken || null; break; }
      cursor = result.nextCursor;
      deltaToken = null;
    }
    await exportChanges({ adapter, connection, config, run, counts });
    // Only now, after every page committed, does the checkpoint advance.
    if (finalToken) {
      await prisma.integrationSyncCheckpoint.update({ where: { id: checkpoint.id }, data: { cursor: finalToken, lastSuccessAt: new Date(), checkpointVersion: { increment: 1 }, expiredAt: null } });
    }
    const status = counts.conflicts || counts.warnings.length ? "Completed with Warnings" : "Completed";
    await prisma.integrationSyncRun.update({
      where: { id: run.id },
      data: { status, completedAt: new Date(), discovered: counts.discovered, created: counts.created, updated: counts.updated, skipped: counts.skipped, conflicts: counts.conflicts, failures: counts.failures, apiCalls: counts.apiCalls, checkpointAfter: finalToken, rateLimitState: counts.warnings.length ? { warnings: counts.warnings.slice(0, 20) } : null },
    });
    if (!config.initialSyncCompletedAt) await prisma.integrationSyncConfiguration.update({ where: { id: config.id }, data: { initialSyncCompletedAt: new Date() } });
    await prisma.integrationConnection.update({ where: { id: connection.id }, data: { lastSuccessfulSyncAt: new Date() } });
    await recordOutcome(connection);
    await day(connection, { apiCalls: counts.apiCalls, recordsIn: counts.created + counts.updated, recordsOut: counts.exported });
    await integrationAudit(null, "integrations.sync.completed", "IntegrationSyncRun", run.id, { organizationId: connection.organizationId, after: { capability: config.capability, status, created: counts.created, updated: counts.updated, conflicts: counts.conflicts, sent: counts.exported } });
    await integrationLog({ organizationId: connection.organizationId, connectionId: connection.id, event: "sync.completed", message: `${config.capability}: ${counts.created} created, ${counts.updated} updated, ${counts.skipped} skipped, ${counts.conflicts} conflicts, ${counts.exported} sent.`, correlationId: run.correlationId });
  } catch (err) {
    const e = err instanceof IntegrationError ? err : new IntegrationError(KINDS.TRANSIENT, "The sync failed unexpectedly.");
    const expired = e.status === 410 || /sync_token_expired|expired/.test(String(e.providerCode || ""));
    if (expired) await prisma.integrationSyncCheckpoint.update({ where: { id: checkpoint.id }, data: { expiredAt: new Date() } });
    await prisma.integrationSyncRun.update({
      where: { id: run.id },
      data: {
        status: e.kind === KINDS.RATE_LIMITED ? "Rate Limited" : "Failed", completedAt: e.kind === KINDS.RATE_LIMITED ? null : new Date(), apiCalls: counts.apiCalls,
        created: counts.created, updated: counts.updated, skipped: counts.skipped, conflicts: counts.conflicts, discovered: counts.discovered,
        errorCode: expired ? "cursor_expired" : e.kind, errorMessage: expired ? "The provider's change token expired. Run a new sync preview — nothing destructive was started." : e.message,
        rateLimitState: e.kind === KINDS.RATE_LIMITED ? { retryAfterSeconds: Math.ceil((e.retryAfterMs || 60_000) / 1000) } : null,
      },
    });
    await prisma.integrationConnection.update({ where: { id: connection.id }, data: { lastFailedSyncAt: new Date() } });
    await recordOutcome(connection, e);
    await day(connection, { apiCalls: counts.apiCalls, errors: 1, rateLimitHits: e.kind === KINDS.RATE_LIMITED ? 1 : 0 });
    await integrationAudit(null, "integrations.sync.failed", "IntegrationSyncRun", run.id, { organizationId: connection.organizationId, result: "Failure", reason: `${config.capability}: ${e.message}` });
    await integrationLog({ organizationId: connection.organizationId, connectionId: connection.id, level: "error", event: "sync.failed", message: `${config.capability}: ${e.message}`, correlationId: run.correlationId });
    if (expired) throw new IntegrationError(KINDS.PERMANENT, e.message);
    throw e;
  }
}

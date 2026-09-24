// Backend-mode data source for the core Integration Center pages
// (VITE_BACKEND_INTEGRATIONS_MODE=true): providers, connections, connect
// (OAuth), test, pause/resume, disconnect, synchronization (preview →
// confirm), activity and webhooks. The pages were built against the mock
// layer's shapes, so this maps the backend's records onto them. Descriptive
// text a provider has in the mock catalog is reused; everything about
// connections, runs and events comes only from the backend. A connection in
// Simulator mode carries the simulator label — it is never presented as a
// real provider. Nothing here falls back to mock data.
import * as api from "./backendIntegrationsClient";
import { orgId, fetchCrmOwners } from "./crmBackendCommon";
import { findProvider as findMockProvider } from "./mockIntegrationsData";
import { listOrganizations as listBackendOrganizations } from "./backendAuthClient";

export const BACKEND_ENABLED = api.BACKEND_INTEGRATIONS_MODE_ENABLED;

export class IntegrationBackendUnavailable extends Error {}
export const unavailable = (what) => new IntegrationBackendUnavailable(`${what} isn't connected to the backend yet — Backend Phase 8 covers providers, connections, synchronization, activity and webhooks.`);

const DIRECTION = { "Import Only": "read", "Export Only": "write", "Two Way": "both" };
const title = (s) => String(s || "").replace(/(^|[_\s])(\w)/g, (_m, p, c) => `${p ? " " : ""}${c.toUpperCase()}`).trim();
const future = (d) => d && new Date(d) > new Date();

export const PAUSED_STATUSES = ["Preview Paused", "Sync Paused"];
export const DISCONNECTED_STATUSES = ["Preview Disconnected", "Disconnected", "Revoked"];
export const isPausedStatus = (s) => PAUSED_STATUSES.includes(s);
export const isDisconnectedStatus = (s) => DISCONNECTED_STATUSES.includes(s);

// The active organization only — every call here is scoped to it.
export async function listOrganizations() {
  const id = orgId();
  const { organizations = [] } = await listBackendOrganizations();
  const active = organizations.find((o) => o._id === id);
  return { organizations: [{ id, name: active?.name || "Your organization" }] };
}

// ---- Providers -------------------------------------------------------------------

export function toUiCapability(c) {
  return {
    id: c.key, key: c.key, name: c.name, crmModule: title(c.crmModule), direction: DIRECTION[c.direction] || "read", syncDirection: c.direction,
    entityType: c.entityType,
    requiredPermission: (c.requiredScopes || []).join(", ") || "No extra provider scope",
    sensitiveData: !!(c.financeReadOnly || /gmail|outlook|email/.test(c.key)),
    requiresHumanApproval: !!(c.requiresConfirmation || c.explicitSelection),
    unavailableReason: c.requiresPhase ? c.unavailableReason : null,
    description: c.requiresPhase ? c.unavailableReason : undefined,
  };
}

export function toUiProvider(p) {
  const mock = findMockProvider(p.key) || {};
  const capabilities = (p.capabilities || []).map(toUiCapability);
  const imports = capabilities.filter((c) => c.direction !== "write" && !c.unavailableReason).map((c) => c.name);
  const exports = capabilities.filter((c) => c.direction !== "read" && !c.unavailableReason).map((c) => c.name);
  return {
    ...mock,
    key: p.key, name: p.name, category: p.category || mock.category, icon: mock.icon || p.icon,
    shortDescription: p.description || mock.shortDescription || "",
    longDescription: [p.description, p.availabilityReason].filter(Boolean).join(" ") || mock.longDescription || "",
    authMethod: p.authType === "OAuth2" ? "OAuth 2.0" : p.authType === "ApiKey" ? "API Key" : p.authType || mock.authMethod,
    pricingClassification: mock.pricingClassification || "Provider Plan Dependent",
    supportedModules: [...new Set(capabilities.map((c) => c.crmModule))],
    capabilities,
    dataLeavingCrm: exports.length ? exports : ["Nothing — this provider is import-only here."],
    dataEnteringCrm: imports.length ? imports : ["Nothing is imported."],
    knownLimitations: [p.availabilityReason, ...capabilities.filter((c) => c.unavailableReason).map((c) => `${c.name}: ${c.unavailableReason}`)].filter(Boolean),
    securityNotes: ["Provider tokens are encrypted on the server and never sent to the browser.", "Only the scopes the chosen capabilities need are requested."],
    availability: p.availability, availabilityReason: p.availabilityReason, connectionStatus: p.connectionStatus || null, statusMessage: p.statusMessage || null,
    ownershipTypes: p.ownershipTypes || [], docsUrl: p.docsUrl, mode: p.mode, simulatorLabel: p.simulatorLabel || null,
    backend: true,
  };
}

export async function listProviders(filters = {}) {
  const params = {};
  if (filters.category) params.category = filters.category;
  const data = await api.listProviders(orgId(), params);
  let providers = (data.providers || []).map(toUiProvider);
  const search = (filters.search || "").trim().toLowerCase();
  if (search) providers = providers.filter((p) => p.name.toLowerCase().includes(search) || p.shortDescription.toLowerCase().includes(search));
  if (filters.authMethod) providers = providers.filter((p) => p.authMethod === filters.authMethod);
  if (filters.module) providers = providers.filter((p) => p.supportedModules.includes(filters.module));
  providers.sort((a, b) => (filters.sort === "name_desc" ? b.name.localeCompare(a.name) : a.name.localeCompare(b.name)));
  return { providers, counts: { total: providers.length }, mode: data.mode, simulatorLabel: data.simulatorLabel || null };
}

export async function getProvider(key) {
  const { provider } = await api.getProvider(orgId(), key);
  return { provider: toUiProvider(provider) };
}

// ---- Runs → "sync jobs" ------------------------------------------------------------

export function toUiJob(r) {
  const started = r.startedAt || r.createdAt;
  return {
    id: r._id, connectionId: r.connectionPublicId || r.connectionId, kind: r.kind,
    jobType: r.kind === "Preview" ? "Sync Preview" : `${r.trigger} Sync`,
    status: r.status, capability: r.capability,
    result: {
      id: r._id, jobType: r.kind, recordsExamined: r.discovered, created: r.created, updated: r.updated, skipped: r.skipped,
      conflicted: r.conflicts, failed: r.failures, startedDate: started, completedDate: r.completedAt,
      durationMs: r.completedAt && started ? Math.max(0, new Date(r.completedAt) - new Date(started)) : null,
      triggeredBy: r.trigger,
    },
    preview: r.kind === "Preview" ? r.preview || null : null,
    previewExpiresAt: r.previewExpiresAt || null,
    errorMessage: r.errorMessage || null,
    label: r.kind === "Preview" ? "Synchronization preview (nothing written)" : "Synchronization",
  };
}

// ---- Connections ---------------------------------------------------------------------

function healthOf(c) {
  const issues = [];
  if (c.lastError?.message) issues.push(c.lastError.message);
  if (c.reauthorizationRequiredAt) issues.push("Reauthorization required.");
  if (future(c.rateLimitedUntil)) issues.push(`Rate limited by the provider until ${new Date(c.rateLimitedUntil).toLocaleTimeString()}.`);
  if (future(c.circuitOpenUntil)) issues.push("Calls are paused after repeated failures (circuit breaker).");
  const healthy = ["Connected", "Sync Paused"].includes(c.status) && issues.length === 0;
  return { status: healthy ? "Healthy" : "Attention Required", lastCheckedAt: c.lastVerifiedAt, issues: [...new Set(issues)] };
}

export function toUiConnection(c, { runs = [], configs = [] } = {}) {
  const available = (c.scopes?.capabilities || []).filter((x) => x.state === "Available").map((x) => x.key);
  const first = configs[0];
  return {
    id: c.publicId, publicId: c.publicId, providerKey: c.providerKey, organizationId: orgId(), name: c.name,
    status: c.status,
    connectedByName: c.externalAccountLabel || c.ownershipType,
    createdDate: c.connectedAt || c.createdAt,
    capabilities: available,
    dataScope: c.ownershipType,
    syncConfiguration: {
      direction: first?.direction || "Import Only", entityMappings: [],
      scheduleFrequency: first?.scheduleMinutes ? `Every ${first.scheduleMinutes} minutes` : "Manual",
      notifyOnFailure: true, notifyOnSuccess: false,
    },
    fieldMappings: [],
    notificationPreferences: { onFailure: true, onSuccess: false },
    lastSyncedAt: c.lastSuccessfulSyncAt,
    health: healthOf(c),
    recentErrors: c.lastError ? [{ id: `${c.publicId}-last-error`, occurredAt: c.lastFailedSyncAt || c.updatedAt, code: c.lastError.code, message: c.lastError.message, retryEligible: false, resolved: false }] : [],
    syncJobs: runs.filter((r) => r.kind === "Sync" || r.kind === "Preview").map(toUiJob),
    pausedDate: c.pausedAt, disconnectedDate: c.disconnectedAt, disconnectReason: null,
    isPreview: false,
    mode: c.mode, simulatorLabel: c.simulatorLabel || null,
    previewLabel: c.simulatorLabel || null, previewExplanation: c.simulatorLabel || null,
    ownershipType: c.ownershipType, externalAccountLabel: c.externalAccountLabel,
    grantedScopes: c.grantedScopes || [], scopes: c.scopes || null,
    reauthorizationRequired: !!c.reauthorizationRequiredAt,
    syncConfigurations: configs.map((k) => ({ id: k._id, capability: k.capability, entityType: k.entityType, direction: k.direction, enabled: k.enabled, conflictPolicy: k.conflictPolicy, deletionPolicy: k.deletionPolicy, scheduleMinutes: k.scheduleMinutes, filters: k.filters || {}, initialSyncCompletedAt: k.initialSyncCompletedAt, checkpoint: k.checkpoint, version: k.version })),
    backend: true,
  };
}

const isToday = (iso) => iso && new Date(iso).toDateString() === new Date().toDateString();

export async function listConnections(filters = {}) {
  const org = orgId();
  const params = {};
  if (filters.providerKey) params.providerKey = filters.providerKey;
  const [{ connections }, { syncRuns }] = await Promise.all([api.listConnections(org, params), api.listSyncRuns(org, { limit: 200 })]);
  const byConn = new Map();
  for (const r of syncRuns || []) byConn.set(r.connectionPublicId, [...(byConn.get(r.connectionPublicId) || []), r]);
  let list = (connections || []).map((c) => toUiConnection(c, { runs: byConn.get(c.publicId) || [] }));
  if (filters.status) list = list.filter((c) => c.status === filters.status);
  const jobsToday = list.flatMap((c) => c.syncJobs).filter((j) => j.kind === "Sync" && isToday(j.result.completedDate || j.result.startedDate));
  const counts = {
    availableProviders: null,
    previewConnections: list.filter((c) => ["Connected", "Connected with Warnings"].includes(c.status)).length,
    attentionRequired: list.filter((c) => c.health.status !== "Healthy").length,
    syncsToday: jobsToday.length,
    failedSyncsToday: jobsToday.filter((j) => j.status === "Failed").length,
    providersNotConfigured: null,
  };
  return { connections: list, counts };
}

export async function getConnection(id) {
  const org = orgId();
  const [{ connection }, { syncRuns }, configs] = await Promise.all([
    api.getConnection(org, id),
    api.listSyncRuns(org, { connectionId: id, limit: 50 }),
    api.listSyncConfigurations(org, id).then((d) => d.syncConfigurations || []).catch(() => []),
  ]);
  return { connection: toUiConnection(connection, { runs: syncRuns || [], configs }) };
}

// Choose the ownership the wizard's data scope stands for, within what the provider allows.
export function ownershipFor(provider, dataScope) {
  const types = provider?.ownershipTypes || [];
  if (dataScope === "Organization" && types.includes("Organization Connection")) return "Organization Connection";
  if (types.includes("User Connection")) return "User Connection";
  return types[0] || "Organization Connection";
}

// Starts the provider's OAuth flow; the caller sends the browser to
// `authorizationUrl`. API-key providers are refused here with a clear message.
export async function connect({ providerKey, capabilities = [], dataScope }) {
  const { provider } = await api.getProvider(orgId(), providerKey);
  if (provider.availability !== "Adapter") throw new Error(provider.availabilityReason || `${provider.name} can't be connected.`);
  if (provider.authType !== "OAuth2") throw new Error(`${provider.name} connects with an API key, which isn't supported from this screen yet.`);
  const out = await api.startOAuth(orgId(), providerKey, { ownershipType: ownershipFor(provider, dataScope), capabilityKeys: capabilities, returnTo: "connection" });
  return { connection: toUiConnection(out.connection), authorizationUrl: out.authorizationUrl, simulatorLabel: provider.simulatorLabel || null };
}

export async function testConnection(id) {
  await api.testConnection(orgId(), id);
  return getConnection(id);
}

export async function pause(id) {
  await api.pauseConnection(orgId(), id);
  return getConnection(id);
}

export async function resume(id) {
  await api.resumeConnection(orgId(), id);
  return getConnection(id);
}

export async function disconnect(id, reason) {
  const out = await api.disconnectConnection(orgId(), id, reason);
  const { connection } = await getConnection(id);
  return { connection, note: out.note || null };
}

// "Run synchronization": a preview for every enabled-or-new configuration
// that still needs one, an incremental run for those past their initial
// sync. Nothing is written until a preview is confirmed.
export async function runSync(id) {
  const org = orgId();
  const configs = (await api.listSyncConfigurations(org, id)).syncConfigurations || [];
  if (!configs.length) throw new Error("Set up synchronization for a capability first (Synchronization setup below).");
  const results = [];
  for (const k of configs) {
    if (k.initialSyncCompletedAt && !k.checkpoint?.expired) results.push(await api.runIncrementalSync(org, id, k._id));
    else results.push(await api.createSyncPreview(org, id, k._id));
  }
  const { connection } = await getConnection(id);
  return { connection, results };
}

export async function confirmPreview(id, previewRunId) {
  await api.confirmSyncPreview(orgId(), id, previewRunId);
  return getConnection(id);
}

export async function saveSyncConfiguration(id, body) {
  await api.saveSyncConfiguration(orgId(), id, body);
  return getConnection(id);
}

export async function cancelRun(id, runId) {
  await api.cancelSyncRun(orgId(), runId);
  return getConnection(id);
}

export async function reauthorize(id, capabilityKeys) {
  return api.reauthorize(orgId(), id, capabilityKeys);
}

// ---- Activity and webhooks -------------------------------------------------------------

const EVENT_LABELS = {
  "integrations.connection.created": "Connection created", "integrations.connection.connected": "Connected",
  "integrations.connection.verified": "Connection tested", "integrations.connection.verification_failed": "Connection test failed",
  "integrations.connection.paused": "Paused", "integrations.connection.resumed": "Resumed", "integrations.connection.disconnected": "Disconnected",
  "integrations.sync.preview_created": "Sync preview created", "integrations.sync.started": "Sync started", "integrations.sync.completed": "Sync completed",
  "integrations.sync.failed": "Sync failed", "integrations.sync.cancelled": "Sync cancelled", "integrations.conflict.resolved": "Conflict resolved",
  "integrations.action.previewed": "Action prepared", "integrations.action.executed": "Action carried out", "integrations.action.failed": "Action failed",
};
const eventLabel = (action) => EVENT_LABELS[action] || title(String(action).replace(/^integrations\./, "").replace(/\./g, " "));

export async function listActivity(filters = {}) {
  const params = { limit: 200 };
  if (filters.connectionId) params.connectionId = filters.connectionId;
  const [{ auditEvents }, owners] = await Promise.all([api.listAudit(orgId(), params), fetchCrmOwners()]);
  const names = new Map(owners.map((o) => [o.id, o.name]));
  const events = (auditEvents || []).map((e) => ({
    id: e._id, occurredAt: e.createdAt, actor: e.actorMembershipId ? names.get(e.actorMembershipId) || "Member" : "System",
    organizationId: orgId(), providerKey: e.after?.providerKey || null, connectionId: filters.connectionId || null,
    event: eventLabel(e.action), action: e.action, details: e.reason || null, source: "Integration Center",
    result: e.result, recordsAffected: e.after?.counts ? Object.values(e.after.counts).reduce((a, b) => a + (Number(b) || 0), 0) : null,
    durationMs: null, correlationId: e._id, retryEligible: false,
  }));
  return { events: filters.providerKey ? events.filter((e) => e.providerKey === filters.providerKey) : events };
}

export async function listWebhooks() {
  const org = orgId();
  const [{ subscriptions = [], events = [] }, outbound] = await Promise.all([
    api.listWebhooks(org),
    api.listOutboundWebhooks(org).catch(() => ({ endpoints: [], deliveries: [] })), // needs integration_outbound_webhooks:view
  ]);
  const inbound = subscriptions.map((s) => {
    const mine = events.filter((e) => e.providerKey === s.providerKey);
    return {
      id: s._id, providerKey: s.providerKey, connectionId: s.connectionId, organizationId: org, eventName: s.capability,
      status: s.status, endpointLabel: s.callbackUrl, lastEventAt: mine[0]?.receivedAt || null,
      retryPolicy: "Verified signature and replay check; processed with retries and backoff",
      failureCount: mine.filter((e) => !e.signatureValid || e.processingStatus === "Failed").length,
      signatureVerificationRequired: true, direction: "Inbound",
    };
  });
  const out = (outbound.endpoints || []).map((e) => {
    const deliveries = (outbound.deliveries || []).filter((d) => d.endpointId === e._id);
    return {
      id: e._id, providerKey: null, providerName: `Outbound: ${e.name}`, connectionId: null, organizationId: org, eventName: (e.eventTypes || []).join(", "),
      status: e.active ? "Active" : "Inactive", endpointLabel: e.url, lastEventAt: deliveries[0]?.requestedAt || null,
      retryPolicy: "HMAC-signed; exponential backoff, 6 attempts, then dead letter",
      failureCount: deliveries.filter((d) => ["Failed", "Dead Letter"].includes(d.result)).length,
      signatureVerificationRequired: true, direction: "Outbound",
    };
  });
  return { webhooks: [...inbound, ...out] };
}

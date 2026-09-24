// Backend Phase 8 — provider catalog, provider apps, connections, OAuth and
// policies. No response ever contains a decrypted credential.
import prisma from "../../lib/prisma.js";
import { toApi } from "../../utils/serialize.js";
import { hasGrant } from "../../utils/grants.js";
import { storeCredential, revokeCredentials, describeCredentials, readCredential } from "../credentials/credentialStore.js";
import { getAdapter } from "../providers/registry.js";
import { IntegrationError, KINDS, sendIntegrationError } from "../common/errors.js";
import { integrationAudit, integrationLog, scrub } from "../common/audit.js";
import { getPolicy, assertProviderAllowed, policyChanges } from "../policies/policyService.js";
import { startAuthorization, handleCallback, resultRedirect } from "../oauth/oauthService.js";
import {
  providerAppFor, currentMode, newPublicId, NOT_CONFIGURED_MESSAGE, connectionVisibilityWhere, loadConnection, canManage,
  serializeConnection, scopeSummary, setStatus, accessTokenFor, refreshConnection, recordOutcome, OWNERSHIP_TYPES,
} from "../connections/connectionService.js";
import { SIMULATOR_LABEL } from "../simulators/simulatorCore.js";

const who = (req) => req.membership?.id || null;
const text = (v, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const guard = (fn) => async (req, res, next) => {
  try {
    await fn(req, res, next);
  } catch (err) {
    if (err instanceof IntegrationError) return sendIntegrationError(res, err);
    return next(err);
  }
};
const forbidden = (res, message) => res.status(403).json({ code: "RBAC_FORBIDDEN", message });
const notFound = (res, what = "Connection") => res.status(404).json({ code: "INTEGRATION_NOT_FOUND", message: `${what} not found.` });

// ---- Catalog ----------------------------------------------------------------

async function providerStatus(organizationId, provider, mode) {
  if (provider.availability === "Blocked") return "Blocked";
  if (provider.availability !== "Adapter") return "Catalog Only";
  if (!provider.active) return "Unavailable";
  const app = await providerAppFor(organizationId, provider.key, mode);
  return app ? "Ready to Connect" : "Not Configured";
}

const serializeProvider = (p, extra = {}) => ({
  _id: p.key, key: p.key, name: p.name, category: p.category, description: p.description, icon: p.icon, apiVersion: p.apiVersion, authType: p.authType,
  ownershipTypes: p.ownershipTypes, capabilities: p.capabilities, requiredScopes: p.requiredScopes, optionalScopes: p.optionalScopes,
  webhookSupport: p.webhookSupport, incrementalSync: p.incrementalSync, sandboxSupport: p.sandboxSupport, docsUrl: p.docsUrl, statusPageUrl: p.statusPageUrl,
  dataCategories: p.dataCategories, sensitiveWarning: p.sensitiveWarning, availability: p.availability, availabilityReason: p.availabilityReason, active: p.active, adapterVersion: p.adapterVersion,
  webhookScheme: p.protocol?.webhook?.notes || null, rateLimits: p.protocol?.rateLimits || null, pkce: !!p.protocol?.pkce, unverified: p.protocol?.unverified || [],
  ...extra,
});

export const listProviders = guard(async (req, res) => {
  const where = {};
  if (req.query.category) where.category = req.query.category;
  if (req.query.availability) where.availability = req.query.availability;
  const providers = await prisma.integrationProvider.findMany({ where, orderBy: [{ availability: "asc" }, { name: "asc" }] });
  const mode = currentMode();
  const counts = await prisma.integrationConnection.groupBy({ by: ["providerKey"], where: { organizationId: req.organizationId, ...connectionVisibilityWhere(req), status: { notIn: ["Disconnected", "Revoked"] } }, _count: { _all: true } });
  const byKey = new Map(counts.map((c) => [c.providerKey, c._count._all]));
  const out = [];
  for (const p of providers) {
    const status = await providerStatus(req.organizationId, p, mode);
    out.push(serializeProvider(p, { connectionStatus: status, statusMessage: status === "Not Configured" ? NOT_CONFIGURED_MESSAGE : null, connections: byKey.get(p.key) || 0 }));
  }
  res.json({ providers: out, mode, simulatorLabel: mode === "Simulator" ? SIMULATOR_LABEL : null });
});

export const getProvider = guard(async (req, res) => {
  const p = await prisma.integrationProvider.findUnique({ where: { key: req.params.providerKey } });
  if (!p) return notFound(res, "Provider");
  const mode = currentMode();
  const status = await providerStatus(req.organizationId, p, mode);
  return res.json({ provider: serializeProvider(p, { connectionStatus: status, statusMessage: status === "Not Configured" ? NOT_CONFIGURED_MESSAGE : null, mode, simulatorLabel: mode === "Simulator" ? SIMULATOR_LABEL : null }) });
});

// System Owner: provider availability.
export const updateProvider = guard(async (req, res) => {
  if (!req.isSystemOwnerOverride) return forbidden(res, "Only the System Owner manages provider availability.");
  const p = await prisma.integrationProvider.findUnique({ where: { key: req.params.providerKey } });
  if (!p) return notFound(res, "Provider");
  if (typeof req.body.active !== "boolean") return res.status(400).json({ code: "INTEGRATION_VALIDATION", message: "active must be true or false." });
  const updated = await prisma.integrationProvider.update({ where: { key: p.key }, data: { active: req.body.active } });
  await integrationAudit(req, "integrations.provider.availability_changed", "IntegrationProvider", p.key, { before: { active: p.active }, after: { active: updated.active } });
  return res.json({ provider: serializeProvider(updated) });
});

// ---- Provider apps (OAuth client registrations) -------------------------------

export const getProviderApp = guard(async (req, res) => {
  const system = req.query.scope === "system";
  if (system && !req.isSystemOwnerOverride) return forbidden(res, "Only the System Owner manages system provider apps.");
  const app = await prisma.integrationProviderApp.findFirst({ where: { organizationId: system ? null : req.organizationId, providerKey: req.params.providerKey } });
  if (!app) return res.json({ app: null, statusMessage: NOT_CONFIGURED_MESSAGE });
  return res.json({ app: { providerKey: app.providerKey, clientId: app.clientId, environment: app.environment, active: app.active, scope: system ? "system" : "organization", clientSecret: app.clientSecretCredentialId ? "stored (encrypted)" : "missing", credentials: await describeCredentials(prisma, { providerAppId: app.id }), version: app.version } });
});

// Registers or rotates an OAuth client. The secret is encrypted; it's never returned.
export const saveProviderApp = guard(async (req, res) => {
  const system = req.body.scope === "system";
  if (system && !req.isSystemOwnerOverride) return forbidden(res, "Only the System Owner manages system provider apps.");
  if (!system && !hasGrant(req, "integration_credentials", "rotate")) return forbidden(res, "Managing provider client credentials needs integration_credentials:rotate.");
  const provider = await prisma.integrationProvider.findUnique({ where: { key: req.params.providerKey } });
  if (!provider || provider.availability !== "Adapter") return notFound(res, "Provider");
  const clientId = text(req.body.clientId, 300);
  if (!clientId) return res.status(400).json({ code: "INTEGRATION_VALIDATION", message: "clientId is required." });
  const environment = req.body.environment === "Production" ? "Production" : "Sandbox";
  if (provider.category === "Payments" || provider.category === "Accounting") {
    if (environment !== "Sandbox") return res.status(400).json({ code: "INTEGRATION_POLICY_DENIED", message: "Finance providers are sandbox-only in Phase 8." });
  }
  const organizationId = system ? null : req.organizationId;
  const existing = await prisma.integrationProviderApp.findFirst({ where: { organizationId, providerKey: provider.key } });
  const app = existing
    ? await prisma.integrationProviderApp.update({ where: { id: existing.id }, data: { clientId, environment, settings: req.body.settings && typeof req.body.settings === "object" ? { tenant: text(req.body.settings.tenant, 80) || undefined } : existing.settings, version: { increment: 1 } } })
    : await prisma.integrationProviderApp.create({ data: { organizationId, providerKey: provider.key, clientId, environment, createdByMembershipId: who(req), settings: req.body.settings?.tenant ? { tenant: text(req.body.settings.tenant, 80) } : {} } });
  if (typeof req.body.clientSecret === "string" && req.body.clientSecret) {
    const cred = await storeCredential(prisma, { organizationId, providerAppId: app.id, credentialType: "client_secret", plaintext: req.body.clientSecret });
    await prisma.integrationProviderApp.update({ where: { id: app.id }, data: { clientSecretCredentialId: cred.id } });
    await integrationAudit(req, existing?.clientSecretCredentialId ? "integrations.credentials.client_secret_rotated" : "integrations.credentials.client_secret_stored", "IntegrationProviderApp", app.id, { after: { providerKey: provider.key, scope: system ? "system" : "organization" } });
  }
  if (typeof req.body.webhookSecret === "string" && req.body.webhookSecret) {
    const cred = await storeCredential(prisma, { organizationId, providerAppId: app.id, credentialType: "webhook_secret", plaintext: req.body.webhookSecret });
    await prisma.integrationProviderApp.update({ where: { id: app.id }, data: { webhookSecretCredentialId: cred.id } });
    await integrationAudit(req, "integrations.credentials.webhook_secret_rotated", "IntegrationProviderApp", app.id, { after: { providerKey: provider.key } });
  }
  await integrationAudit(req, "integrations.provider_app.saved", "IntegrationProviderApp", app.id, { after: { providerKey: provider.key, environment, scope: system ? "system" : "organization" } });
  return res.json({ app: { providerKey: provider.key, clientId, environment, clientSecret: "stored (encrypted)" } });
});

// ---- Connections ---------------------------------------------------------------

const serializeFull = async (req, c) => {
  const provider = await prisma.integrationProvider.findUnique({ where: { key: c.providerKey } });
  return serializeConnection(c, { provider, credentials: await describeCredentials(prisma, { connectionId: c.id }), canSeeSensitive: hasGrant(req, "integration_connections", "view_sensitive_fields") });
};

export const listConnections = guard(async (req, res) => {
  const where = { organizationId: req.organizationId, ...connectionVisibilityWhere(req) };
  for (const f of ["providerKey", "status", "ownershipType", "mode"]) if (req.query[f]) where[f] = req.query[f];
  if (req.query.includeDisconnected !== "true" && !req.query.status) where.status = { notIn: ["Disconnected", "Revoked"] };
  const rows = await prisma.integrationConnection.findMany({ where, orderBy: { createdAt: "desc" }, take: 200 });
  const canSee = hasGrant(req, "integration_connections", "view_sensitive_fields");
  res.json({ connections: rows.map((c) => serializeConnection(c, { canSeeSensitive: canSee })), mode: currentMode(), simulatorLabel: currentMode() === "Simulator" ? SIMULATOR_LABEL : null });
});

export const getConnection = guard(async (req, res) => {
  const c = await loadConnection(req, req.params.connectionId);
  if (!c) return notFound(res);
  return res.json({ connection: await serializeFull(req, c) });
});

export const getScopes = guard(async (req, res) => {
  const c = await loadConnection(req, req.params.connectionId);
  if (!c) return notFound(res);
  const provider = await prisma.integrationProvider.findUnique({ where: { key: c.providerKey } });
  return res.json({ scopes: scopeSummary(provider, c) });
});

// API-key / client-credential providers (OAuth providers use /oauth/:provider/start).
export const createConnection = guard(async (req, res) => {
  const provider = await prisma.integrationProvider.findUnique({ where: { key: req.body.providerKey } });
  if (!provider) return notFound(res, "Provider");
  if (provider.authType === "OAuth2") return res.status(400).json({ code: "INTEGRATION_USE_OAUTH", message: `${provider.name} connects through OAuth — start with POST /integrations/oauth/${provider.key}/start.` });
  const ownershipType = req.body.ownershipType;
  if (!OWNERSHIP_TYPES.includes(ownershipType)) return res.status(400).json({ code: "INTEGRATION_VALIDATION", message: `ownershipType: ${OWNERSHIP_TYPES.join(", ")}.` });
  if (!hasGrant(req, "integration_connections", ownershipType === "User Connection" ? "create_user" : "create_organization")) return forbidden(res, ownershipType === "User Connection" ? "You can't create personal connections." : "Organization and service connections need integration_connections:create_organization.");
  assertProviderAllowed(await getPolicy(req.organizationId), provider, ownershipType);
  const mode = currentMode();
  const apiKey = typeof req.body.apiKey === "string" ? req.body.apiKey.trim() : "";
  if (!apiKey && mode === "Live") return res.status(400).json({ code: "INTEGRATION_VALIDATION", message: "apiKey is required (it is encrypted and never shown again)." });
  const adapter = getAdapter(provider.key, mode);
  let granted = provider.requiredScopes || [];
  if (mode === "Live" && typeof adapter.validateApiKey === "function") granted = (await adapter.validateApiKey(apiKey))?.grantedScopes || granted;

  const connection = await prisma.integrationConnection.create({
    data: {
      publicId: newPublicId(), organizationId: req.organizationId, providerKey: provider.key, name: (text(req.body.name, 120) || provider.name), ownershipType, mode, status: "Authorization Pending",
      requestedScopes: provider.requiredScopes || [], connectedUserId: ownershipType === "User Connection" ? req.user.id : null, connectedMembershipId: ownershipType === "User Connection" ? who(req) : null, createdByMembershipId: who(req),
    },
  });
  await integrationAudit(req, "integrations.connection.created", "IntegrationConnection", connection.id, { after: { providerKey: provider.key, ownershipType, mode } });
  try {
    let token = apiKey;
    if (mode === "Simulator") {
      // The simulator issues a token through its OAuth flow for key-based providers too.
      const { simulator, SIM_CLIENT_ID, SIM_CLIENT_SECRET } = await import("../simulators/simulatorCore.js");
      const auth = simulator.authorize({ provider: provider.key, client_id: SIM_CLIENT_ID(provider.key), redirect_uri: "http://simulator.local/cb", state: "api-key", scope: granted.join(" ") });
      const code = new URL(auth.redirect).searchParams.get("code");
      token = simulator.token({ provider: provider.key, grant_type: "authorization_code", code, redirect_uri: "http://simulator.local/cb", client_id: SIM_CLIENT_ID(provider.key), client_secret: SIM_CLIENT_SECRET(provider.key) }).body.access_token;
    }
    const identity = await adapter.getConnectedIdentity({ accessToken: token });
    await storeCredential(prisma, { organizationId: req.organizationId, connectionId: connection.id, credentialType: mode === "Simulator" ? "access_token" : "api_key", plaintext: token });
    const now = new Date();
    const verified = await prisma.integrationConnection.update({
      where: { id: connection.id },
      data: { status: "Connected", grantedScopes: granted, externalAccountId: identity.externalAccountId, externalAccountLabel: identity.externalAccountLabel, externalTenantId: identity.tenantId || null, connectedAt: now, lastVerifiedAt: now, lastScopeCheckAt: now, credentialRef: "encrypted", version: { increment: 1 } },
    });
    await integrationAudit(req, "integrations.connection.verified", "IntegrationConnection", connection.id, { after: { externalAccount: identity.externalAccountLabel } });
    return res.status(201).json({ connection: await serializeFull(req, verified) });
  } catch (err) {
    await prisma.integrationConnection.update({ where: { id: connection.id }, data: { status: "Error", lastErrorCode: err.kind || "error", lastErrorMessage: err instanceof IntegrationError ? err.message : "Verification failed.", version: { increment: 1 } } });
    throw err;
  }
});

export const updateConnection = guard(async (req, res) => {
  const c = await loadConnection(req, req.params.connectionId);
  if (!c) return notFound(res);
  if (!canManage(req, c)) return forbidden(res, "You can't change this connection.");
  if (req.body.version !== undefined && Number(req.body.version) !== c.version) return res.status(409).json({ code: "INTEGRATION_VERSION_CONFLICT", message: "The connection was updated by someone else." });
  // Ownership never changes: a personal connection can't become shared.
  if ("ownershipType" in req.body && req.body.ownershipType !== c.ownershipType) return res.status(400).json({ code: "INTEGRATION_VALIDATION", message: "A connection's ownership can't change. Create a new organization connection instead." });
  const name = text(req.body.name, 120);
  if (!name) return res.status(400).json({ code: "INTEGRATION_VALIDATION", message: "name is required." });
  const updated = await setStatus(c, { name, updatedByMembershipId: who(req) });
  await integrationAudit(req, "integrations.connection.updated", "IntegrationConnection", c.id, { before: { name: c.name }, after: { name } });
  return res.json({ connection: await serializeFull(req, updated) });
});

// Calls the provider's identity endpoint and records the result.
export const testConnection = guard(async (req, res) => {
  const c = await loadConnection(req, req.params.connectionId);
  if (!c) return notFound(res);
  if (!canManage(req, c) && !hasGrant(req, "integration_connections", "edit")) return forbidden(res, "You can't test this connection.");
  if (["Disconnected", "Revoked"].includes(c.status)) return res.status(409).json({ code: "INTEGRATION_AUTH_INVALID", message: `The connection is ${c.status}.` });
  const adapter = getAdapter(c.providerKey, c.mode);
  try {
    const token = c.mode === "Live" && ["stripe", "trello", "dropbox_sign", "paypal"].includes(c.providerKey)
      ? (await readCredential(prisma, { connectionId: c.id, credentialType: "api_key" }))?.value
      : await accessTokenFor(c);
    const result = await adapter.testConnection({ accessToken: token });
    if (c.externalAccountId && result.identity?.externalAccountId && result.identity.externalAccountId !== c.externalAccountId) throw new IntegrationError(KINDS.AUTH_INVALID, "The provider returned a different account than the one connected.");
    await recordOutcome(c);
    const now = new Date();
    const fresh = await prisma.integrationConnection.findUnique({ where: { id: c.id } });
    const nextStatus = ["Reauthorization Required", "Error", "Authorization Pending"].includes(fresh.status) ? fresh.status : (fresh.status === "Rate Limited" ? "Connected" : fresh.status);
    const updated = await prisma.integrationConnection.update({ where: { id: c.id }, data: { lastVerifiedAt: now, status: nextStatus, lastErrorCode: null, lastErrorMessage: null, version: { increment: 1 } } });
    await integrationAudit(req, "integrations.connection.verified", "IntegrationConnection", c.id, { after: { result: "ok", status: updated.status } });
    return res.json({ ok: true, verifiedAt: now, connection: await serializeFull(req, updated) });
  } catch (err) {
    if (err instanceof IntegrationError) await recordOutcome(c, err);
    await integrationAudit(req, "integrations.connection.verification_failed", "IntegrationConnection", c.id, { result: "Failure", reason: err.message });
    throw err;
  }
});

export const reauthorizeConnection = guard(async (req, res) => {
  const c = await loadConnection(req, req.params.connectionId);
  if (!c) return notFound(res);
  if (!canManage(req, c)) return forbidden(res, "You can't reauthorize this connection.");
  const out = await startAuthorization(req, { providerKey: c.providerKey, connectionId: c.id, capabilityKeys: Array.isArray(req.body.capabilityKeys) ? req.body.capabilityKeys : [], returnTo: "connection" });
  await integrationAudit(req, "integrations.connection.reauthorization_started", "IntegrationConnection", c.id, { after: { requestedScopes: out.connection.requestedScopes } });
  return res.json({ authorizationUrl: out.authorizationUrl, expiresAt: out.expiresAt, connection: await serializeFull(req, out.connection) });
});

// Revokes at the provider when it supports it, then drops local credentials.
export const disconnectConnection = guard(async (req, res) => {
  const c = await loadConnection(req, req.params.connectionId);
  if (!c) return notFound(res);
  if (!canManage(req, c)) return forbidden(res, "You can't disconnect this connection.");
  if (["Disconnected", "Revoked"].includes(c.status)) return res.status(409).json({ code: "INTEGRATION_INVALID_TRANSITION", message: `Already ${c.status.toLowerCase()}.` });
  const adapter = getAdapter(c.providerKey, c.mode);
  let revokedAtProvider = false;
  if (adapter.supports("revokeCredentials")) {
    try {
      const token = (await readCredential(prisma, { connectionId: c.id, credentialType: "refresh_token" }))?.value || (await readCredential(prisma, { connectionId: c.id, credentialType: "access_token" }))?.value;
      const app = await providerAppFor(c.organizationId, c.providerKey, c.mode);
      if (token && app) { await adapter.revokeCredentials({ clientId: app.clientId, clientSecret: app.clientSecret, token }); revokedAtProvider = true; }
    } catch { /* the local credentials are dropped regardless */ }
  }
  await revokeCredentials(prisma, { connectionId: c.id });
  const now = new Date();
  const updated = await setStatus(c, { status: revokedAtProvider ? "Revoked" : "Disconnected", disconnectedAt: now, revokedAt: revokedAtProvider ? now : null, pausedAt: null, credentialRef: null, updatedByMembershipId: who(req) });
  await prisma.integrationSyncConfiguration.updateMany({ where: { connectionId: c.id }, data: { enabled: false } });
  await prisma.integrationWebhookSubscription.updateMany({ where: { connectionId: c.id, status: "Active" }, data: { status: "Deleted" } });
  await integrationAudit(req, "integrations.connection.disconnected", "IntegrationConnection", c.id, { reason: text(req.body.reason, 300) || null, after: { status: updated.status, revokedAtProvider } });
  await integrationLog({ organizationId: c.organizationId, connectionId: c.id, event: "connection.disconnected", message: revokedAtProvider ? "Disconnected and revoked at the provider." : "Disconnected; local credentials deleted (the provider has no revoke endpoint or it failed)." });
  return res.json({ connection: await serializeFull(req, updated), note: revokedAtProvider ? null : "The provider couldn't revoke the grant — remove the app's access in the provider's settings too." });
});

export const pauseConnection = guard(async (req, res) => {
  const c = await loadConnection(req, req.params.connectionId);
  if (!c) return notFound(res);
  if (!canManage(req, c)) return forbidden(res, "You can't pause this connection.");
  const updated = await setStatus(c, { pausedAt: new Date(), updatedByMembershipId: who(req) });
  await integrationAudit(req, "integrations.connection.paused", "IntegrationConnection", c.id, { reason: text(req.body.reason, 300) || null });
  return res.json({ connection: await serializeFull(req, updated) });
});

export const resumeConnection = guard(async (req, res) => {
  const c = await loadConnection(req, req.params.connectionId);
  if (!c) return notFound(res);
  if (!canManage(req, c)) return forbidden(res, "You can't resume this connection.");
  const updated = await setStatus(c, { pausedAt: null, circuitOpenUntil: null, consecutiveFailures: 0, rateLimitedUntil: null, ...(c.status === "Rate Limited" && { status: "Connected" }), updatedByMembershipId: who(req) });
  await integrationAudit(req, "integrations.connection.resumed", "IntegrationConnection", c.id);
  return res.json({ connection: await serializeFull(req, updated) });
});

// Forces a token refresh now (refresh-token replacement included).
export const rotateConnectionCredentials = guard(async (req, res) => {
  const c = await loadConnection(req, req.params.connectionId);
  if (!c) return notFound(res);
  if (!hasGrant(req, "integration_credentials", "rotate") && !canManage(req, c)) return forbidden(res, "Rotating credentials needs integration_credentials:rotate.");
  await refreshConnection(c);
  await integrationAudit(req, "integrations.credentials.rotated", "IntegrationConnection", c.id, { after: { refreshed: true } });
  return res.json({ connection: await serializeFull(req, await prisma.integrationConnection.findUnique({ where: { id: c.id } })) });
});

// ---- OAuth ---------------------------------------------------------------------

export const oauthStart = guard(async (req, res) => {
  const ownershipType = req.body.ownershipType || "User Connection";
  if (!OWNERSHIP_TYPES.includes(ownershipType)) return res.status(400).json({ code: "INTEGRATION_VALIDATION", message: `ownershipType: ${OWNERSHIP_TYPES.join(", ")}.` });
  const needed = ownershipType === "User Connection" ? "create_user" : "create_organization";
  if (!hasGrant(req, "integration_connections", needed)) return forbidden(res, ownershipType === "User Connection" ? "You can't create personal connections." : "Organization connections need integration_connections:create_organization.");
  const out = await startAuthorization(req, {
    providerKey: req.params.providerKey, ownershipType, capabilityKeys: Array.isArray(req.body.capabilityKeys) ? req.body.capabilityKeys : [],
    name: text(req.body.name, 120) || null, returnTo: req.body.returnTo || "connection",
  });
  return res.json({ authorizationUrl: out.authorizationUrl, expiresAt: out.expiresAt, pkce: out.pkce, connection: serializeConnection(out.connection) });
});

// Always a redirect; never JSON, never tokens.
export async function oauthCallback(req, res) {
  try {
    const target = await handleCallback(req, req.params.providerKey, req.query || {});
    res.set("Cache-Control", "no-store").set("Referrer-Policy", "no-referrer").redirect(302, target);
  } catch (err) {
    // Scrubbed: never the code, state or tokens.
    console.error(`[integrations] OAuth callback error: ${scrub(String(err?.message || err))}`);
    res.set("Cache-Control", "no-store").redirect(302, resultRedirect("marketplace", null, "error", "unexpected"));
  }
}

// ---- Policies --------------------------------------------------------------------

export const getPolicyHandler = guard(async (req, res) => {
  res.json({ policy: toApi(await getPolicy(req.organizationId)) });
});

export const updatePolicyHandler = guard(async (req, res) => {
  const current = await getPolicy(req.organizationId);
  if (current.persisted && req.body.version !== undefined && Number(req.body.version) !== current.version) return res.status(409).json({ code: "INTEGRATION_VERSION_CONFLICT", message: "The policy was updated by someone else." });
  const data = policyChanges(req.body);
  const policy = await prisma.integrationPolicy.upsert({
    where: { organizationId: req.organizationId },
    create: { organizationId: req.organizationId, ...data, updatedByMembershipId: who(req) },
    update: { ...data, updatedByMembershipId: who(req), version: { increment: 1 } },
  });
  await integrationAudit(req, "integrations.policy.updated", "IntegrationPolicy", policy.id, { before: Object.fromEntries(Object.keys(data).map((k) => [k, current[k]])), after: data });
  res.json({ policy: toApi(policy) });
});

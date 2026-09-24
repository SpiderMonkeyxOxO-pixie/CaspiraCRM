// Backend Phase 8 — connections: status, visibility, credentials access,
// verification, scope summaries and safe serialization.
//
// "Connected" is set only by markVerified(), after the OAuth callback (or a
// key check) has: stored encrypted credentials, verified scopes, called the
// provider's identity endpoint and recorded the external account.
import crypto from "node:crypto";
import prisma from "../../lib/prisma.js";
import { hasGrant } from "../../utils/grants.js";
import { broadestScope } from "../../services/crm/scopeService.js";
import { readCredential, storeCredential, readCredentialById } from "../credentials/credentialStore.js";
import { getAdapter } from "../providers/registry.js";
import { simulatorApp } from "../providers/adapters/simulatorAdapter.js";
import { SIMULATOR_LABEL } from "../simulators/simulatorCore.js";
import { IntegrationError, KINDS } from "../common/errors.js";
import { integrationsMode } from "../credentials/vault.js";
import { integrationLog } from "../common/audit.js";

export const STATUSES = [
  "Not Configured", "Configuration Incomplete", "Ready to Connect", "Authorization Pending", "Connected", "Connected with Warnings",
  "Reauthorization Required", "Rate Limited", "Sync Paused", "Disconnected", "Revoked", "Error",
];
export const OWNERSHIP_TYPES = ["User Connection", "Organization Connection", "Service Connection"];
export const NOT_CONFIGURED_MESSAGE = "Not Configured — provider credentials have not been supplied.";
const ACTIVE_STATUSES = ["Connected", "Connected with Warnings", "Rate Limited"];
const CIRCUIT_THRESHOLD = 5;

export const newPublicId = () => `conn_${crypto.randomBytes(12).toString("base64url")}`;
export const isUsable = (c) => ACTIVE_STATUSES.includes(c.status) && !c.pausedAt;

// The mode new connections get: simulator in local development, live otherwise.
export const currentMode = () => (integrationsMode() === "simulator" ? "Simulator" : "Live");

// The OAuth client for a provider: simulator app, else the organization's
// own app, else the system app. null → "Not Configured".
export async function providerAppFor(organizationId, providerKey, mode, db = prisma) {
  if (mode === "Simulator") return simulatorApp(providerKey);
  const app = (await db.integrationProviderApp.findFirst({ where: { organizationId, providerKey, active: true } }))
    || (await db.integrationProviderApp.findFirst({ where: { organizationId: null, providerKey, active: true } }));
  if (!app) return null;
  const clientSecret = app.clientSecretCredentialId ? await readCredentialById(db, app.clientSecretCredentialId) : null;
  return { id: app.id, clientId: app.clientId, clientSecret, environment: app.environment, settings: app.settings || {} };
}

// Visibility: organization and service connections are visible to anyone
// with integration_connections:view; a user connection only to its owner
// and to members with organization-wide integration scope (admins,
// auditors). A user connection never silently becomes shared.
export function connectionVisibilityWhere(req) {
  if (req.isSystemOwnerOverride) return {};
  const scope = broadestScope(req.membership, "integration_connections");
  if (scope === "Organization" || scope === "System-wide") return {};
  return { OR: [{ ownershipType: { in: ["Organization Connection", "Service Connection"] } }, { connectedMembershipId: req.membership?.id || "__none__" }] };
}

export async function loadConnection(req, id, db = prisma) {
  // AND, not spread: both the id match and the visibility rule use OR.
  return db.integrationConnection.findFirst({ where: { organizationId: req.organizationId, AND: [{ OR: [{ publicId: String(id) }, { id: String(id) }] }, connectionVisibilityWhere(req)] } });
}

// Can the caller change this connection? Their own user connection, or any
// connection with organization-level rights.
export function canManage(req, connection) {
  if (req.isSystemOwnerOverride) return true;
  if (connection.ownershipType === "User Connection") {
    return connection.connectedMembershipId === req.membership?.id || hasGrant(req, "integration_connections", "create_organization");
  }
  return hasGrant(req, "integration_connections", "create_organization");
}

export function scopeSummary(provider, connection) {
  const granted = connection.grantedScopes || [];
  const has = new Set(granted.map((s) => s.toLowerCase()));
  const missing = (list) => (list || []).filter((s) => !has.has(s.toLowerCase()));
  const capabilities = (provider.capabilities || []).map((c) => {
    const missingScopes = missing(c.requiredScopes);
    let state = missingScopes.length ? "Disabled — missing scopes" : "Available";
    if (c.requiresPhase) state = "Unavailable — requires Phase 7";
    return { key: c.key, name: c.name, direction: c.direction, state, missingScopes, reason: c.requiresPhase ? c.unavailableReason : null };
  });
  return {
    requiredScopes: provider.requiredScopes || [], optionalScopes: provider.optionalScopes || [], requestedScopes: connection.requestedScopes || [],
    grantedScopes: granted, missingRequiredScopes: missing(provider.requiredScopes), missingRequestedScopes: missing(connection.requestedScopes),
    capabilities, disabledCapabilities: capabilities.filter((c) => c.state !== "Available").map((c) => c.key),
    lastScopeCheckAt: connection.lastScopeCheckAt,
  };
}

// Never includes credentials — only which kinds exist and when they expire.
export function serializeConnection(connection, { provider = null, credentials = null, canSeeSensitive = false } = {}) {
  const out = {
    _id: connection.publicId, publicId: connection.publicId, providerKey: connection.providerKey, name: connection.name,
    ownershipType: connection.ownershipType, mode: connection.mode, simulatorLabel: connection.mode === "Simulator" ? SIMULATOR_LABEL : null,
    status: connection.pausedAt && isUsable({ ...connection, pausedAt: null }) ? "Sync Paused" : connection.status,
    externalAccountLabel: connection.externalAccountLabel, externalTenantLabel: connection.externalTenantId ? connection.externalTenantId : null,
    grantedScopes: connection.grantedScopes, requestedScopes: connection.requestedScopes,
    connectedAt: connection.connectedAt, lastVerifiedAt: connection.lastVerifiedAt, lastSuccessfulSyncAt: connection.lastSuccessfulSyncAt, lastFailedSyncAt: connection.lastFailedSyncAt,
    reauthorizationRequiredAt: connection.reauthorizationRequiredAt, pausedAt: connection.pausedAt, revokedAt: connection.revokedAt, disconnectedAt: connection.disconnectedAt,
    rateLimitedUntil: connection.rateLimitedUntil, circuitOpenUntil: connection.circuitOpenUntil,
    lastError: connection.lastErrorCode ? { code: connection.lastErrorCode, message: connection.lastErrorMessage } : null,
    connectedMembershipId: connection.connectedMembershipId, createdAt: connection.createdAt, updatedAt: connection.updatedAt, version: connection.version,
  };
  if (canSeeSensitive) Object.assign(out, { externalAccountId: connection.externalAccountId, externalTenantId: connection.externalTenantId });
  if (provider) out.scopes = scopeSummary(provider, connection);
  if (credentials) out.credentials = credentials; // [{ type, keyVersion, expiresAt }] — never values
  return out;
}

// Status changes with a version check; returns the updated row.
export async function setStatus(connection, data, db = prisma) {
  const updated = await db.integrationConnection.updateMany({ where: { id: connection.id, version: connection.version }, data: { ...data, version: { increment: 1 } } });
  if (updated.count !== 1) throw new IntegrationError(KINDS.TRANSIENT, "The connection was changed at the same time. Try again.", { status: 409 });
  return db.integrationConnection.findUnique({ where: { id: connection.id } });
}

export async function markReauthorizationRequired(connection, reason, db = prisma) {
  await db.integrationConnection.update({
    where: { id: connection.id },
    data: { status: "Reauthorization Required", reauthorizationRequiredAt: new Date(), lastErrorCode: "auth_invalid", lastErrorMessage: reason.slice(0, 300), version: { increment: 1 } },
  });
  await integrationLog({ organizationId: connection.organizationId, connectionId: connection.id, level: "warning", event: "connection.reauthorization_required", message: reason }, db);
}

// A valid access token for a call: refreshes when it is about to expire.
// An invalid refresh token moves the connection to Reauthorization Required
// and is never retried.
export async function accessTokenFor(connection, db = prisma) {
  const access = await readCredential(db, { connectionId: connection.id, credentialType: "access_token" });
  if (!access) throw new IntegrationError(KINDS.AUTH_INVALID, "No credentials are stored. Reauthorize the connection.");
  if (!access.expiresAt || access.expiresAt.getTime() - Date.now() > 60_000) return access.value;
  return refreshConnection(connection, db);
}

export async function refreshConnection(connection, db = prisma) {
  const refresh = await readCredential(db, { connectionId: connection.id, credentialType: "refresh_token" });
  const app = await providerAppFor(connection.organizationId, connection.providerKey, connection.mode, db);
  if (!app) throw new IntegrationError(KINDS.NOT_CONFIGURED, NOT_CONFIGURED_MESSAGE);
  const adapter = getAdapter(connection.providerKey, connection.mode);
  try {
    const tokens = await adapter.refreshCredentials({ clientId: app.clientId, clientSecret: app.clientSecret, refreshToken: refresh?.value, requestedScopes: connection.requestedScopes, context: { tenant: app.settings?.tenant } });
    await storeCredential(db, { organizationId: connection.organizationId, connectionId: connection.id, credentialType: "access_token", plaintext: tokens.accessToken, expiresAt: tokens.expiresAt });
    // Rotating refresh tokens: the new one replaces the old.
    if (tokens.refreshToken) await storeCredential(db, { organizationId: connection.organizationId, connectionId: connection.id, credentialType: "refresh_token", plaintext: tokens.refreshToken });
    await integrationLog({ organizationId: connection.organizationId, connectionId: connection.id, event: "credentials.refreshed", message: "Access token refreshed." }, db);
    return tokens.accessToken;
  } catch (err) {
    if (err.kind === KINDS.AUTH_INVALID) await markReauthorizationRequired(connection, "The refresh token was rejected by the provider.", db);
    throw err;
  }
}

// Success resets the failure count; the circuit opens after repeated
// transient failures and closes after a cool-down.
export async function recordOutcome(connection, err = null, db = prisma) {
  if (!err) {
    if (connection.consecutiveFailures || connection.circuitOpenUntil || connection.status === "Rate Limited") {
      await db.integrationConnection.update({ where: { id: connection.id }, data: { consecutiveFailures: 0, circuitOpenUntil: null, rateLimitedUntil: null, ...(connection.status === "Rate Limited" && { status: "Connected" }) } });
    }
    return;
  }
  if (err.kind === KINDS.RATE_LIMITED) {
    await db.integrationConnection.update({ where: { id: connection.id }, data: { status: "Rate Limited", rateLimitedUntil: new Date(Date.now() + (err.retryAfterMs || 60_000)), lastErrorCode: err.kind, lastErrorMessage: err.message } });
    return;
  }
  if (err.kind === KINDS.AUTH_INVALID) return markReauthorizationRequired(connection, err.message, db);
  const failures = (connection.consecutiveFailures || 0) + 1;
  await db.integrationConnection.update({
    where: { id: connection.id },
    data: { consecutiveFailures: failures, lastErrorCode: err.kind, lastErrorMessage: err.message, ...(failures >= CIRCUIT_THRESHOLD && { circuitOpenUntil: new Date(Date.now() + Math.min(60, 2 ** (failures - CIRCUIT_THRESHOLD)) * 60_000) }) },
  });
}

export function assertCallable(connection) {
  if (connection.circuitOpenUntil && connection.circuitOpenUntil > new Date()) throw new IntegrationError(KINDS.TRANSIENT, "Calls to this provider are paused after repeated failures (circuit breaker). They resume automatically.", { retryAfterMs: connection.circuitOpenUntil - Date.now() });
  if (connection.rateLimitedUntil && connection.rateLimitedUntil > new Date()) throw new IntegrationError(KINDS.RATE_LIMITED, "The provider is rate limiting this connection.", { retryAfterMs: connection.rateLimitedUntil - Date.now() });
  if (!["Connected", "Connected with Warnings", "Rate Limited"].includes(connection.status)) throw new IntegrationError(KINDS.AUTH_INVALID, `The connection is ${connection.status}.`);
}

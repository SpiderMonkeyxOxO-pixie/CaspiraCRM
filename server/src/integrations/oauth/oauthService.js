// Backend Phase 8 — OAuth 2.0 authorization code flow with PKCE, controlled
// entirely by the backend.
//
// start:   policy + permission checks → a Connection in "Authorization
//          Pending" → random state (only its hash is stored), PKCE verifier
//          (encrypted), nonce → provider URL. Bound to organization, user,
//          provider, requested scopes and a pre-registered return target.
// callback: state must exist, be unexpired and unused (consumed atomically),
//          and match the provider and the signed-in user; then the code is
//          exchanged on the backend, credentials encrypted, identity fetched,
//          scopes verified, and the browser redirected to a fixed frontend
//          route — never with tokens.
import crypto from "node:crypto";
import prisma from "../../lib/prisma.js";
import { encryptSecret, decryptSecret, sha256, randomToken } from "../credentials/vault.js";
import { storeCredential, revokeCredentials } from "../credentials/credentialStore.js";
import { getAdapter } from "../providers/registry.js";
import { IntegrationError, KINDS } from "../common/errors.js";
import { integrationAudit, integrationLog } from "../common/audit.js";
import { getPolicy, assertProviderAllowed } from "../policies/policyService.js";
import { providerAppFor, currentMode, newPublicId, NOT_CONFIGURED_MESSAGE, setStatus } from "../connections/connectionService.js";

export const STATE_TTL_MS = 10 * 60 * 1000;
const STATE_AAD = "oauth-state|pkce_verifier";

// Pre-registered frontend return targets. Nothing from the request becomes a URL.
const RETURN_TARGETS = {
  connection: (publicId) => `/admin/integrations/connections/${publicId}`,
  marketplace: () => "/admin/integrations/marketplace",
};

export const callbackUrl = (providerKey) => `${(process.env.INTEGRATIONS_PUBLIC_API_URL || `http://localhost:${process.env.PORT || 4000}`).replace(/\/$/, "")}/api/v1/integrations/oauth/${providerKey}/callback`;
const frontendUrl = () => (process.env.INTEGRATIONS_FRONTEND_URL || process.env.CLIENT_ORIGIN || "http://localhost:5173").replace(/\/$/, "");

export function resultRedirect(target, publicId, outcome, reason = null) {
  const path = (RETURN_TARGETS[target] || RETURN_TARGETS.marketplace)(publicId);
  const u = new URL(`${frontendUrl()}${path}`);
  u.searchParams.set("oauth", outcome);
  if (reason) u.searchParams.set("reason", reason);
  return u.toString();
}

export const pkceChallenge = (verifier) => crypto.createHash("sha256").update(verifier).digest("base64url");

// Requested scopes: required + those of the chosen capabilities, known to the provider only.
export function scopesFor(provider, capabilityKeys = []) {
  const known = new Set([...(provider.requiredScopes || []), ...(provider.optionalScopes || [])]);
  const caps = (provider.capabilities || []).filter((c) => capabilityKeys.includes(c.key));
  const requested = [...(provider.requiredScopes || []), ...caps.flatMap((c) => c.requiredScopes || [])];
  return [...new Set(requested)].filter((s) => known.has(s));
}

export async function startAuthorization(req, { providerKey, ownershipType, connectionId = null, capabilityKeys = [], name = null, returnTo = "connection" }) {
  const provider = await prisma.integrationProvider.findUnique({ where: { key: providerKey } });
  if (!provider) throw new IntegrationError(KINDS.PERMANENT, "Unknown provider.");
  if (!["OAuth2"].includes(provider.authType)) throw new IntegrationError(KINDS.UNSUPPORTED, `${provider.name} connects with an API key, not OAuth.`);
  if (!RETURN_TARGETS[returnTo]) throw new IntegrationError(KINDS.PERMANENT, "Unknown return target.");
  const policy = await getPolicy(req.organizationId);

  let connection = null;
  if (connectionId) {
    // Reauthorization of an existing connection keeps its ownership and mode.
    connection = await prisma.integrationConnection.findFirst({ where: { OR: [{ publicId: connectionId }, { id: connectionId }], organizationId: req.organizationId, providerKey } });
    if (!connection) throw new IntegrationError(KINDS.PERMANENT, "Connection not found.");
    ownershipType = connection.ownershipType;
  }
  assertProviderAllowed(policy, provider, ownershipType);
  const mode = connection?.mode || currentMode();
  const app = await providerAppFor(req.organizationId, providerKey, mode);
  if (!app || !app.clientId) throw new IntegrationError(KINDS.NOT_CONFIGURED, NOT_CONFIGURED_MESSAGE);

  // Scope escalation needs explicit reauthorization: the requested set is
  // exactly what the person chose now, recorded on the state.
  const requestedScopes = capabilityKeys.length || !connection ? scopesFor(provider, capabilityKeys) : (connection.requestedScopes || []);

  if (!connection) {
    connection = await prisma.integrationConnection.create({
      data: {
        publicId: newPublicId(), organizationId: req.organizationId, providerKey, name: (name || `${provider.name}${ownershipType === "User Connection" ? " (personal)" : ""}`).slice(0, 120),
        ownershipType, mode, status: "Authorization Pending", requestedScopes,
        connectedUserId: ownershipType === "User Connection" ? req.user.id : null, connectedMembershipId: ownershipType === "User Connection" ? req.membership?.id : null,
        createdByMembershipId: req.membership?.id || null,
      },
    });
    await integrationAudit(req, "integrations.connection.created", "IntegrationConnection", connection.id, { after: { providerKey, ownershipType, mode } });
  } else {
    connection = await setStatus(connection, { status: "Authorization Pending", requestedScopes, updatedByMembershipId: req.membership?.id || null });
  }

  const state = randomToken(32);
  const verifier = randomToken(48);
  const nonce = randomToken(16);
  const sealed = encryptSecret(verifier, STATE_AAD);
  await prisma.integrationOAuthState.create({
    data: {
      stateHash: sha256(state), organizationId: req.organizationId, userId: req.user.id, membershipId: req.membership?.id || null, providerKey, connectionId: connection.id,
      ownershipType, mode, requestedScopes, verifierCiphertext: sealed.ciphertext, verifierNonce: sealed.nonce, verifierTag: sealed.authTag, keyVersion: sealed.keyVersion,
      nonceHash: sha256(nonce), redirectTarget: returnTo, expiresAt: new Date(Date.now() + STATE_TTL_MS),
    },
  });
  const adapter = getAdapter(providerKey, mode);
  const authorizationUrl = adapter.getAuthorizationUrl({ clientId: app.clientId, redirectUri: callbackUrl(providerKey), state, codeChallenge: pkceChallenge(verifier), scopes: requestedScopes, nonce, context: { tenant: app.settings?.tenant } });
  await integrationAudit(req, "integrations.oauth.started", "IntegrationConnection", connection.id, { after: { providerKey, requestedScopes, mode } });
  return { authorizationUrl, connection, expiresAt: new Date(Date.now() + STATE_TTL_MS), pkce: mode === "Simulator" || !!provider.protocol?.pkce };
}

// Returns the frontend URL to redirect to. Never throws to the browser:
// failures become a generic "?oauth=error&reason=<code>".
export async function handleCallback(req, providerKey, query) {
  const fail = async (reason, connection = null, target = "marketplace", detail = null) => {
    await integrationAudit(req, "integrations.oauth.callback_failed", "IntegrationConnection", connection?.id || null, { result: "Denied", reason: `${reason}${detail ? `: ${detail}` : ""}`, organizationId: connection?.organizationId || null });
    if (connection && connection.status === "Authorization Pending") {
      await prisma.integrationConnection.update({ where: { id: connection.id }, data: { status: connection.connectedAt ? "Reauthorization Required" : "Error", lastErrorCode: reason, lastErrorMessage: "Authorization didn't complete.", version: { increment: 1 } } });
    }
    return resultRedirect(target, connection?.publicId, "error", reason);
  };

  if (typeof query.state !== "string" || !query.state) return fail("missing_state");
  const record = await prisma.integrationOAuthState.findUnique({ where: { stateHash: sha256(query.state) } });
  if (!record) return fail("unknown_state");
  const connection = record.connectionId ? await prisma.integrationConnection.findUnique({ where: { id: record.connectionId } }) : null;
  if (record.providerKey !== providerKey) return fail("provider_mismatch", connection);
  // Single use, consumed before anything else happens (replay → refused).
  const consumed = await prisma.integrationOAuthState.updateMany({ where: { id: record.id, consumedAt: null }, data: { consumedAt: new Date() } });
  if (consumed.count !== 1) return fail("state_replayed", connection);
  if (record.expiresAt <= new Date()) return fail("state_expired", connection, record.redirectTarget);
  // The browser returning must be the person who started (login CSRF, connection swapping).
  if (!req.user || req.user.id !== record.userId) return fail("user_mismatch", connection, record.redirectTarget);
  const membership = await prisma.organizationMembership.findUnique({ where: { organizationId_userId: { organizationId: record.organizationId, userId: req.user.id } } });
  if (req.user.role !== "Super-Admin" && (!membership || membership.status !== "Active")) return fail("organization_mismatch", connection, record.redirectTarget);
  if (!connection || connection.organizationId !== record.organizationId) return fail("connection_missing", connection, record.redirectTarget);
  if (query.error) return fail("provider_denied", connection, record.redirectTarget, String(query.error).slice(0, 60));
  if (typeof query.code !== "string" || !query.code) return fail("missing_code", connection, record.redirectTarget);

  // Derived from the real request (keeps headers/ip for the audit trail).
  const orgReq = Object.assign(Object.create(req), { organizationId: record.organizationId, membership: membership || req.membership });
  const provider = await prisma.integrationProvider.findUnique({ where: { key: providerKey } });
  const app = await providerAppFor(record.organizationId, providerKey, record.mode);
  if (!app) return fail("not_configured", connection, record.redirectTarget);
  const adapter = getAdapter(providerKey, record.mode);
  const verifier = decryptSecret({ ciphertext: record.verifierCiphertext, nonce: record.verifierNonce, authTag: record.verifierTag, keyVersion: record.keyVersion }, STATE_AAD);

  let tokens;
  let who;
  try {
    tokens = await adapter.exchangeAuthorizationCode({ clientId: app.clientId, clientSecret: app.clientSecret, code: query.code, redirectUri: callbackUrl(providerKey), codeVerifier: verifier, requestedScopes: record.requestedScopes, context: { tenant: app.settings?.tenant } });
    who = await adapter.getConnectedIdentity({ accessToken: tokens.accessToken, tokenResult: tokens, context: { realmId: query.realmId, tenant: app.settings?.tenant } });
  } catch (err) {
    return fail(err.kind || "exchange_failed", connection, record.redirectTarget);
  }

  // Reauthorization must return the same external account (no silent account swap).
  if (connection.externalAccountId && who.externalAccountId !== connection.externalAccountId) {
    if (adapter.supports("revokeCredentials")) await adapter.revokeCredentials({ clientId: app.clientId, clientSecret: app.clientSecret, token: tokens.accessToken }).catch(() => {});
    return fail("different_account", connection, record.redirectTarget);
  }

  const scopeCheck = adapter.validateScopes(tokens.grantedScopes, provider.requiredScopes || []);
  const optionalMissing = adapter.validateScopes(tokens.grantedScopes, record.requestedScopes || []).missing;
  await revokeCredentials(prisma, { connectionId: connection.id });
  await storeCredential(prisma, { organizationId: connection.organizationId, connectionId: connection.id, credentialType: "access_token", plaintext: tokens.accessToken, expiresAt: tokens.expiresAt });
  if (tokens.refreshToken) await storeCredential(prisma, { organizationId: connection.organizationId, connectionId: connection.id, credentialType: "refresh_token", plaintext: tokens.refreshToken });

  const now = new Date();
  const status = !scopeCheck.ok ? "Reauthorization Required" : optionalMissing.length ? "Connected with Warnings" : "Connected";
  await prisma.integrationConnection.update({
    where: { id: connection.id },
    data: {
      status, grantedScopes: tokens.grantedScopes, externalAccountId: who.externalAccountId, externalAccountLabel: who.externalAccountLabel, externalTenantId: who.tenantId || query.realmId || null,
      connectedAt: connection.connectedAt || now, lastVerifiedAt: now, lastScopeCheckAt: now, reauthorizationRequiredAt: scopeCheck.ok ? null : now, revokedAt: null, disconnectedAt: null,
      capabilityState: { scopeSource: tokens.scopeSource, availableTenants: who.availableTenants || null },
      lastErrorCode: scopeCheck.ok ? null : "scope_missing", lastErrorMessage: scopeCheck.ok ? null : `Missing required scopes: ${scopeCheck.missing.join(", ")}`,
      credentialRef: "encrypted", consecutiveFailures: 0, circuitOpenUntil: null, updatedByMembershipId: orgReq.membership?.id || null, version: { increment: 1 },
    },
  });
  await integrationAudit(orgReq, "integrations.oauth.callback_succeeded", "IntegrationConnection", connection.id, { after: { status, externalAccount: who.externalAccountLabel, grantedScopes: tokens.grantedScopes, missingScopes: [...scopeCheck.missing, ...optionalMissing] } });
  if (JSON.stringify(connection.grantedScopes || []) !== JSON.stringify(tokens.grantedScopes)) {
    await integrationAudit(orgReq, "integrations.connection.scopes_changed", "IntegrationConnection", connection.id, { before: { grantedScopes: connection.grantedScopes }, after: { grantedScopes: tokens.grantedScopes } });
  }
  await integrationLog({ organizationId: connection.organizationId, connectionId: connection.id, event: "connection.verified", message: `Connected to ${who.externalAccountLabel} (${status}).` });
  return resultRedirect(record.redirectTarget, connection.publicId, status === "Reauthorization Required" ? "incomplete" : "connected");
}

// Retention: expired or consumed states are removed after a day.
export async function purgeOAuthStates(now = new Date()) {
  const { count } = await prisma.integrationOAuthState.deleteMany({ where: { OR: [{ expiresAt: { lt: new Date(now - 86_400_000) } }, { consumedAt: { lt: new Date(now - 86_400_000) } }] } });
  return count;
}

// Backend Phase 9 — organization AI provider connections.
//
// The organization's own API key is encrypted in the Phase 8 credential
// store (credentialType "ai_api_key") and read only for the adapter call
// that needs it. A connection is Connected only after an authenticated
// provider call listed the key's models and at least one APPROVED model
// (catalog or organization alias) is among them. The key is never returned.
import crypto from "node:crypto";
import prisma from "../../lib/prisma.js";
import { storeCredential, readCredential, revokeCredentials, describeCredentials } from "../../integrations/credentials/credentialStore.js";
import { AiError, CATEGORIES } from "../common/errors.js";
import { currentAiMode, SIMULATOR_LABEL } from "../common/mode.js";
import { getAiAdapter } from "../adapters/registry.js";
import { SIM_MODELS } from "../adapters/simulatorAdapter.js";
import { DEFAULT_ALIASES } from "../catalog.js";

export const AI_CONNECTION_STATUSES = [
  "Not Configured", "Configuration Incomplete", "Ready to Verify", "Connected", "Connected with Warnings", "Verification Failed",
  "Rate Limited", "Budget Exhausted", "Suspended by Policy", "Disabled", "Revoked", "Error",
];
export const CREDENTIAL_TYPE = "ai_api_key";
const FAILURES_TO_OPEN = 5;
const OPEN_MS = 2 * 60_000;

export const newPublicId = () => `aic_${crypto.randomBytes(9).toString("base64url")}`;

export function serializeAiConnection(c, { credentials = null } = {}) {
  return {
    _id: c.publicId, publicId: c.publicId, providerKey: c.providerKey, name: c.name, mode: c.mode,
    simulatorLabel: c.mode === "Simulator" ? SIMULATOR_LABEL : null,
    status: c.status, keyHint: c.keyHint ? `…${c.keyHint}` : null,
    verifiedAt: c.verifiedAt, verifiedModels: c.verifiedModels || [],
    lastError: c.lastErrorCode ? { code: c.lastErrorCode, message: c.lastErrorMessage } : null,
    rateLimitedUntil: c.rateLimitedUntil, circuitOpenUntil: c.circuitOpenUntil, disabledAt: c.disabledAt, revokedAt: c.revokedAt,
    createdByMembershipId: c.createdByMembershipId, version: c.version, createdAt: c.createdAt, updatedAt: c.updatedAt,
    ...(credentials && { credentials }), // [{ type, keyVersion, storedAt }] — never values
  };
}

export async function loadAiConnection(req, id, db = prisma) {
  return db.aiProviderConnection.findFirst({ where: { organizationId: req.organizationId, OR: [{ publicId: String(id) }, { id: String(id) }] } });
}

export const describeKey = (connectionId) => describeCredentials(prisma, { connectionId }).then((rows) => rows.filter((r) => r.type === CREDENTIAL_TYPE));

function validateKey(apiKey) {
  const k = String(apiKey || "").trim();
  if (k.length < 8 || k.length > 500 || /\s/.test(k)) throw new AiError(CATEGORIES.INVALID_REQUEST, "That doesn't look like a valid API key.");
  return k;
}

export async function apiKeyFor(connection, db = prisma) {
  if (connection.mode === "Simulator") return (await readCredential(db, { connectionId: connection.id, credentialType: CREDENTIAL_TYPE }))?.value || "sim-key";
  const cred = await readCredential(db, { connectionId: connection.id, credentialType: CREDENTIAL_TYPE });
  if (!cred) throw new AiError(CATEGORIES.AUTHENTICATION, "No API key is stored for this AI provider connection.");
  return cred.value;
}

// Creates (or re-creates a revoked) connection for the current mode.
export async function createAiConnection(req, provider, { name, apiKey }, db = prisma) {
  const mode = currentAiMode();
  if (provider.key === "simulator" && mode !== "Simulator") throw new AiError(CATEGORIES.POLICY, "The AI Provider Simulator isn't available here.");
  const needsKey = mode === "Live" && provider.authType === "API Key";
  const key = apiKey ? validateKey(apiKey) : null;
  if (needsKey && !key) throw new AiError(CATEGORIES.INVALID_REQUEST, `Enter the organization's ${provider.name} API key.`);
  const existing = await db.aiProviderConnection.findUnique({ where: { organizationId_providerKey_mode: { organizationId: req.organizationId, providerKey: provider.key, mode } } });
  if (existing && existing.status !== "Revoked") throw new AiError(CATEGORIES.INVALID_REQUEST, `A ${provider.name} connection already exists for this organization. Rotate its key instead.`);
  const data = {
    name: String(name || provider.name).slice(0, 120), status: key || mode === "Simulator" ? "Ready to Verify" : "Configuration Incomplete",
    keyHint: key ? key.slice(-4) : null, verifiedAt: null, verifiedModels: [], lastErrorCode: null, lastErrorMessage: null,
    rateLimitedUntil: null, circuitOpenUntil: null, consecutiveFailures: 0, disabledAt: null, revokedAt: null, createdByMembershipId: req.membership?.id || null,
  };
  const connection = existing
    ? await db.aiProviderConnection.update({ where: { id: existing.id }, data: { ...data, version: { increment: 1 } } })
    : await db.aiProviderConnection.create({ data: { ...data, publicId: newPublicId(), organizationId: req.organizationId, providerKey: provider.key, mode } });
  if (key) await storeCredential(db, { organizationId: req.organizationId, connectionId: connection.id, credentialType: CREDENTIAL_TYPE, plaintext: key });
  return connection;
}

async function approvedModelIds(organizationId, providerKey, db = prisma) {
  const [catalog, aliases] = await Promise.all([
    db.aiModel.findMany({ where: { providerKey, status: "Active" }, select: { modelId: true } }),
    db.aiModelAlias.findMany({ where: { organizationId, providerKey }, select: { modelId: true } }),
  ]);
  return new Set([...catalog.map((m) => m.modelId), ...aliases.map((a) => a.modelId), ...Object.values(DEFAULT_ALIASES[providerKey] || {})]);
}

// Calls the provider with the stored key and records the outcome.
export async function verifyAiConnection(connection, db = prisma) {
  if (connection.status === "Disabled" || connection.status === "Revoked") throw new AiError(CATEGORIES.POLICY, `The connection is ${connection.status.toLowerCase()}.`);
  const adapter = getAiAdapter(connection.providerKey, connection.mode);
  try {
    const apiKey = await apiKeyFor(connection, db);
    const { models } = await adapter.verifyCredentials({ apiKey, providerKey: connection.providerKey });
    const ids = (models || []).map((m) => m.modelId);
    const approved = await approvedModelIds(connection.organizationId, connection.providerKey, db);
    const usable = ids.filter((m) => approved.has(m));
    const aliasTargets = Object.values(DEFAULT_ALIASES[connection.providerKey] || {});
    const missingAliases = aliasTargets.filter((m) => !ids.includes(m));
    const status = !usable.length ? "Verification Failed" : missingAliases.length ? "Connected with Warnings" : "Connected";
    return db.aiProviderConnection.update({
      where: { id: connection.id },
      data: {
        status, verifiedAt: usable.length ? new Date() : null, verifiedModels: ids.slice(0, 300),
        lastErrorCode: !usable.length ? "no_approved_model" : missingAliases.length ? "alias_model_missing" : null,
        lastErrorMessage: !usable.length ? "The key works, but none of the approved models is available to it." : missingAliases.length ? `Some default alias models aren't available to this key: ${missingAliases.join(", ")}. Point those aliases at available models.` : null,
        consecutiveFailures: 0, circuitOpenUntil: null, rateLimitedUntil: null, version: { increment: 1 },
      },
    });
  } catch (err) {
    const e = err instanceof AiError ? err : new AiError(CATEGORIES.UNKNOWN, "Verification failed.");
    const status = e.category === CATEGORIES.AUTHENTICATION || e.category === CATEGORIES.PERMISSION ? "Verification Failed" : e.category === CATEGORIES.RATE_LIMITED ? "Rate Limited" : "Error";
    await db.aiProviderConnection.update({
      where: { id: connection.id },
      data: { status, lastErrorCode: e.category, lastErrorMessage: e.message, ...(e.category === CATEGORIES.RATE_LIMITED && { rateLimitedUntil: new Date(Date.now() + (e.retryAfterMs || 30_000)) }), version: { increment: 1 } },
    });
    throw e;
  }
}

export async function rotateAiKey(connection, apiKey, db = prisma) {
  const key = validateKey(apiKey);
  await storeCredential(db, { organizationId: connection.organizationId, connectionId: connection.id, credentialType: CREDENTIAL_TYPE, plaintext: key });
  return db.aiProviderConnection.update({ where: { id: connection.id }, data: { keyHint: key.slice(-4), status: "Ready to Verify", verifiedAt: null, version: { increment: 1 } } });
}

export async function revokeAiConnection(connection, db = prisma) {
  await revokeCredentials(db, { connectionId: connection.id });
  return db.aiProviderConnection.update({ where: { id: connection.id }, data: { status: "Revoked", revokedAt: new Date(), keyHint: null, verifiedModels: [], version: { increment: 1 } } });
}

// In simulator mode every organization gets a ready simulator connection.
export async function ensureSimulatorConnection(organizationId, db = prisma) {
  const found = await db.aiProviderConnection.findUnique({ where: { organizationId_providerKey_mode: { organizationId, providerKey: "simulator", mode: "Simulator" } } });
  if (found) return found;
  try {
    return await db.aiProviderConnection.create({
      data: { publicId: newPublicId(), organizationId, providerKey: "simulator", mode: "Simulator", name: "AI Provider Simulator", status: "Connected", verifiedAt: new Date(), verifiedModels: SIM_MODELS.map((m) => m.modelId) },
    });
  } catch (err) {
    if (err?.code === "P2002") return db.aiProviderConnection.findUnique({ where: { organizationId_providerKey_mode: { organizationId, providerKey: "simulator", mode: "Simulator" } } });
    throw err;
  }
}

export function isAiUsable(c, now = new Date()) {
  if (!c) return false;
  if (["Disabled", "Revoked", "Verification Failed", "Configuration Incomplete", "Ready to Verify", "Budget Exhausted", "Suspended by Policy", "Not Configured"].includes(c.status)) return false;
  if (c.circuitOpenUntil && c.circuitOpenUntil > now) return false;
  if (c.rateLimitedUntil && c.rateLimitedUntil > now) return false;
  return true;
}

export function whyUnusable(c, now = new Date()) {
  if (!c) return new AiError(CATEGORIES.POLICY, "No AI provider is connected for this use case. Ask an administrator to connect one.");
  if (c.circuitOpenUntil && c.circuitOpenUntil > now) return new AiError(CATEGORIES.PROVIDER_UNAVAILABLE, "Calls to this AI provider are paused after repeated failures. They resume automatically.", { retryAfterMs: c.circuitOpenUntil - now });
  if (c.rateLimitedUntil && c.rateLimitedUntil > now) return new AiError(CATEGORIES.RATE_LIMITED, "The AI provider is rate limiting this organization.", { retryAfterMs: c.rateLimitedUntil - now });
  if (c.status === "Budget Exhausted") return new AiError(CATEGORIES.BUDGET, "The AI budget for this provider is used up for the current period.");
  return new AiError(CATEGORIES.POLICY, `The AI provider connection is ${c.status}.`);
}

// Circuit breaker and rate-limit bookkeeping after each call.
export async function recordAiOutcome(connection, err = null, db = prisma) {
  if (!err) {
    if (connection.consecutiveFailures || connection.circuitOpenUntil || connection.status === "Rate Limited" || connection.status === "Error") {
      await db.aiProviderConnection.update({ where: { id: connection.id }, data: { consecutiveFailures: 0, circuitOpenUntil: null, rateLimitedUntil: null, ...(["Rate Limited", "Error"].includes(connection.status) && { status: "Connected", lastErrorCode: null, lastErrorMessage: null }) } });
    }
    return;
  }
  const data = { lastErrorCode: err.category, lastErrorMessage: err.message };
  if (err.category === CATEGORIES.AUTHENTICATION) Object.assign(data, { status: "Verification Failed" });
  else if (err.category === CATEGORIES.RATE_LIMITED) Object.assign(data, { status: "Rate Limited", rateLimitedUntil: new Date(Date.now() + (err.retryAfterMs || 30_000)) });
  else if ([CATEGORIES.PROVIDER_UNAVAILABLE, CATEGORIES.TIMEOUT, CATEGORIES.UNKNOWN].includes(err.category) && !err.details?.cancelled) {
    // Atomic count: retries and parallel requests must all add up.
    const updated = await db.aiProviderConnection.update({ where: { id: connection.id }, data: { ...data, consecutiveFailures: { increment: 1 } } });
    if (updated.consecutiveFailures >= FAILURES_TO_OPEN && !(updated.circuitOpenUntil > new Date())) {
      await db.aiProviderConnection.update({ where: { id: connection.id }, data: { circuitOpenUntil: new Date(Date.now() + OPEN_MS) } });
    }
    return;
  } else return;
  await db.aiProviderConnection.update({ where: { id: connection.id }, data });
}

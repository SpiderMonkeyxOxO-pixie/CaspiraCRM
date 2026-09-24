// Backend Phase 8 — inbound webhooks.
//
// Receive: raw body (size-limited) → subscription by its unguessable
// callback id → provider match → signature and timestamp verified → replay
// check (unique subscription + provider event id; the payload hash when the
// provider sends no id) → stored → queued → 200. Nothing touches CRM data
// in the HTTP request, and nothing is processed before verification.
// Process (worker): a verified event triggers an incremental sync of the
// matching configuration — the webhook says "something changed", the
// provider API says what. Event order therefore doesn't matter.
import crypto from "node:crypto";
import prisma from "../../lib/prisma.js";
import { readCredentialById, storeCredential } from "../credentials/credentialStore.js";
import { randomToken, sha256 } from "../credentials/vault.js";
import { integrationAudit, integrationLog } from "../common/audit.js";
import { enqueueTask } from "../common/taskQueue.js";
import { IntegrationError, KINDS } from "../common/errors.js";
import { verifySignature, eventIdentity } from "./verifiers.js";
import { SIM_WEBHOOK_SECRET } from "../simulators/simulatorCore.js";
import { getPolicy } from "../policies/policyService.js";
import { queueSyncRun } from "../synchronization/syncService.js";
import { isUsable } from "../connections/connectionService.js";

export const MAX_WEBHOOK_BYTES = 256 * 1024;
const RENEW_BEFORE_MS = 24 * 3600_000;

export const inboundUrl = (providerKey, callbackId) => `${(process.env.INTEGRATIONS_PUBLIC_API_URL || `http://localhost:${process.env.PORT || 4000}`).replace(/\/$/, "")}/api/v1/integrations/webhooks/${providerKey}/${callbackId}`;

async function schemeFor(subscription, connection) {
  if (connection.mode === "Simulator") return { scheme: "simulator" };
  const provider = await prisma.integrationProvider.findUnique({ where: { key: subscription.providerKey } });
  const wh = provider?.protocol?.webhook || {};
  return { scheme: wh.scheme, header: wh.header };
}

// → { status, body, contentType? } for the HTTP layer.
export async function receiveWebhook({ providerKey, callbackId, headers, raw, query = {} }) {
  const reject = async (status, code, subscription = null) => {
    await integrationAudit(null, "integrations.webhook.rejected", "IntegrationWebhookSubscription", subscription?.id || null, { result: "Denied", reason: code, organizationId: subscription?.organizationId || null });
    return { status, body: { error: status === 404 ? "not_found" : "rejected" } };
  };
  if (raw.length > MAX_WEBHOOK_BYTES) return reject(413, "payload_too_large");
  const subscription = await prisma.integrationWebhookSubscription.findUnique({ where: { callbackId: String(callbackId || "") } });
  if (!subscription || subscription.providerKey !== providerKey || subscription.status !== "Active") return reject(404, "unknown_subscription", subscription);
  const connection = await prisma.integrationConnection.findUnique({ where: { id: subscription.connectionId } });
  if (!connection || ["Disconnected", "Revoked"].includes(connection.status)) return reject(404, "connection_inactive", subscription);

  // Microsoft Graph validation handshake (no body, validationToken query) — echoed as text.
  if (query.validationToken && providerKey === "microsoft_365") return { status: 200, body: String(query.validationToken).slice(0, 1024), contentType: "text/plain" };

  const secret = subscription.secretCredentialId ? await readCredentialById(prisma, subscription.secretCredentialId) : null;
  if (!secret) return reject(401, "no_secret", subscription);
  const { scheme, header } = await schemeFor(subscription, connection);
  const result = verifySignature(scheme, { headers, raw, secret, header, callbackUrl: inboundUrl(providerKey, callbackId) });
  if (!result.valid) {
    await integrationLog({ organizationId: subscription.organizationId, connectionId: connection.id, level: "warning", event: "webhook.invalid_signature", message: `Rejected a ${providerKey} webhook (${result.reason}).` });
    return reject(401, `invalid_signature:${result.reason}`, subscription);
  }

  let body;
  try { body = raw.length ? JSON.parse(raw) : {}; } catch { return reject(400, "unparseable", subscription); }
  // Slack URL verification (signed): echo the challenge.
  if (body?.type === "url_verification" && providerKey === "slack") return { status: 200, body: { challenge: String(body.challenge || "").slice(0, 200) } };

  const payloadHash = sha256(raw);
  const { providerEventId, eventType } = eventIdentity(providerKey, headers, body, payloadHash);
  const policy = await getPolicy(subscription.organizationId);
  try {
    const event = await prisma.integrationWebhookEvent.create({
      data: {
        organizationId: subscription.organizationId, connectionId: connection.id, subscriptionId: subscription.id, providerKey, providerEventId, eventType, signatureValid: true,
        providerTimestamp: result.timestamp || null, payloadHash, payload: body, payloadExpiresAt: new Date(Date.now() + policy.rawPayloadRetentionDays * 86_400_000),
      },
    });
    await enqueueTask({ organizationId: subscription.organizationId, connectionId: connection.id, kind: "webhook_event", refId: event.id, dedupeKey: `webhook:${event.id}` });
    return { status: 200, body: providerKey === "dropbox_sign" ? "Hello API Event Received" : { received: true }, contentType: providerKey === "dropbox_sign" ? "text/plain" : undefined, eventId: event.id };
  } catch (err) {
    if (err?.code === "P2002") {
      // Duplicate delivery: acknowledged, never processed twice.
      await integrationAudit(null, "integrations.webhook.replay_ignored", "IntegrationWebhookSubscription", subscription.id, { organizationId: subscription.organizationId, reason: `duplicate event ${providerEventId}` });
      return { status: 200, body: { received: true, duplicate: true } };
    }
    throw err;
  }
}

// Worker: a verified event → an incremental sync of the matching configuration.
export async function processWebhookEvent(eventId) {
  const event = await prisma.integrationWebhookEvent.findUnique({ where: { id: eventId } });
  if (!event || event.processingStatus === "Processed") return;
  await prisma.integrationWebhookEvent.update({ where: { id: event.id }, data: { processingStatus: "Processing", attempts: { increment: 1 } } });
  const subscription = await prisma.integrationWebhookSubscription.findUnique({ where: { id: event.subscriptionId } });
  const connection = await prisma.integrationConnection.findUnique({ where: { id: event.connectionId } });
  const configs = await prisma.integrationSyncConfiguration.findMany({ where: { connectionId: event.connectionId, capability: subscription.capability, enabled: true, initialSyncCompletedAt: { not: null } } });
  let queued = 0;
  if (connection && isUsable(connection)) {
    for (const config of configs) {
      const pending = await prisma.integrationSyncRun.findFirst({ where: { syncConfigurationId: config.id, status: { in: ["Queued", "Running"] } } });
      if (pending) continue; // one pending run covers any number of events
      await queueSyncRun({ connection, config, trigger: "Webhook" });
      queued += 1;
    }
  }
  await prisma.integrationWebhookEvent.update({ where: { id: event.id }, data: { processingStatus: queued || configs.length ? "Processed" : "Ignored", processedAt: new Date(), safeErrorCode: configs.length ? null : "no_enabled_sync" } });
}

// ---- Subscriptions ------------------------------------------------------------

export async function createSubscription(req, connection, capabilityKey) {
  const provider = await prisma.integrationProvider.findUnique({ where: { key: connection.providerKey } });
  if (!provider.webhookSupport && connection.mode !== "Simulator") throw new IntegrationError(KINDS.UNSUPPORTED, `${provider.name} webhooks aren't supported in this phase; changes are polled instead.`);
  const cap = (provider.capabilities || []).find((c) => c.key === capabilityKey);
  if (!cap) throw new IntegrationError(KINDS.PERMANENT, "Unknown capability.");
  if (cap.requiresPhase) throw new IntegrationError(KINDS.UNSUPPORTED, cap.unavailableReason);
  const callbackId = randomToken(24);
  // Simulator: its fixed webhook secret. Live: a generated per-subscription
  // secret the provider is configured with (clientState / channel token /
  // hook secret), or the app's signing secret for app-level schemes.
  let secret = connection.mode === "Simulator" ? SIM_WEBHOOK_SECRET(connection.providerKey) : null;
  const appLevel = ["slack-v0", "stripe", "hmac-sha256-hex", "hmac-sha256-base64", "box-v2", "trello-sha1", "dropbox-sign-event-hash"].includes(provider.protocol?.webhook?.scheme);
  if (!secret && appLevel) {
    const app = await prisma.integrationProviderApp.findFirst({ where: { OR: [{ organizationId: connection.organizationId }, { organizationId: null }], providerKey: connection.providerKey, active: true }, orderBy: { organizationId: "asc" } });
    secret = app?.webhookSecretCredentialId ? await readCredentialById(prisma, app.webhookSecretCredentialId) : null;
    if (!secret) throw new IntegrationError(KINDS.NOT_CONFIGURED, `Store the ${provider.name} webhook signing secret first (provider app settings).`);
  }
  if (!secret) secret = randomToken(32);
  const subscription = await prisma.integrationWebhookSubscription.create({
    data: { organizationId: connection.organizationId, connectionId: connection.id, providerKey: connection.providerKey, capability: capabilityKey, callbackId, expiresAt: connection.mode === "Simulator" ? new Date(Date.now() + 7 * 86_400_000) : null, renewAt: connection.mode === "Simulator" ? new Date(Date.now() + 6 * 86_400_000) : null },
  });
  const cred = await storeCredential(prisma, { organizationId: connection.organizationId, connectionId: connection.id, credentialType: "webhook_secret", plaintext: secret });
  await prisma.integrationWebhookSubscription.update({ where: { id: subscription.id }, data: { secretCredentialId: cred.id } });
  await integrationAudit(req, "integrations.webhook.subscription_created", "IntegrationWebhookSubscription", subscription.id, { after: { capability: capabilityKey, providerKey: connection.providerKey } });
  return {
    subscription: await prisma.integrationWebhookSubscription.findUnique({ where: { id: subscription.id } }),
    callbackUrl: inboundUrl(connection.providerKey, callbackId),
    registration: connection.mode === "Simulator" ? "Registered with the provider simulator." : "Register this callback URL in the provider's webhook settings; automatic registration isn't done in this phase.",
  };
}

export async function rotateSubscriptionSecret(req, subscription) {
  const secret = randomToken(32);
  const cred = await storeCredential(prisma, { organizationId: subscription.organizationId, connectionId: subscription.connectionId, credentialType: "webhook_secret", plaintext: secret });
  await prisma.integrationWebhookSubscription.update({ where: { id: subscription.id }, data: { secretCredentialId: cred.id } });
  await integrationAudit(req, "integrations.webhook.secret_rotated", "IntegrationWebhookSubscription", subscription.id);
}

// Worker: subscriptions near expiry are renewed (simulator) or flagged.
export async function renewSubscriptions(now = new Date()) {
  const due = await prisma.integrationWebhookSubscription.findMany({ where: { status: "Active", renewAt: { lt: new Date(now.getTime() + RENEW_BEFORE_MS) } } });
  for (const s of due) {
    const connection = await prisma.integrationConnection.findUnique({ where: { id: s.connectionId } });
    if (connection?.mode === "Simulator") {
      await prisma.integrationWebhookSubscription.update({ where: { id: s.id }, data: { expiresAt: new Date(now.getTime() + 7 * 86_400_000), renewAt: new Date(now.getTime() + 6 * 86_400_000) } });
      await integrationLog({ organizationId: s.organizationId, connectionId: s.connectionId, event: "webhook.subscription_renewed", message: `Renewed the ${s.capability} subscription.` });
    } else if (s.expiresAt && s.expiresAt < now) {
      await prisma.integrationWebhookSubscription.update({ where: { id: s.id }, data: { status: "Expired" } });
      await integrationLog({ organizationId: s.organizationId, connectionId: s.connectionId, level: "warning", event: "webhook.subscription_expired", message: `The ${s.capability} subscription expired; changes will be polled until it is renewed.` });
    }
  }
  return due.length;
}

export const webhookHash = (body) => crypto.createHash("sha256").update(body).digest("hex");

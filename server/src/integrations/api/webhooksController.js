// Backend Phase 8 — inbound webhook endpoint, subscriptions and outbound
// webhook endpoints.
import prisma from "../../lib/prisma.js";
import { hasGrant } from "../../utils/grants.js";
import { IntegrationError, KINDS, sendIntegrationError } from "../common/errors.js";
import { integrationAudit } from "../common/audit.js";
import { drainTasks } from "../common/taskQueue.js";
import { loadConnection, canManage, connectionVisibilityWhere } from "../connections/connectionService.js";
import { receiveWebhook, processWebhookEvent, createSubscription, rotateSubscriptionSecret, inboundUrl } from "../webhooks/webhookService.js";
import { createEndpoint, rotateEndpointSecret, queueDelivery, deliver, EVENT_TYPES } from "../outbound-webhooks/outboundService.js";
import { validateDestinationUrl } from "../outbound-webhooks/ssrf.js";
import { randomToken } from "../credentials/vault.js";

const guard = (fn) => async (req, res, next) => {
  try {
    await fn(req, res, next);
  } catch (err) {
    if (err instanceof IntegrationError) return sendIntegrationError(res, err);
    return next(err);
  }
};
const notFound = (res, what) => res.status(404).json({ code: "INTEGRATION_NOT_FOUND", message: `${what} not found.` });
const kick = (kind, fn) => setImmediate(() => { drainTasks({ [kind]: fn }, { max: 5 }).catch(() => {}); });

// POST /api/v1/integrations/webhooks/:providerKey/:callbackId (raw body).
export async function inboundWebhookHandler(req, res) {
  try {
    const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
    const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), Array.isArray(v) ? v[0] : v]));
    const result = await receiveWebhook({ providerKey: req.params.providerKey, callbackId: req.params.callbackId, headers, raw, query: req.query || {} });
    if (result.eventId) kick("webhook_event", (t) => processWebhookEvent(t.refId));
    if (result.contentType === "text/plain") return res.status(result.status).type("text/plain").send(String(result.body));
    return res.status(result.status).json(result.body);
  } catch {
    // Never leak internals to the caller.
    return res.status(500).json({ error: "unavailable" });
  }
}

const serializeSubscription = (s) => ({ _id: s.id, connectionId: s.connectionId, providerKey: s.providerKey, capability: s.capability, callbackUrl: inboundUrl(s.providerKey, s.callbackId), status: s.status, expiresAt: s.expiresAt, renewAt: s.renewAt, createdAt: s.createdAt });

// GET /webhooks — subscriptions, recent inbound events, outbound endpoints.
export const listWebhooks = guard(async (req, res) => {
  const ids = (await prisma.integrationConnection.findMany({ where: { organizationId: req.organizationId, ...connectionVisibilityWhere(req) }, select: { id: true } })).map((c) => c.id);
  const [subscriptions, events] = await Promise.all([
    prisma.integrationWebhookSubscription.findMany({ where: { organizationId: req.organizationId, connectionId: { in: ids } }, orderBy: { createdAt: "desc" }, take: 200 }),
    prisma.integrationWebhookEvent.findMany({ where: { organizationId: req.organizationId, connectionId: { in: ids } }, orderBy: { receivedAt: "desc" }, take: 100, select: { id: true, providerKey: true, providerEventId: true, eventType: true, signatureValid: true, receivedAt: true, processingStatus: true, attempts: true, processedAt: true, safeErrorCode: true } }),
  ]);
  res.json({ subscriptions: subscriptions.map(serializeSubscription), events: events.map((e) => ({ ...e, _id: e.id })) });
});

export const createSubscriptionHandler = guard(async (req, res) => {
  const connection = await loadConnection(req, req.params.connectionId);
  if (!connection) return notFound(res, "Connection");
  if (!canManage(req, connection) && !hasGrant(req, "integration_webhooks", "configure")) return res.status(403).json({ code: "RBAC_FORBIDDEN", message: "You can't manage webhooks for this connection." });
  const out = await createSubscription(req, connection, req.body.capability);
  res.status(201).json({ subscription: serializeSubscription(out.subscription), callbackUrl: out.callbackUrl, registration: out.registration });
});

async function loadSubscription(req, res) {
  const s = await prisma.integrationWebhookSubscription.findFirst({ where: { id: req.params.subscriptionId, organizationId: req.organizationId } });
  if (!s) { notFound(res, "Subscription"); return null; }
  const connection = await loadConnection(req, s.connectionId);
  if (!connection) { notFound(res, "Subscription"); return null; }
  return s;
}

export const rotateSubscriptionHandler = guard(async (req, res) => {
  const s = await loadSubscription(req, res);
  if (!s) return;
  await rotateSubscriptionSecret(req, s);
  res.json({ ok: true, note: "Update the secret at the provider too (it is never shown here)." });
});

export const deleteSubscriptionHandler = guard(async (req, res) => {
  const s = await loadSubscription(req, res);
  if (!s) return;
  await prisma.integrationWebhookSubscription.update({ where: { id: s.id }, data: { status: "Deleted" } });
  await integrationAudit(req, "integrations.webhook.subscription_deleted", "IntegrationWebhookSubscription", s.id);
  res.json({ ok: true });
});

// ---- Outbound -------------------------------------------------------------------

const serializeEndpoint = (e) => ({ _id: e.id, name: e.name, url: e.url, eventTypes: e.eventTypes, timeoutMs: e.timeoutMs, active: e.active, createdByMembershipId: e.createdByMembershipId, version: e.version, createdAt: e.createdAt, updatedAt: e.updatedAt });

export const listOutbound = guard(async (req, res) => {
  const endpoints = await prisma.integrationOutboundEndpoint.findMany({ where: { organizationId: req.organizationId, archivedAt: null }, orderBy: { createdAt: "desc" } });
  const deliveries = await prisma.integrationOutboundDelivery.findMany({ where: { organizationId: req.organizationId }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, endpointId: true, eventType: true, deliveryId: true, attempt: true, requestedAt: true, responseStatus: true, durationMs: true, result: true, nextRetryAt: true, safeError: true, createdAt: true } });
  res.json({ endpoints: endpoints.map(serializeEndpoint), deliveries: deliveries.map((d) => ({ ...d, _id: d.id })), eventTypes: EVENT_TYPES });
});

export const createOutbound = guard(async (req, res) => {
  const { endpoint, signingSecret } = await createEndpoint(req, req.body || {});
  await integrationAudit(req, "integrations.outbound_webhook.created", "IntegrationOutboundEndpoint", endpoint.id, { after: { url: endpoint.url, eventTypes: endpoint.eventTypes } });
  res.status(201).json({ endpoint: serializeEndpoint(endpoint), signingSecret, note: "Store this signing secret now — it won't be shown again." });
});

async function loadEndpoint(req, res) {
  const e = await prisma.integrationOutboundEndpoint.findFirst({ where: { id: req.params.endpointId, organizationId: req.organizationId, archivedAt: null } });
  if (!e) notFound(res, "Webhook endpoint");
  return e;
}

export const updateOutbound = guard(async (req, res) => {
  const e = await loadEndpoint(req, res);
  if (!e) return;
  if (req.body.version !== undefined && Number(req.body.version) !== e.version) return res.status(409).json({ code: "INTEGRATION_VERSION_CONFLICT", message: "The endpoint was updated by someone else." });
  const data = {};
  if ("url" in req.body) {
    try { validateDestinationUrl(req.body.url); } catch (err) { throw new IntegrationError(KINDS.POLICY, err.message); }
    data.url = req.body.url;
  }
  if ("eventTypes" in req.body) {
    const types = [...new Set(req.body.eventTypes || [])];
    if (!types.length || types.some((t) => !EVENT_TYPES.includes(t))) return res.status(400).json({ code: "INTEGRATION_VALIDATION", message: `eventTypes: ${EVENT_TYPES.join(", ")}.` });
    data.eventTypes = types;
  }
  if ("active" in req.body) data.active = req.body.active === true;
  if ("name" in req.body) data.name = String(req.body.name || "Webhook").slice(0, 120);
  const updated = await prisma.integrationOutboundEndpoint.update({ where: { id: e.id }, data: { ...data, version: { increment: 1 } } });
  await integrationAudit(req, "integrations.outbound_webhook.updated", "IntegrationOutboundEndpoint", e.id, { before: { url: e.url, eventTypes: e.eventTypes, active: e.active }, after: data });
  res.json({ endpoint: serializeEndpoint(updated) });
});

export const rotateOutboundSecret = guard(async (req, res) => {
  const e = await loadEndpoint(req, res);
  if (!e) return;
  const signingSecret = await rotateEndpointSecret(e);
  await integrationAudit(req, "integrations.outbound_webhook.secret_rotated", "IntegrationOutboundEndpoint", e.id);
  res.json({ signingSecret, note: "Store this signing secret now — it won't be shown again." });
});

export const testOutbound = guard(async (req, res) => {
  const e = await loadEndpoint(req, res);
  if (!e) return;
  const delivery = await queueDelivery(e, { eventType: "webhook.test", eventId: `test_${randomToken(8)}`, data: { message: "Test delivery from Caspira CRM." } });
  await integrationAudit(req, "integrations.outbound_webhook.tested", "IntegrationOutboundEndpoint", e.id);
  kick("outbound_delivery", (t) => deliver(t.refId));
  res.status(202).json({ deliveryId: delivery?.deliveryId || null });
});

export const deleteOutbound = guard(async (req, res) => {
  const e = await loadEndpoint(req, res);
  if (!e) return;
  await prisma.integrationOutboundEndpoint.update({ where: { id: e.id }, data: { archivedAt: new Date(), active: false } });
  await integrationAudit(req, "integrations.outbound_webhook.deleted", "IntegrationOutboundEndpoint", e.id);
  res.json({ ok: true });
});

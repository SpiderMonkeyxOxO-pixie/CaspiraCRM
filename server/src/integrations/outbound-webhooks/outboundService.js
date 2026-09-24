// Backend Phase 8 — outbound CRM webhooks.
//
// An organization registers HTTPS endpoints for approved CRM events. Events
// come from the append-only audit trail (the same moment the change is
// recorded), so no business code has to remember to emit them. Payloads
// are minimal — event type, record type and id, time — so no restricted or
// personal data leaves; receivers fetch details through the API with their
// own permissions. Every delivery is HMAC-signed with a timestamp and a
// delivery id, sent only to a validated public address (see ssrf.js), and
// retried with backoff; exhausted deliveries become Dead Letter.
import crypto from "node:crypto";
import prisma from "../../lib/prisma.js";
import { storeCredential, readCredentialById } from "../credentials/credentialStore.js";
import { randomToken } from "../credentials/vault.js";
import { enqueueTask } from "../common/taskQueue.js";
import { IntegrationError, KINDS } from "../common/errors.js";
import { getPolicy, filterOutbound } from "../policies/policyService.js";
import { safeDeliver, validateDestinationUrl, SsrfError } from "./ssrf.js";

// Approved events (audit action → outbound event type).
export const OUTBOUND_EVENTS = {
  "crm.contact.created": "contact.created", "crm.company.created": "company.created", "crm.lead.converted": "lead.converted",
  "sales.deal.won": "deal.won", "sales.quote.accepted": "quote.accepted", "sales.order.confirmed": "order.confirmed",
  "support.ticket.created": "ticket.created", "support.ticket.resolved": "ticket.resolved",
  "projects.task.completed": "task.completed", "projects.project.completed": "project.completed",
  "finance.invoice.posted": "invoice.posted", "finance.payment.posted": "payment.posted",
  "integrations.sync.completed": "integration.sync_completed",
};
export const EVENT_TYPES = [...new Set(Object.values(OUTBOUND_EVENTS)), "webhook.test"];
export const MAX_BODY_BYTES = 64 * 1024;

export const signPayload = (secret, timestamp, body) => crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");

export async function createEndpoint(req, { name, url, eventTypes, timeoutMs }) {
  try { validateDestinationUrl(url); } catch (err) { throw new IntegrationError(KINDS.POLICY, err.message); }
  const types = [...new Set(eventTypes || [])];
  if (!types.length || types.some((t) => !EVENT_TYPES.includes(t))) throw new IntegrationError(KINDS.PERMANENT, `eventTypes must be chosen from: ${EVENT_TYPES.join(", ")}.`);
  const endpoint = await prisma.integrationOutboundEndpoint.create({
    data: { organizationId: req.organizationId, name: String(name || "Webhook").slice(0, 120), url, eventTypes: types, timeoutMs: Math.min(10_000, Math.max(1000, Number(timeoutMs) || 5000)), createdByMembershipId: req.membership?.id || null },
  });
  const secret = `whsec_${randomToken(32)}`;
  const cred = await storeCredential(prisma, { organizationId: req.organizationId, credentialType: "signing_secret", plaintext: secret, connectionId: null, providerAppId: null });
  await prisma.integrationOutboundEndpoint.update({ where: { id: endpoint.id }, data: { secretCredentialId: cred.id } });
  // The receiver needs the secret to verify signatures: shown once, never again.
  return { endpoint: await prisma.integrationOutboundEndpoint.findUnique({ where: { id: endpoint.id } }), signingSecret: secret };
}

export async function rotateEndpointSecret(endpoint) {
  const secret = `whsec_${randomToken(32)}`;
  const cred = await storeCredential(prisma, { organizationId: endpoint.organizationId, credentialType: "signing_secret", plaintext: secret });
  await prisma.integrationOutboundEndpoint.update({ where: { id: endpoint.id }, data: { secretCredentialId: cred.id, version: { increment: 1 } } });
  if (endpoint.secretCredentialId) await prisma.integrationCredential.update({ where: { id: endpoint.secretCredentialId }, data: { status: "Superseded", rotatedAt: new Date() } });
  return secret;
}

// Called from the audit trail for every recorded event (non-blocking).
export async function emitFromAudit(event) {
  const type = OUTBOUND_EVENTS[event.action];
  if (!type || !event.organizationId || event.result !== "Success") return 0;
  const endpoints = await prisma.integrationOutboundEndpoint.findMany({ where: { organizationId: event.organizationId, active: true, archivedAt: null } });
  let queued = 0;
  for (const e of endpoints.filter((x) => (x.eventTypes || []).includes(type))) {
    await queueDelivery(e, { eventType: type, eventId: event.id, data: { recordType: event.targetType, recordId: event.targetId } });
    queued += 1;
  }
  return queued;
}

export async function queueDelivery(endpoint, { eventType, eventId, data }) {
  const policy = await getPolicy(endpoint.organizationId);
  const { payload } = filterOutbound(data, policy);
  try {
    const delivery = await prisma.integrationOutboundDelivery.create({
      data: { organizationId: endpoint.organizationId, endpointId: endpoint.id, eventType, eventId, deliveryId: `dlv_${randomToken(16)}`, payload: { type: eventType, data: payload, occurredAt: new Date().toISOString() }, payloadExpiresAt: new Date(Date.now() + policy.rawPayloadRetentionDays * 86_400_000) },
    });
    await enqueueTask({ organizationId: endpoint.organizationId, kind: "outbound_delivery", refId: delivery.id, dedupeKey: `delivery:${delivery.id}`, maxAttempts: 6 });
    return delivery;
  } catch (err) {
    if (err?.code === "P2002") return null; // one delivery per endpoint per event (idempotent)
    throw err;
  }
}

// Worker: one attempt. Success → Succeeded; 4xx (not 408/429) → Failed, not
// retried; otherwise throws a retryable error so the queue backs off.
export async function deliver(deliveryId, { send, resolver } = {}) {
  const d = await prisma.integrationOutboundDelivery.findUnique({ where: { id: deliveryId } });
  if (!d || ["Succeeded", "Failed", "Dead Letter"].includes(d.result)) return d;
  const endpoint = await prisma.integrationOutboundEndpoint.findUnique({ where: { id: d.endpointId } });
  if (!endpoint?.active || endpoint.archivedAt) {
    await prisma.integrationOutboundDelivery.update({ where: { id: d.id }, data: { result: "Failed", safeError: "Endpoint inactive." } });
    return null;
  }
  const secret = await readCredentialById(prisma, endpoint.secretCredentialId);
  const body = JSON.stringify({ id: d.deliveryId, ...(d.payload || {}) });
  if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
    await prisma.integrationOutboundDelivery.update({ where: { id: d.id }, data: { result: "Failed", safeError: "Payload too large." } });
    return null;
  }
  const timestamp = Math.floor(Date.now() / 1000);
  const headers = {
    "Content-Type": "application/json", "User-Agent": "Caspira-CRM-Webhooks/1.0",
    "X-Caspira-Event": d.eventType, "X-Caspira-Delivery-Id": d.deliveryId, "X-Caspira-Timestamp": String(timestamp),
    "X-Caspira-Signature": `t=${timestamp},v1=${signPayload(secret, timestamp, body)}`,
  };
  const started = Date.now();
  const attempt = d.attempt + 1;
  let status = null;
  let error = null;
  try {
    ({ status } = await safeDeliver(endpoint.url, { body, headers, timeoutMs: endpoint.timeoutMs, ...(send && { send }), ...(resolver && { resolver }) }));
  } catch (err) {
    error = err instanceof SsrfError ? `Blocked: ${err.message}` : err.message === "timeout" ? "Timed out." : "Connection failed.";
    if (err instanceof SsrfError) {
      await prisma.integrationOutboundDelivery.update({ where: { id: d.id }, data: { attempt, requestedAt: new Date(), durationMs: Date.now() - started, result: "Failed", safeError: error } });
      return null;
    }
  }
  const ok = status >= 200 && status < 300;
  const permanent = status && status >= 400 && status < 500 && ![408, 429].includes(status);
  await prisma.integrationOutboundDelivery.update({
    where: { id: d.id },
    data: { attempt, requestedAt: new Date(), responseStatus: status, durationMs: Date.now() - started, result: ok ? "Succeeded" : permanent ? "Failed" : "Pending", safeError: ok ? null : (error || `HTTP ${status}`).slice(0, 200) },
  });
  if (!ok && !permanent) throw new IntegrationError(status === 429 ? KINDS.RATE_LIMITED : KINDS.TRANSIENT, error || `HTTP ${status}`);
  return ok;
}

// When the queue gives up, the delivery is marked Dead Letter too.
export async function markDeliveryDeadLetter(deliveryId) {
  await prisma.integrationOutboundDelivery.update({ where: { id: deliveryId }, data: { result: "Dead Letter" } });
}

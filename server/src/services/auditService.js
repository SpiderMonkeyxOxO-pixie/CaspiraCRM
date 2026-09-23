import prisma from "../lib/prisma.js";

// Append-only. Nothing in this codebase updates or deletes an audit_events
// row after creation — no route exposes that, and this is the only place
// that writes to the table at all.
// Bank and card numbers are redacted too (Finance, Backend Phase 6).
const SENSITIVE_KEYS = ["password", "passwordHash", "token", "tokenHash", "secret", "cookie", "authorization", "accountnumber", "iban", "cardnumber"];

function redact(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value !== "object") return value;
  const out = {};
  for (const [key, val] of Object.entries(value)) {
    out[key] = SENSITIVE_KEYS.some((k) => key.toLowerCase().includes(k)) ? "[redacted]" : redact(val);
  }
  return out;
}

export async function recordAuditEvent({
  tx, correlationId, actorUserId = null, actorMembershipId = null, organizationId = null,
  action, targetType = null, targetId = null, result, reason = null,
  before = null, after = null, ipAddress = null, userAgent = null,
}) {
  const client = tx || prisma;
  return client.auditEvent.create({
    data: {
      correlationId, actorUserId, actorMembershipId, organizationId,
      action, targetType, targetId, result, reason,
      beforeData: before ? redact(before) : undefined,
      afterData: after ? redact(after) : undefined,
      ipAddress, userAgent,
    },
  });
}

export function requestContext(req) {
  return { correlationId: req.correlationId, ipAddress: req.ip, userAgent: req.headers["user-agent"] || null };
}

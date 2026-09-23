// Backend Phase 4 — shared Support helpers: text sanitizing, name
// normalizing, the append-only Ticket Event log and audit.
import { recordAuditEvent, requestContext } from "../auditService.js";

// Messages, notes, articles and canned responses are plain text. Anything
// that looks like markup is removed — script/style blocks with their
// content, then every tag — and control characters are dropped. The
// frontend renders the result as text, so it can never run as HTML.
export function sanitizeText(input, { max = 20000 } = {}) {
  if (typeof input !== "string") return "";
  return input
    .replace(/<(script|style|iframe|object|embed)[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<\/?[a-zA-Z!][^>]*>/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, max);
}

export function normalizeName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

export function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_-]+/g, "-")
    .slice(0, 80);
}

export const versionConflict = (res, what) =>
  res.status(409).json({ code: "SUPPORT_VERSION_CONFLICT", message: `This ${what} was updated by someone else. Refresh and try again.` });

export const invalid = (res, message) => res.status(400).json({ code: "SUPPORT_VALIDATION_FAILED", message });
export const notFound = (res, what) => res.status(404).json({ code: "SUPPORT_RECORD_NOT_FOUND", message: `${what} not found.` });
export const badTransition = (res, message) => res.status(400).json({ code: "SUPPORT_INVALID_TRANSITION", message });

// A version mismatch only when the client sent one — optimistic concurrency.
export const staleVersion = (body, record) => body?.version !== undefined && Number(body.version) !== record.version;

export async function audit(req, action, targetType, targetId, extra = {}) {
  await recordAuditEvent({
    ...requestContext(req), actorUserId: req.user?.id || null, actorMembershipId: req.membership?.id || null,
    organizationId: req.organizationId, action, targetType, targetId, result: "Success", ...extra,
  });
}

// Appends to the ticket's history. Never updated or deleted afterwards.
// Pass a dedupeKey for anything a job might produce twice.
export function ticketEvent(tx, { organizationId, ticketId, eventType, actorType = "Agent", actorMembershipId = null, actorPortalAccountId = null, fromValue = null, toValue = null, reason = null, snapshot = {}, customerVisible = false, dedupeKey = null }) {
  return tx.ticketEvent.create({
    data: {
      organizationId, ticketId, eventType, actorType, actorMembershipId, actorPortalAccountId,
      fromValue: fromValue === null ? null : String(fromValue), toValue: toValue === null ? null : String(toValue),
      reason, snapshot, customerVisible, dedupeKey,
    },
  });
}

// Backend Phase 8 — audit events and integration logs. Both pass through
// scrub(), so a token, code, secret or signature can't be written even by
// mistake. Audit events use the append-only audit service.
import prisma from "../../lib/prisma.js";
import { recordAuditEvent, requestContext } from "../../services/auditService.js";

const SECRET_KEYS = /token|secret|code_verifier|verifier|password|authorization|signature|apikey|api_key|client_secret|state|code$/i;
const TOKEN_LIKE = /\b(ya29\.[\w-]+|xox[abpr]-[\w-]+|gh[pousr]_[\w]+|(sk|rk)_(live|test)_[\w]+|sim_(at|rt|code)_[\w-]+|eyJ[\w-]+\.[\w-]+\.[\w-]+)\b/g;

export function scrub(value, depth = 0) {
  if (value === null || value === undefined || depth > 6) return value;
  if (typeof value === "string") return value.replace(TOKEN_LIKE, "[redacted]");
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = SECRET_KEYS.test(k) ? "[redacted]" : scrub(v, depth + 1);
    return out;
  }
  return value;
}

export async function integrationAudit(req, action, targetType, targetId, extra = {}) {
  const { before, after, reason, result = "Success", organizationId } = extra;
  await recordAuditEvent({
    ...(req ? requestContext(req) : {}),
    actorUserId: req?.user?.id || null, actorMembershipId: req?.membership?.id || null,
    organizationId: organizationId || req?.organizationId || null,
    action, targetType, targetId, result,
    reason: reason ? scrub(String(reason)).slice(0, 500) : null,
    before: before ? scrub(before) : null, after: after ? scrub(after) : null,
  });
}

export async function integrationLog({ organizationId, connectionId = null, level = "info", event, message, correlationId = null }, db = prisma) {
  await db.integrationLog.create({ data: { organizationId, connectionId, level, event, message: scrub(String(message)).slice(0, 1000), correlationId } });
}

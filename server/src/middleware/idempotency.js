import crypto from "node:crypto";
import prisma from "../lib/prisma.js";

// Wires up the Phase 1 IdempotencyKey table (defined since Backend Phase 1
// but never consumed by anything until now). Used by lead conversion and
// merge — both explicitly required to be idempotent and safe under
// concurrent requests.
//
// Usage: `requireIdempotencyKey("lead.convert")` as middleware, then in the
// controller call `resolveIdempotency(req, responseBody)` after a
// successful write to record the response for replay.
export function requireIdempotencyKey(scope) {
  return async (req, res, next) => {
    const key = req.headers["idempotency-key"];
    if (!key) return res.status(400).json({ code: "IDEMPOTENCY_KEY_REQUIRED", message: "An Idempotency-Key header is required for this operation." });

    const requestHash = crypto.createHash("sha256").update(JSON.stringify(req.body || {})).digest("hex");
    const existing = await prisma.idempotencyKey.findUnique({ where: { key } });

    if (existing) {
      if (existing.scope !== scope || existing.requestHash !== requestHash) {
        return res.status(409).json({ code: "IDEMPOTENCY_KEY_REUSED", message: "This idempotency key was already used for a different request." });
      }
      // Exact replay of a request already handled — return the original
      // response rather than repeating the side effect.
      return res.status(existing.responseStatus || 200).json(existing.responseBody);
    }

    req.idempotency = { key, scope, requestHash };
    next();
  };
}

export async function recordIdempotentResponse(req, status, body) {
  if (!req.idempotency) return;
  await prisma.idempotencyKey.create({
    data: {
      key: req.idempotency.key,
      scope: req.idempotency.scope,
      requestHash: req.idempotency.requestHash,
      responseStatus: status,
      responseBody: body,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  }).catch(() => {}); // a race on the unique `key` here means another request already recorded it — fine, that response is authoritative
}

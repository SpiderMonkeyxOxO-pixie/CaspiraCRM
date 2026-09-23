import crypto from "node:crypto";
import prisma from "../lib/prisma.js";

// Idempotency for operations that must not run twice (conversions, merges,
// postings, replies, ...). Usage: `requireIdempotencyKey("scope")` as
// middleware; the first request with a key runs, and any repeat of it
// gets the stored response instead of repeating the side effect.
//
// Safe under concurrency: the key is RESERVED (a row inserted, unique)
// before the handler runs, so two simultaneous requests can't both pass —
// the second sees the reservation and gets 409 IDEMPOTENCY_IN_PROGRESS.
// The handler's JSON response is captured automatically: a success is
// stored for replay, a failure releases the key so the client can retry.
//
// Keys are namespaced by the caller's user id — one user's key can never
// replay another user's stored response.
const TTL_MS = 24 * 60 * 60 * 1000;

export function requireIdempotencyKey(scope) {
  return async (req, res, next) => {
    const clientKey = req.headers["idempotency-key"];
    if (!clientKey || String(clientKey).length > 200) {
      return res.status(400).json({ code: "IDEMPOTENCY_KEY_REQUIRED", message: "An Idempotency-Key header (up to 200 characters) is required for this operation." });
    }
    const key = `${req.user?.id || "anonymous"}:${clientKey}`;
    const requestHash = crypto.createHash("sha256").update(JSON.stringify({ path: req.originalUrl, body: req.body || {} })).digest("hex");

    try {
      await prisma.idempotencyKey.create({ data: { key, scope, requestHash, expiresAt: new Date(Date.now() + TTL_MS) } });
    } catch (err) {
      if (err?.code !== "P2002") throw err;
      const existing = await prisma.idempotencyKey.findUnique({ where: { key } });
      if (!existing) return res.status(409).json({ code: "IDEMPOTENCY_IN_PROGRESS", message: "This request is already being processed." });
      if (existing.scope !== scope || existing.requestHash !== requestHash) {
        return res.status(409).json({ code: "IDEMPOTENCY_KEY_REUSED", message: "This idempotency key was already used for a different request." });
      }
      if (existing.responseStatus === null) {
        return res.status(409).json({ code: "IDEMPOTENCY_IN_PROGRESS", message: "This request is already being processed." });
      }
      // Exact replay of a request already handled — return the original
      // response rather than repeating the side effect.
      res.setHeader("Idempotent-Replay", "true");
      return res.status(existing.responseStatus).json(existing.responseBody);
    }

    req.idempotency = { key, scope, requestHash, recorded: false };
    const json = res.json.bind(res);
    res.json = (body) => {
      finalize(req, res.statusCode, body);
      return json(body);
    };
    next();
  };
}

// Stores a success for replay, or releases the key after a failure so the
// same key can be retried. Runs once per request.
function finalize(req, status, body) {
  const idem = req.idempotency;
  if (!idem || idem.recorded) return;
  idem.recorded = true;
  const write = status >= 200 && status < 300
    ? prisma.idempotencyKey.update({ where: { key: idem.key }, data: { responseStatus: status, responseBody: body ?? null } })
    : prisma.idempotencyKey.delete({ where: { key: idem.key } });
  write.catch(() => {});
}

// Kept for existing callers — the response is now captured automatically,
// so this only records early if a controller calls it before responding.
export async function recordIdempotentResponse(req, status, body) {
  finalize(req, status, body);
}

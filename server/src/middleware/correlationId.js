import crypto from "node:crypto";

// One correlation ID per request, echoed back in the response header and
// threaded into every audit event/log line written while handling it — the
// glue that lets "audit_events.correlationId" and "grep this ID in the
// access log" refer to the same request. A caller-supplied ID (the reverse
// proxy's X-Request-Id, or X-Correlation-Id) is accepted only if it is a
// short token of safe characters, so it can't inject into logs.
const SAFE_ID = /^[A-Za-z0-9._:-]{8,128}$/;

export function correlationId(req, res, next) {
  const supplied = req.headers["x-correlation-id"] || req.headers["x-request-id"];
  const id = typeof supplied === "string" && SAFE_ID.test(supplied) ? supplied : crypto.randomUUID();
  req.correlationId = id;
  res.setHeader("X-Correlation-Id", id);
  next();
}

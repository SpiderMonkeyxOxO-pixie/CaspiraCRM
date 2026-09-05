import crypto from "node:crypto";

// One correlation ID per request, echoed back in the response header and
// threaded into every audit event/log line written while handling it — the
// glue that lets "audit_events.correlationId" and "grep this ID in the
// access log" refer to the same request.
export function correlationId(req, res, next) {
  const id = req.headers["x-correlation-id"] || crypto.randomUUID();
  req.correlationId = id;
  res.setHeader("X-Correlation-Id", id);
  next();
}

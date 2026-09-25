// Never forward a Prisma error's own `message` to the client — Prisma's
// validation/query errors (PrismaClientValidationError,
// PrismaClientKnownRequestError with a code not explicitly handled below,
// PrismaClientUnknownRequestError) embed the full query payload and field
// values in their message, which would leak internal schema/ORM details
// and potentially sensitive data (pricing, PII) over the wire. Existing
// application-level errors (e.g. services/ai/*'s AiGatewayError/
// AiProviderError/CooldownError) are hand-authored with deliberately safe
// messages and a real `.status` — those still pass through unchanged. The
// full error is always logged server-side either way.
//
// Backend Phase 13: every error is a safe envelope { code, message,
// correlationId }. Server errors (5xx) never return their message, stack,
// SQL, paths or internal addresses; body-parser failures get proper codes.
const PRISMA_ERROR_NAME_PATTERN = /^PrismaClient/;

export function errorHandler(err, req, res, _next) {
  const correlationId = req?.correlationId;
  console.error(`[error] ${correlationId || "-"}`, err);
  if (res.headersSent) return undefined;
  const send = (status, code, message) => res.status(status).json({ code, message, correlationId });
  if (err.type === "entity.too.large") return send(413, "PAYLOAD_TOO_LARGE", "The request body is too large.");
  if (err.type === "entity.parse.failed") return send(400, "INVALID_JSON", "The request body is not valid JSON.");
  if (err.code === "P2025") return send(404, "NOT_FOUND", "Record not found");
  if (err.code === "P2002") return send(409, "CONFLICT", "A record with that value already exists");
  if (err.code === "P2003") return send(400, "INVALID_REFERENCE", "This action references a record that doesn't exist");
  if (PRISMA_ERROR_NAME_PATTERN.test(err.constructor?.name || err.name || "")) return send(500, "INTERNAL_ERROR", "Something went wrong");
  const status = Number(err.status || err.statusCode) || 500;
  if (status >= 500) return send(status, "INTERNAL_ERROR", "Something went wrong");
  return send(status, err.code && typeof err.code === "string" ? err.code : "REQUEST_ERROR", err.message || "Request failed");
}

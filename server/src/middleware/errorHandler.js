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
const PRISMA_ERROR_NAME_PATTERN = /^PrismaClient/;

export function errorHandler(err, _req, res, _next) {
  console.error(err);
  if (err.code === "P2025") return res.status(404).json({ message: "Record not found" });
  if (err.code === "P2002") return res.status(409).json({ message: "A record with that value already exists" });
  if (err.code === "P2003") return res.status(400).json({ message: "This action references a record that doesn't exist" });
  if (PRISMA_ERROR_NAME_PATTERN.test(err.constructor?.name || err.name || "")) {
    return res.status(500).json({ message: "Something went wrong" });
  }
  res.status(err.status || 500).json({ message: err.message || "Something went wrong" });
}

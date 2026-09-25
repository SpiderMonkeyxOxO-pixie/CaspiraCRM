import jwt from "jsonwebtoken";

// Backend Phase 13: the development fallback secret exists only in
// development and tests; staging and production refuse to start without a
// strong JWT_SECRET (src/config/validate.js), and tokens are verified with
// an explicit algorithm allowlist. During a signing-key rotation,
// JWT_SECRET_PREVIOUS (optional) still verifies tokens issued before the
// switch; new tokens are always signed with JWT_SECRET.
const devOnly = () => !["staging", "production"].includes(process.env.APP_ENV) && process.env.NODE_ENV !== "production";
const secret = () => {
  const s = process.env.JWT_SECRET || (devOnly() ? "dev-secret" : null);
  if (!s) throw new Error("JWT_SECRET is not configured.");
  return s;
};
const EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";

export function signToken(payload, expiresIn = EXPIRES_IN) {
  return jwt.sign(payload, secret(), { expiresIn, algorithm: "HS256" });
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, secret(), { algorithms: ["HS256"] });
  } catch (err) {
    const previous = process.env.JWT_SECRET_PREVIOUS;
    if (previous && err?.name === "JsonWebTokenError") return jwt.verify(token, previous, { algorithms: ["HS256"] });
    throw err;
  }
}

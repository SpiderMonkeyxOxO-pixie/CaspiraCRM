import crypto from "node:crypto";

// Every invitation/invite-link/refresh/reset/verification token follows the
// same shape: a high-entropy random value is the only thing that ever
// leaves the server (in a URL or a cookie); only its SHA-256 hash is ever
// persisted. SHA-256 (not a slow password hash) is correct here — the input
// is already 256 bits of randomness, not a guessable human password, so
// there's nothing for a slow KDF to protect against that speed already
// doesn't defeat via sheer keyspace size.
export function generateRawToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function hashToken(rawToken) {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

export function isExpired(expiresAt) {
  return !expiresAt || new Date(expiresAt).getTime() <= Date.now();
}

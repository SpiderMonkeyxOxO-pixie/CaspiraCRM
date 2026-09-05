import argon2 from "argon2";
import bcrypt from "bcryptjs";

// Every new/reset password is hashed with Argon2id from here on. Existing
// accounts (seeded via prisma/seed.js, or created before this file existed)
// keep their bcrypt hash and keep authenticating — verifyPassword() detects
// the format and dispatches to the right library, so User.passwordHash can
// transparently hold either kind. No forced re-hash migration is needed;
// legacy hashes are never rejected, and nothing ever downgrades a new
// password back to bcrypt.
export async function hashPassword(plain) {
  return argon2.hash(plain, { type: argon2.argon2id });
}

export async function verifyPassword(hash, plain) {
  if (!hash) return false;
  if (hash.startsWith("$argon2")) return argon2.verify(hash, plain);
  if (hash.startsWith("$2")) return bcrypt.compare(plain, hash);
  return false;
}

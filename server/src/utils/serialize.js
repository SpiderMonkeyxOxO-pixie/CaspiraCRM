// The frontend's existing Redux thunks/components (built across every prior
// phase of this project against a Mongo-style mock layer) all read `_id`,
// never `id`. Rather than touch hundreds of already-built frontend files,
// every API response passes through this to present Prisma's `id` as `_id`
// — Prisma itself stays idiomatic (plain `id` primary keys).
//
// This also strips credential fields wherever a User relation gets nested
// into another record's response (owner/assignee/submittedBy/etc. — every
// module includes User relations somewhere) — without this, a plain
// `include: { owner: true }` would leak `passwordHash` and the 2FA secret
// over the wire.
const SENSITIVE_USER_FIELDS = ["passwordHash", "twoFactorSecret", "resetToken", "resetTokenExpires"];

export function toApi(record) {
  if (record === null || record === undefined) return record;
  if (Array.isArray(record)) return record.map(toApi);
  if (record instanceof Date) return record.toISOString();
  if (typeof record !== "object") return record;

  const { id, ...rest } = record;
  const out = id !== undefined ? { _id: id } : {};
  for (const [key, value] of Object.entries(rest)) {
    if (SENSITIVE_USER_FIELDS.includes(key)) continue;
    out[key] = toApi(value);
  }
  return out;
}

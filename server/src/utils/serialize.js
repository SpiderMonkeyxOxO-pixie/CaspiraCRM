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
  // Prisma's Decimal (decimal.js under the hood) is an object, not a
  // primitive — without this check the generic object loop below would
  // recurse into its internal d/e/s fields instead of producing a number.
  // Money is stored as Postgres numeric/Decimal end-to-end on the backend;
  // converting to a plain JS number only at the API boundary matches every
  // existing frontend fixture's expectation (`value: 68000`, a float, never
  // a string) and keeps this the ONE place float imprecision can reenter.
  if (typeof record === "object" && typeof record.toNumber === "function" && typeof record.toFixed === "function") {
    return record.toNumber();
  }
  if (typeof record !== "object") return record;

  const { id, ...rest } = record;
  const out = id !== undefined ? { _id: id } : {};
  for (const [key, value] of Object.entries(rest)) {
    if (SENSITIVE_USER_FIELDS.includes(key)) continue;
    out[key] = toApi(value);
  }
  return out;
}

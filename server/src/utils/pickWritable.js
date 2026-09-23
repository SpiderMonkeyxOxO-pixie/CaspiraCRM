// Copies only the allow-listed fields a client may write from a request
// body, coercing types Prisma would otherwise reject. Everything not listed
// (organizationId, version, archive/conversion state, audit membership ids,
// normalized search fields) stays server-controlled, and unknown fields are
// dropped instead of reaching Prisma, which rejects them with a 500.
//
// "" becomes null so a cleared form field clears the column.
export function pickWritable(body, fields, { dates = [], numbers = [] } = {}) {
  const data = {};
  for (const field of fields) {
    if (!(field in (body || {}))) continue;
    const value = body[field];
    if (value === "" || value === undefined) data[field] = null;
    else if (dates.includes(field)) data[field] = value === null ? null : new Date(value);
    else if (numbers.includes(field)) data[field] = value === null ? null : Number(value);
    else data[field] = value;
  }
  return data;
}

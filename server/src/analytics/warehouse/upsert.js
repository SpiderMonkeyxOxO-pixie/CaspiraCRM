// Backend Phase 12 — idempotent batch upserts into fact tables. Table and
// column names come only from the server's source definitions (never from a
// request); every value is a bound parameter, cast to the column's own type
// (read once from the catalog). A retried batch updates the same rows
// (unique organization + source key) instead of duplicating them.
import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma.js";

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const q = (name) => { if (!IDENT.test(name)) throw new Error(`Invalid identifier ${name}`); return Prisma.raw(`"${name}"`); };
const CASTS = { numeric: "numeric", int4: "integer", int8: "bigint", bool: "boolean", date: "date", timestamp: "timestamp(3)", timestamptz: "timestamptz", jsonb: "jsonb", json: "json", text: "text", float8: "double precision" };
const typeCache = new Map();

async function columnTypes(table, db) {
  if (typeCache.has(table)) return typeCache.get(table);
  const rows = await db.$queryRaw`SELECT column_name, udt_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ${table}`;
  if (!rows.length) throw new Error(`Unknown warehouse table ${table}`);
  const types = Object.fromEntries(rows.map((r) => [r.column_name, CASTS[r.udt_name] || "text"]));
  typeCache.set(table, types);
  return types;
}

const valueOf = (v, type) => {
  if (v === null || v === undefined) return null;
  if (type === "jsonb" || type === "json") return typeof v === "string" ? v : JSON.stringify(v);
  if (type === "numeric") return String(v);
  return v;
};

// rows: plain objects with the same keys. conflict: unique columns.
// → { inserted, updated }
export async function batchUpsert(table, rows, conflict, db = prisma, { chunk = 200 } = {}) {
  if (!rows.length) return { inserted: 0, updated: 0 };
  const types = await columnTypes(table, db);
  const cols = ["id", ...Object.keys(rows[0]).filter((c) => c !== "id")];
  for (const c of cols) if (!types[c]) throw new Error(`Unknown column ${c} on ${table}`);
  const updateCols = cols.filter((c) => c !== "id" && !conflict.includes(c));
  let inserted = 0; let updated = 0;
  for (let i = 0; i < rows.length; i += chunk) {
    const part = rows.slice(i, i + chunk);
    const values = Prisma.join(part.map((r) => Prisma.sql`(${Prisma.join(cols.map((c) => {
      const v = c === "id" ? r.id || crypto.randomUUID() : valueOf(r[c], types[c]);
      return Prisma.sql`${v}::${Prisma.raw(types[c])}`;
    }))})`));
    const sql = Prisma.sql`INSERT INTO ${q(table)} (${Prisma.join(cols.map(q))}) VALUES ${values}
      ON CONFLICT (${Prisma.join(conflict.map(q))}) DO UPDATE SET ${Prisma.join(updateCols.map((c) => Prisma.sql`${q(c)} = EXCLUDED.${q(c)}`))}, "loadedAt" = now()
      RETURNING (xmax = 0) AS inserted`;
    const out = await db.$queryRaw(sql);
    for (const r of out) { if (r.inserted) inserted += 1; else updated += 1; }
  }
  return { inserted, updated };
}

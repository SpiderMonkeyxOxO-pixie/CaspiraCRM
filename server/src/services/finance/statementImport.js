// Backend Phase 6 (full spec) — bank statement CSV import: parse, map and
// validate WITHOUT saving (preview), then save atomically on confirm.
//
// Bounded (size and rows); cell text is data only — nothing is evaluated,
// and text starting with = + @ (spreadsheet formula triggers) is stored with
// a leading apostrophe so it can never run if exported. Duplicates are
// caught by file checksum and by a per-line fingerprint. There is no bank
// connection: a person uploads what their bank gave them.
import crypto from "node:crypto";
import { Prisma } from "@prisma/client";

const { Decimal } = Prisma;
export const MAX_CSV_BYTES = 1_000_000;
export const MAX_ROWS = 5000;
export const DATE_FORMATS = ["YYYY-MM-DD", "DD/MM/YYYY", "MM/DD/YYYY"];

// RFC 4180-style parser: quoted fields, escaped quotes, CRLF/LF.
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i += 1; } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === ",") { row.push(field); field = ""; } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field); field = "";
      if (row.some((v) => v.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((v) => v.trim() !== "")) rows.push(row);
  return rows;
}

export const safeText = (value, max = 500) => {
  const t = String(value ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, max);
  return /^[=+@\t\r]/.test(t) ? `'${t}` : t;
};

export function parseStatementDate(value, format) {
  const v = String(value || "").trim();
  let y;
  let m;
  let d;
  if (format === "YYYY-MM-DD") [y, m, d] = (v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/) || []).slice(1);
  else if (format === "DD/MM/YYYY") [d, m, y] = (v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/) || []).slice(1);
  else if (format === "MM/DD/YYYY") [m, d, y] = (v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/) || []).slice(1);
  if (!y) return null;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  return date.getUTCMonth() === Number(m) - 1 && date.getUTCDate() === Number(d) ? date : null;
}

// "1,234.56" / "(12.00)" / "-12" → Decimal, or null.
export function parseStatementAmount(value) {
  let v = String(value ?? "").trim().replace(/[\s,]/g, "");
  if (!v) return null;
  let negative = false;
  if (/^\(.*\)$/.test(v)) { negative = true; v = v.slice(1, -1); }
  if (!/^-?\d+(\.\d{1,2})?$/.test(v)) return null;
  const n = new Decimal(v);
  return negative ? n.negated() : n;
}

export const checksumOf = (text) => crypto.createHash("sha256").update(text).digest("hex");

// Parses and validates; returns { headers, lines, errors, checksum }.
// mapping: { date, description, amount } or { date, description, debit, credit },
// plus optional reference, valueDate, balance — each a header name.
export function buildStatementLines(csvText, { mapping = {}, dateFormat = "YYYY-MM-DD", currency, financialAccountId }) {
  if (typeof csvText !== "string" || !csvText.trim()) throw new RangeError("The CSV is empty.");
  if (Buffer.byteLength(csvText, "utf8") > MAX_CSV_BYTES) throw new RangeError(`The file is larger than ${MAX_CSV_BYTES / 1_000_000} MB.`);
  if (!DATE_FORMATS.includes(dateFormat)) throw new RangeError(`dateFormat must be one of ${DATE_FORMATS.join(", ")}.`);
  const rows = parseCsv(csvText.replace(/^﻿/, ""));
  if (rows.length < 2) throw new RangeError("The CSV needs a header row and at least one line.");
  if (rows.length - 1 > MAX_ROWS) throw new RangeError(`At most ${MAX_ROWS} lines per import.`);
  const headers = rows[0].map((h) => h.trim());
  const col = (name) => (name ? headers.indexOf(name) : -1);
  const idx = { date: col(mapping.date), description: col(mapping.description), amount: col(mapping.amount), debit: col(mapping.debit), credit: col(mapping.credit), reference: col(mapping.reference), valueDate: col(mapping.valueDate), balance: col(mapping.balance) };
  if (idx.date < 0 || idx.description < 0) throw new RangeError("Map the date and description columns to headers in the file.");
  if (idx.amount < 0 && (idx.debit < 0 || idx.credit < 0)) throw new RangeError("Map either an amount column, or both debit and credit columns.");

  const errors = [];
  const lines = [];
  const seen = new Map();
  rows.slice(1).forEach((cells, i) => {
    const rowNumber = i + 2;
    const cell = (k) => (idx[k] >= 0 ? cells[idx[k]] : undefined);
    const transactionDate = parseStatementDate(cell("date"), dateFormat);
    if (!transactionDate) { errors.push({ rowNumber, message: `Date "${safeText(cell("date"), 40)}" isn't ${dateFormat}.` }); return; }
    let amount;
    let direction;
    if (idx.amount >= 0) {
      const a = parseStatementAmount(cell("amount"));
      if (!a || a.isZero()) { errors.push({ rowNumber, message: "Amount is missing or not a number." }); return; }
      direction = a.isNegative() ? "Debit" : "Credit";
      amount = a.abs();
    } else {
      const debit = parseStatementAmount(cell("debit"));
      const credit = parseStatementAmount(cell("credit"));
      if ((debit && !debit.isZero()) === (credit && !credit.isZero())) { errors.push({ rowNumber, message: "Exactly one of debit or credit must have an amount." }); return; }
      direction = debit && !debit.isZero() ? "Debit" : "Credit";
      amount = (direction === "Debit" ? debit : credit).abs();
    }
    const description = safeText(cell("description"));
    if (!description) { errors.push({ rowNumber, message: "Description is empty." }); return; }
    const reference = safeText(cell("reference"), 120) || null;
    const valueDate = cell("valueDate") ? parseStatementDate(cell("valueDate"), dateFormat) : null;
    const balance = cell("balance") ? parseStatementAmount(cell("balance")) : null;
    // Identical lines on the same day get an occurrence number, so a file
    // can hold two real identical transactions while a re-import is caught.
    const base = [financialAccountId, transactionDate.toISOString().slice(0, 10), direction, amount.toFixed(2), reference || "", description.toLowerCase()].join("|");
    const occurrence = (seen.get(base) || 0) + 1;
    seen.set(base, occurrence);
    const fingerprint = crypto.createHash("sha256").update(`${base}|${occurrence}`).digest("hex");
    lines.push({ rowNumber, transactionDate, valueDate, description, reference, direction, amount, currency, runningBalance: balance, fingerprint });
  });
  return { headers, lines, errors, checksum: checksumOf(csvText) };
}

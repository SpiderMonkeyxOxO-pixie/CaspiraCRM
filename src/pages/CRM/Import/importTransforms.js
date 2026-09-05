// Pure, optional per-column transformations. Every transform is preview-only
// against parsed values — the original uploaded file is never modified, and
// each is shown as "original value → transformed preview" before it's
// applied to the working (in-memory) import rows.

export function trimWhitespace(value) {
  return (value ?? "").toString().trim();
}

export function normalizeEmailCase(value) {
  return (value ?? "").toString().trim().toLowerCase();
}

export function normalizePhoneFormat(value) {
  const raw = (value ?? "").toString().trim();
  if (!raw) return raw;
  // Preserves a leading "+" and any leading zeros, strips everything else
  // that isn't a digit — deliberately not reformatting into a specific
  // regional pattern, since the fixture data itself uses varied formats.
  const plus = raw.startsWith("+") ? "+" : "";
  return plus + raw.replace(/[^\d]/g, "");
}

export function splitFullName(value) {
  const raw = (value ?? "").toString().trim();
  if (!raw) return { firstName: "", lastName: "" };
  const parts = raw.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

export function combineFirstLastName(firstName, lastName) {
  return `${firstName || ""} ${lastName || ""}`.trim();
}

// Accepts common spreadsheet date shapes (YYYY-MM-DD, MM/DD/YYYY, DD/MM/YYYY,
// D-M-YYYY) and normalizes to YYYY-MM-DD. Falls back to the original text
// when it can't confidently parse it — validation flags the row instead.
export function standardizeDate(value) {
  const raw = (value ?? "").toString().trim();
  if (!raw) return raw;
  const isoAttempt = new Date(raw);
  const slashMatch = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (slashMatch) {
    const [, a, b, y] = slashMatch;
    const year = y.length === 2 ? `20${y}` : y;
    const dayFirst = Number(a) > 12;
    const month = dayFirst ? b : a;
    const day = dayFirst ? a : b;
    const d = new Date(`${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  if (!Number.isNaN(isoAttempt.getTime())) return isoAttempt.toISOString().slice(0, 10);
  return raw;
}

// Accepts "45", "45%" or a 0–1 fraction and normalizes to a plain 0–100 number string.
export function convertPercentValue(value) {
  const raw = (value ?? "").toString().trim();
  if (!raw) return raw;
  const wasPercentString = raw.includes("%");
  const num = Number(raw.replace("%", "").trim());
  if (Number.isNaN(num)) return raw;
  if (!wasPercentString && num > 0 && num <= 1) return String(Math.round(num * 1000) / 10);
  return String(num);
}

export function splitTags(value) {
  return (value ?? "").toString().split(",").map((t) => t.trim()).filter(Boolean);
}

export function replaceBlankWithDefault(value, defaultValue) {
  const isBlank = value === undefined || value === null || value.toString().trim() === "";
  return isBlank ? (defaultValue ?? "") : value;
}

// Simple, single-value transforms usable directly from a per-column select.
// splitFullName/combineFirstLastName are handled specially by the row
// builder (they involve more than one field) rather than through this list.
export const TRANSFORM_TYPES = [
  { key: "trim", label: "Trim whitespace", apply: (v) => trimWhitespace(v) },
  { key: "lowercaseEmail", label: "Normalize email case", apply: (v) => normalizeEmailCase(v) },
  { key: "normalizePhone", label: "Normalize phone formatting", apply: (v) => normalizePhoneFormat(v) },
  { key: "standardizeDate", label: "Standardize date format (YYYY-MM-DD)", apply: (v) => standardizeDate(v) },
  { key: "convertPercent", label: "Convert percentage value", apply: (v) => convertPercentValue(v) },
  { key: "splitTags", label: "Split comma-separated tags", apply: (v) => splitTags(v).join(", ") },
  { key: "defaultBlank", label: "Replace blank with a default value", apply: (v, ctx) => replaceBlankWithDefault(v, ctx?.defaultValue) },
];

export function applyTransform(key, value, ctx) {
  const t = TRANSFORM_TYPES.find((x) => x.key === key);
  return t ? t.apply(value, ctx) : value;
}

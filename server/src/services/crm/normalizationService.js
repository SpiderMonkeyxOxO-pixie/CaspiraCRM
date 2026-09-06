// Centralized normalization for every field the Backend Phase 2 spec asks
// to be validated/normalized. Used by every CRM controller before a write,
// and by duplicateDetectionService.js to compare records consistently.
// Deliberately pure functions — no I/O, no Prisma — so they're trivial to
// unit test and never accidentally couple normalization to a specific model.

export function normalizeEmail(email) {
  if (!email) return null;
  const trimmed = email.trim().toLowerCase();
  return trimmed || null;
}

export function normalizePhone(phone) {
  if (!phone) return null;
  // Keep a leading + (international prefix), strip everything else that
  // isn't a digit — "(555) 123-4567" and "555.123.4567" normalize the same.
  const digits = phone.replace(/[^\d+]/g, "");
  const hasPlus = digits.startsWith("+");
  const onlyDigits = digits.replace(/\+/g, "");
  if (!onlyDigits) return null;
  return hasPlus ? `+${onlyDigits}` : onlyDigits;
}

export function normalizeDomain(websiteOrDomain) {
  if (!websiteOrDomain) return null;
  let value = websiteOrDomain.trim().toLowerCase();
  value = value.replace(/^https?:\/\//, "").replace(/^www\./, "");
  value = value.split("/")[0].split("?")[0];
  return value || null;
}

export function normalizeName(name) {
  if (!name) return null;
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

// Tag names: unique per organization after normalization — lowercase,
// collapsed whitespace, no leading/trailing punctuation noise.
export function normalizeTagName(name) {
  if (!name) return null;
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

// A small allowlist, not "accept arbitrary CSS" — the spec explicitly
// forbids accepting arbitrary CSS through the tag color field. These are
// named design tokens the frontend already knows how to render, not raw
// color/style values.
export const ALLOWED_TAG_COLOR_TOKENS = new Set([
  "slate", "gray", "red", "orange", "amber", "yellow", "lime", "green",
  "emerald", "teal", "cyan", "sky", "blue", "indigo", "violet", "purple",
  "fuchsia", "pink", "rose",
]);

export function isValidTagColorToken(token) {
  return token == null || ALLOWED_TAG_COLOR_TOKENS.has(token);
}

// Minimal HTML sanitization for CRM note bodies — the spec forbids raw
// unsanitized HTML. This is intentionally conservative: strip all tags
// rather than attempt an allowlist-based rich-text sanitizer, since notes
// are plain-text content in every existing frontend form today.
export function sanitizeNoteBody(body) {
  if (!body) return "";
  return body.replace(/<[^>]*>/g, "").trim();
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function isValidEmail(email) {
  return !email || EMAIL_PATTERN.test(email);
}

const ISO_CURRENCY_PATTERN = /^[A-Z]{3}$/;
export function isValidCurrencyCode(code) {
  return !code || ISO_CURRENCY_PATTERN.test(code);
}

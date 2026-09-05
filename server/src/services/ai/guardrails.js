// Lightweight, dev-app-appropriate safeguards around real paid API calls —
// explicitly not a production rate limiter or a full NLP validator (see
// the plan's "explicitly deferred" section for what a hardened version
// would add).

export const COOLDOWN_MS = 8000;
const lastRequestAt = new Map(); // in-memory, per-process — resets on restart, not multi-instance-safe

class CooldownError extends Error {
  constructor(waitMs) {
    super(`Please wait ${Math.ceil(waitMs / 1000)}s before requesting another AI response.`);
    this.status = 429;
  }
}

export function checkCooldown(userId) {
  const now = Date.now();
  const last = lastRequestAt.get(userId);
  if (last && now - last < COOLDOWN_MS) throw new CooldownError(COOLDOWN_MS - (now - last));
  lastRequestAt.set(userId, now);
}

// Test-only escape hatch — production code never calls this.
export function _resetCooldowns() {
  lastRequestAt.clear();
}

export const MAX_RECORDS_PER_TYPE = 40;

export function truncateRecords(records) {
  let truncated = false;
  const result = {};
  for (const [key, value] of Object.entries(records || {})) {
    if (Array.isArray(value) && value.length > MAX_RECORDS_PER_TYPE) {
      result[key] = value.slice(0, MAX_RECORDS_PER_TYPE);
      truncated = true;
    } else {
      result[key] = value;
    }
  }
  return { records: result, truncated };
}

// Extracts number-like tokens ($1,234.56 / 12,345 / 3.5%) from a string,
// normalized (no $, comma, %) for comparison. The decimal part requires a
// digit after the dot — otherwise a sentence-ending period right after a
// number ("...$210,900.") gets misread as a decimal point.
function extractNumbers(text) {
  const matches = String(text).match(/\$?-?\d[\d,]*(\.\d+)?%?/g) || [];
  return matches.map((m) => m.replace(/[$,%]/g, "")).filter((m) => m.length > 0 && !Number.isNaN(Number(m)));
}

// Heuristic, fail-closed check: every number-like token in the model's
// narrative must also appear somewhere in the verified facts payload.
// Not a full parser — good enough to catch a fabricated figure without
// hand-rolling NLP, and callers fall back to the deterministic summary
// whenever this returns verified: false.
export function verifyNoNewNumbers(narrativeText, facts) {
  const factNumbers = new Set(extractNumbers(JSON.stringify(facts)));
  const narrativeNumbers = extractNumbers(narrativeText);
  const unverifiedNumbers = narrativeNumbers.filter((n) => !factNumbers.has(n));
  return { verified: unverifiedNumbers.length === 0, unverifiedNumbers };
}

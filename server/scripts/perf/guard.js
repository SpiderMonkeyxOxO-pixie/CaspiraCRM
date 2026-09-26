// Refuses to point performance tooling at the wrong database. Performance
// data and load tests belong in local, CI, staging or isolated
// environments — never production (Backend Phase 14 boundaries).
export const PERF_TARGETS = ["local", "ci", "staging", "isolated"];
// A benchmark database must say so in its name.
const SAFE_DB_NAME = /(perf|bench|staging|stage|test|dev)/i;

export function databaseName(url) {
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\//, "")) || null;
  } catch {
    return null;
  }
}

// Throws unless the environment is clearly a non-production target.
// `requireIsolated` is for breakpoint runs, which may only use a dedicated
// environment nobody else depends on.
export function assertPerfTarget(env = process.env, { requireIsolated = false } = {}) {
  const target = env.PERF_TARGET;
  if (!target) throw new Error(`Set PERF_TARGET to one of: ${PERF_TARGETS.join(", ")}.`);
  if (!PERF_TARGETS.includes(target)) throw new Error(`PERF_TARGET "${target}" is not allowed. Performance tooling never runs against production.`);
  if (requireIsolated && target !== "isolated") throw new Error("Breakpoint tests run only with PERF_TARGET=isolated (a dedicated environment nobody else uses).");
  const name = databaseName(env.DATABASE_URL || "");
  if (!name) throw new Error("DATABASE_URL is missing or unreadable.");
  if (!SAFE_DB_NAME.test(name)) throw new Error(`Database "${name}" doesn't look like a benchmark database (its name must contain perf, bench, staging, test or dev). Refusing.`);
  if (env.PERF_DATABASE_CONFIRM !== name) throw new Error(`Confirm the target by setting PERF_DATABASE_CONFIRM=${name}.`);
  return { target, database: name };
}

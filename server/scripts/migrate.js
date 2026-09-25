// Backend Phase 13 — production migration runner (the `migrator` image).
//
// Runs as the dedicated migration identity (schema owner), never the runtime
// role. Preflight before touching the schema:
//   * connectivity as the migration role;
//   * no unfinished/failed migration left from an earlier attempt;
//   * the database is at the EXPECTED schema version (EXPECTED_SCHEMA_VERSION,
//     from the approved deployment plan) — refuses to run on a surprise state;
//   * every applied migration is known to this release (ordering);
//   * required extensions are available;
//   * lock_timeout bounds how long DDL may wait on application locks.
// Prisma's own advisory lock prevents two migrators running at once. There is
// no automatic downgrade: a failed migration stops here and the deployment
// becomes Manual Recovery Required (runbook 10).
//
// Output: one JSON line with before/after versions for deploy.sh to report.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readSecret } from "../src/config/secrets.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fail = (message, extra = {}) => { console.log(JSON.stringify({ ok: false, message, ...extra })); process.exit(1); };

function migrationUrl() {
  const direct = readSecret("MIGRATION_DATABASE_URL").value;
  const password = readSecret("DB_MIGRATOR_PASSWORD").value;
  let url = direct;
  // Development and test (CI) databases have one application user: use
  // DATABASE_URL there. Staging and production always use the migration identity.
  const strict = ["staging", "production"].includes(process.env.APP_ENV);
  if (!url && !strict && !process.env.DB_HOST && process.env.DATABASE_URL) url = process.env.DATABASE_URL;
  if (!url) {
    const { DB_HOST, DB_NAME, DB_MIGRATOR_USER = "caspira_owner", DB_PORT = "5432" } = process.env;
    if (!DB_HOST || !DB_NAME || !password) fail("Migration database settings are missing (DB_HOST, DB_NAME, DB_MIGRATOR_PASSWORD).");
    url = `postgresql://${encodeURIComponent(DB_MIGRATOR_USER)}:${encodeURIComponent(password)}@${DB_HOST}:${DB_PORT}/${encodeURIComponent(DB_NAME)}?schema=public`;
  }
  const u = new URL(url);
  // DDL waits at most this long for locks held by the running application.
  u.searchParams.set("options", `-c lock_timeout=${process.env.MIGRATION_LOCK_TIMEOUT || "10s"} -c statement_timeout=${process.env.MIGRATION_STATEMENT_TIMEOUT || "15min"}`);
  return u.toString();
}

async function main() {
  const url = migrationUrl();
  process.env.DATABASE_URL = url;
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  // A migration is any folder with a migration.sql (Prisma's rule), including 0001_baseline.
  const migDir = path.join(root, "prisma/migrations");
  const known = fs.readdirSync(migDir).filter((d) => fs.existsSync(path.join(migDir, d, "migration.sql"))).sort();
  try {
    const exists = await prisma.$queryRaw`SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS present`;
    const applied = exists[0].present ? (await prisma.$queryRaw`SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY migration_name`) : [];
    const unfinished = applied.filter((m) => !m.finished_at && !m.rolled_back_at);
    if (unfinished.length) fail("An earlier migration did not finish. Follow the failed-migration runbook before retrying.", { unfinished: unfinished.map((m) => m.migration_name) });
    const done = applied.filter((m) => m.finished_at && !m.rolled_back_at).map((m) => m.migration_name);
    const current = done[done.length - 1] || null;
    const expected = process.env.EXPECTED_SCHEMA_VERSION;
    if (expected && expected !== (current || "none")) fail("The database is not at the expected schema version.", { expected, current });
    const unknown = done.filter((m) => !known.includes(m));
    if (unknown.length) fail("The database has migrations this release doesn't know (a newer release was deployed). Refusing to continue.", { unknown });
    for (const ext of String(process.env.REQUIRED_EXTENSIONS || "").split(",").map((s) => s.trim()).filter(Boolean)) {
      const r = await prisma.$queryRaw`SELECT count(*)::int AS n FROM pg_available_extensions WHERE name = ${ext}`;
      if (!r[0].n) fail(`Required extension ${ext} is not available.`);
    }
    const pending = known.filter((m) => !done.includes(m));
    if (process.argv.includes("--check")) { console.log(JSON.stringify({ ok: true, check: true, current, pending })); return; }
    const prismaCli = path.join(root, "node_modules/prisma/build/index.js");
    const run = spawnSync(process.execPath, [prismaCli, "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: url }, encoding: "utf8" });
    // Prisma's output can contain the connection URL; never echo it.
    if (run.status !== 0) fail("Migration failed. The deployment must not continue; see the failed-migration runbook.", { current, pending: pending.length });
    const after = (await prisma.$queryRaw`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`).map((m) => m.migration_name);
    console.log(JSON.stringify({ ok: true, before: current, after: after[after.length - 1] || null, applied: pending }));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(() => fail("Migration runner error."));

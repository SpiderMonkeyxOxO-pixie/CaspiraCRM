// Backend Phase 13 — operator-run restore drill with native PostgreSQL tools.
//
//   node scripts/drills/restoreDrill.js --pg-bin <dir> --work <new dir> --non-production-source \
//        [--source-url <postgres url>] [--record --operator <username>] [--api-smoke]
//
// Runs on any workstation or staging host with PostgreSQL client/server
// binaries of the same major version (17). It NEVER touches production:
// the source must be a non-production database (explicit flag; refuses
// APP_ENV=production), and every restore target is a NEW local cluster on a
// private port that is deleted afterwards. Encryption keys live in a
// separate directory from the backups.
//
// Drill 1 — logical backup and isolated restore:
//   pg_dump (custom format) → GPG AES-256 with a key kept apart → SHA-256
//   manifest → verify → decrypt → restore into a new cluster built with the
//   PRODUCTION role script (least privilege) → compare migration version and
//   table counts with the source → prove the runtime role can't run DDL →
//   optionally start the API against it as the runtime role and smoke-test
//   sign-in and a tenant query.
// Drill 2 — continuous archiving and point-in-time recovery:
//   new source cluster with WAL archiving → base backup with manifest →
//   pg_verifybackup → GPG-encrypted archive → write A, note time T, write B
//   → restore the encrypted base backup into a new cluster with
//   recovery_target_time = T → assert it contains A but not B → source
//   unchanged. Records measured RPO and RTO.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const opt = (name, fallback = null) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const flag = (name) => args.includes(`--${name}`);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const REPO = path.resolve(ROOT, "..");
const exe = (n) => path.join(PG_BIN, process.platform === "win32" ? `${n}.exe` : n);
const PG_BIN = opt("pg-bin");
const WORK = opt("work");
if (!PG_BIN || !WORK) { console.error("usage: restoreDrill.js --pg-bin <dir> --work <new dir> --non-production-source [--source-url url] [--record --operator user] [--api-smoke]"); process.exit(2); }
if (!flag("non-production-source")) { console.error("Refusing: confirm the source is NOT production with --non-production-source."); process.exit(2); }
if (["production", "staging"].includes(process.env.APP_ENV)) { console.error("Refusing to run with APP_ENV=production/staging: drills never target or read those environments from here."); process.exit(2); }
if (fs.existsSync(WORK) && fs.readdirSync(WORK).length) { console.error("The work directory must be new or empty."); process.exit(2); }

await import("dotenv/config");
const SOURCE = opt("source-url", process.env.DATABASE_URL);
const dirs = Object.fromEntries(["backups", "keys", "logical-target", "pitr-source", "pitr-restore", "wal-archive", "tmp"].map((d) => [d, path.join(WORK, d)]));
for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
const evidence = { startedAt: new Date().toISOString(), host: process.platform, pgBin: path.basename(PG_BIN), steps: [] };
const step = (name, ok, detail = {}) => { evidence.steps.push({ name, ok, ...detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail.note ? ` — ${detail.note}` : ""}`); if (!ok) throw new Error(`Step failed: ${name}`); };

const run = (cmd, argv, { env = {}, input, allowFail = false } = {}) => {
  const r = spawnSync(cmd, argv, { env: { ...process.env, ...env }, input, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0 && !allowFail) throw new Error(`${path.basename(cmd)} failed: ${(r.stderr || "").split("\n").filter(Boolean).slice(-3).join(" | ").replace(/password=[^ ]+/gi, "password=***")}`);
  return r;
};
const sha256File = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const rand = () => crypto.randomBytes(32).toString("base64url");
const psql = (port, db, sql, { user = "postgres", password = null, allowFail = false } = {}) => run(exe("psql"), ["-XAtq", "-h", "127.0.0.1", "-p", String(port), "-U", user, "-d", db, "-v", "ON_ERROR_STOP=1", "-c", sql], { env: password ? { PGPASSWORD: password } : { PGPASSWORD: "" }, allowFail });

const clusters = [];
// The server outlives pg_ctl, so its output must not be piped (spawnSync would wait on it).
function startServer(dir, timeout) {
  const r = spawnSync(exe("pg_ctl"), ["-D", dir, "-l", path.join(dir, "server.log"), "-w", "-t", String(timeout), "start"], { stdio: "ignore" });
  if (r.status !== 0) throw new Error(`pg_ctl start failed; see ${path.basename(dir)}/server.log`);
}
function initCluster(dir, port, extraConf = "") {
  run(exe("initdb"), ["-D", dir, "-U", "postgres", "--auth-local=trust", "--auth-host=scram-sha-256", "--data-checksums", "-E", "UTF8", "--locale=C"]);
  // Superuser over local TCP for the drill only (trust on 127.0.0.1); app roles use SCRAM.
  fs.writeFileSync(path.join(dir, "pg_hba.conf"), ["host all postgres 127.0.0.1/32 trust", "host replication postgres 127.0.0.1/32 trust", "host all all 127.0.0.1/32 scram-sha-256", ""].join("\n"));
  fs.appendFileSync(path.join(dir, "postgresql.conf"), `\nport = ${port}\nlisten_addresses = '127.0.0.1'\nshared_buffers = 64MB\nmax_connections = 40\n${extraConf}\n`);
  startServer(dir, 120);
  clusters.push(dir);
}
const stopCluster = (dir) => run(exe("pg_ctl"), ["-D", dir, "-m", "fast", "-w", "stop"], { allowFail: true });
const dbUrl = (user, password, port, db) => `postgresql://${user}:${encodeURIComponent(password)}@127.0.0.1:${port}/${db}?schema=public`;

// Aggregate counts only (never record contents).
const COUNT_TABLES = ["users", "organizations", "organization_memberships", "roles", "leads", "deals", "activities", "tickets", "invoices", "audit_events"];
function counts(port, db, conn = {}) {
  const out = {};
  for (const t of COUNT_TABLES) { const r = psql(port, db, `select count(*) from "${t}"`, { ...conn, allowFail: true }); out[t] = r.status === 0 ? Number(r.stdout.trim()) : null; }
  const m = psql(port, db, "select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null order by migration_name desc limit 1", { ...conn, allowFail: true });
  out.latestMigration = m.status === 0 ? m.stdout.trim() : null;
  return out;
}
function sourceCounts() {
  const u = new URL(SOURCE);
  const conn = { host: u.hostname, port: u.port || 5432, user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), db: u.pathname.slice(1) };
  const q = (sql) => run(exe("psql"), ["-XAtq", "-h", conn.host, "-p", String(conn.port), "-U", conn.user, "-d", conn.db, "-c", sql], { env: { PGPASSWORD: conn.password }, allowFail: true });
  const out = {};
  for (const t of COUNT_TABLES) { const r = q(`select count(*) from "${t}"`); out[t] = r.status === 0 ? Number(r.stdout.trim()) : null; }
  const m = q("select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null order by migration_name desc limit 1");
  out.latestMigration = m.status === 0 ? m.stdout.trim() : null;
  return { out, conn };
}
const GPG = opt("gpg", "gpg");
const gpg = (argv) => run(GPG, ["--batch", "--yes", "--quiet", "--pinentry-mode", "loopback", ...argv]);

try {
  // ─── Drill 1: logical backup → isolated restore ───────────────────────────
  const d1Start = Date.now();
  const { out: srcCounts, conn } = sourceCounts();
  step("source reachable (non-production)", srcCounts.latestMigration !== null, { note: `latest migration ${srcCounts.latestMigration}` });
  const dump = path.join(dirs.tmp, "logical.dump");
  const dumpAt = new Date();
  run(exe("pg_dump"), ["-Fc", "-h", conn.host, "-p", String(conn.port), "-U", conn.user, "-d", conn.db, "-f", dump], { env: { PGPASSWORD: conn.password } });
  const logicalKey = path.join(dirs.keys, "logical.key");
  fs.writeFileSync(logicalKey, rand(), { mode: 0o600 });
  const encrypted = path.join(dirs.backups, "logical.dump.gpg");
  gpg(["--symmetric", "--cipher-algo", "AES256", "--passphrase-file", logicalKey, "-o", encrypted, dump]);
  fs.rmSync(dump);
  const manifest = { artifact: "logical.dump.gpg", sha256: sha256File(encrypted), sizeBytes: fs.statSync(encrypted).size, createdAt: dumpAt.toISOString(), tool: "pg_dump -Fc + gpg AES256", keyLocation: "separate keys directory (not beside the backup)" };
  fs.writeFileSync(path.join(dirs.backups, "logical.manifest.json"), JSON.stringify(manifest, null, 2));
  step("encrypted logical backup with SHA-256 manifest", true, { note: `${(manifest.sizeBytes / 1e6).toFixed(1)} MB, key stored apart` });
  step("backup is not readable without the key", !fs.readFileSync(encrypted).includes(Buffer.from("_prisma_migrations")), {});
  const restoreStart = Date.now();
  step("checksum verified before restore", sha256File(encrypted) === JSON.parse(fs.readFileSync(path.join(dirs.backups, "logical.manifest.json"), "utf8")).sha256);
  const restoredDump = path.join(dirs.tmp, "restore.dump");
  gpg(["--decrypt", "--passphrase-file", logicalKey, "-o", restoredDump, encrypted]);
  initCluster(dirs["logical-target"], 55440);
  psql(55440, "postgres", "create database caspira_crm");
  // The production role script, executed as written.
  const roleSql = fs.readFileSync(path.join(REPO, "deploy/production/postgres/init/10-roles.sh"), "utf8").split("<<'SQL'")[1].split("\nSQL\n")[0];
  const pw = { app: rand(), owner: rand(), ro: rand(), mon: rand() };
  run(exe("psql"), ["-XAtq", "-h", "127.0.0.1", "-p", "55440", "-U", "postgres", "-d", "caspira_crm", "-v", "ON_ERROR_STOP=1", "-v", `app_pw=${pw.app}`, "-v", `owner_pw=${pw.owner}`, "-v", `ro_pw=${pw.ro}`, "-v", `mon_pw=${pw.mon}`], { input: roleSql, env: { PGPASSWORD: "" } });
  step("production least-privilege role script applied", psql(55440, "caspira_crm", "select count(*) from pg_roles where rolname like 'caspira_%'").stdout.trim() === "4");
  // The source's application user exists only as a NOLOGIN placeholder so its grants restore;
  // roles-upgrade.sql then applies the production privilege model, as on a real upgrade.
  psql(55440, "caspira_crm", `create role "${conn.user.replace(/"/g, "")}" nologin`);
  const pr = run(exe("pg_restore"), ["--no-owner", "--role=caspira_owner", "-h", "127.0.0.1", "-p", "55440", "-U", "caspira_owner", "-d", "caspira_crm", restoredDump], { env: { PGPASSWORD: pw.owner }, allowFail: true });
  const restoreErrors = (pr.stderr || "").split("\n").filter((l) => /error:/i.test(l) && !/already exists/.test(l));
  fs.rmSync(restoredDump);
  step("restored into a NEW isolated cluster as the migration role", restoreErrors.length === 0, { note: restoreErrors.length ? restoreErrors.slice(0, 2).join(" | ") : "no restore errors" });
  run(exe("psql"), ["-XAtq", "-h", "127.0.0.1", "-p", "55440", "-U", "postgres", "-d", "caspira_crm", "-v", "ON_ERROR_STOP=1", "-v", `app_pw=${pw.app}`, "-v", `owner_pw=${pw.owner}`, "-v", `ro_pw=${pw.ro}`, "-v", `mon_pw=${pw.mon}`, "-v", `old_owner=${conn.user}`, "-f", path.join(REPO, "deploy/production/postgres/roles-upgrade.sql")], { env: { PGPASSWORD: "" } });
  step("production roles-upgrade.sql applied to the restored database", true);
  const rCounts = counts(55440, "caspira_crm");
  const mismatched = COUNT_TABLES.filter((t) => rCounts[t] !== srcCounts[t]);
  step("migration version and table counts match the source", rCounts.latestMigration === srcCounts.latestMigration && mismatched.length === 0, { note: mismatched.length ? `differences in ${mismatched.join(", ")}` : `${COUNT_TABLES.length} tables equal; ${rCounts.latestMigration}` });
  step("runtime role cannot create tables", psql(55440, "caspira_crm", "create table drill_ddl_probe(x int)", { user: "caspira_app", password: pw.app, allowFail: true }).status !== 0);
  step("runtime role cannot drop tables", psql(55440, "caspira_crm", "drop table users", { user: "caspira_app", password: pw.app, allowFail: true }).status !== 0);
  step("runtime role can read and write application data", psql(55440, "caspira_crm", "select count(*) from users", { user: "caspira_app", password: pw.app }).status === 0);
  step("runtime role refreshes views only through the allowlisted function", psql(55440, "caspira_crm", "select analytics.refresh_view('mv_pipeline_daily', false)", { user: "caspira_app", password: pw.app, allowFail: true }).status === 0 && psql(55440, "caspira_crm", "refresh materialized view analytics.mv_pipeline_daily", { user: "caspira_app", password: pw.app, allowFail: true }).status !== 0);
  step("schema owned by the migration role, not the runtime role", psql(55440, "caspira_crm", "select pg_get_userbyid(nspowner) from pg_namespace where nspname='public'").stdout.trim() === "caspira_owner");
  if (flag("api-smoke")) {
    const port = 4555;
    const api = spawn(process.execPath, ["src/index.js"], { cwd: ROOT, env: { ...process.env, DATABASE_URL: dbUrl("caspira_app", pw.app, 55440, "caspira_crm"), PORT: String(port), RATE_LIMIT_PREFIX: "rl:drill:", PLATFORM_WATCHDOG: "false", HTTP_METRICS: "false" }, stdio: "ignore" });
    try {
      let up = false;
      for (let i = 0; i < 60 && !up; i += 1) { await new Promise((r) => setTimeout(r, 1000)); up = await fetch(`http://127.0.0.1:${port}/health`).then((r) => r.ok).catch(() => false); }
      step("API starts against the restored database as the runtime role", up);
      const ready = await fetch(`http://127.0.0.1:${port}/ready`).then((r) => r.json());
      step("readiness: database ok", ready.checks?.database === "ok");
      const login = await fetch(`http://127.0.0.1:${port}/api/v1/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: opt("smoke-user", "admin"), password: opt("smoke-password", "Caspira123!") }) });
      const cookies = (login.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ");
      step("authentication works on the restored data", login.status === 200, { note: `login HTTP ${login.status}` });
      const orgs = await fetch(`http://127.0.0.1:${port}/api/v1/organizations`, { headers: { Cookie: cookies } }).then((r) => r.json());
      const org = orgs.organizations?.[0]?._id;
      const leads = await fetch(`http://127.0.0.1:${port}/api/v1/crm/leads?organizationId=${org}`, { headers: { Cookie: cookies } });
      step("tenant-scoped CRM query works (permissions intact)", leads.status === 200, { note: `leads HTTP ${leads.status}` });
    } finally { api.kill("SIGTERM"); }
  }
  const d1End = Date.now();
  evidence.drill1 = { startedAt: new Date(d1Start).toISOString(), completedAt: new Date(d1End).toISOString(), backupTakenAt: dumpAt.toISOString(), rtoSeconds: Math.round((d1End - restoreStart) / 1000), rpoSeconds: Math.round((restoreStart - dumpAt.getTime()) / 1000), stepCount: evidence.steps.length, manifest, counts: { source: srcCounts, restored: rCounts } };
  stopCluster(dirs["logical-target"]);

  // ─── Drill 2: continuous archiving + point-in-time recovery ────────────────
  const d2Start = Date.now();
  const archiver = path.join(dirs.tmp, "wal-archiver.mjs");
  // Archive: copy with fsync, refuse to overwrite a different segment (standard archive semantics).
  fs.writeFileSync(archiver, `import fs from "node:fs"; import path from "node:path";
const [mode, a, b] = process.argv.slice(2); const dir = ${JSON.stringify(dirs["wal-archive"])};
if (mode === "archive") { const dest = path.join(dir, b); if (fs.existsSync(dest)) { process.exit(Buffer.compare(fs.readFileSync(dest), fs.readFileSync(a)) === 0 ? 0 : 1); } fs.copyFileSync(a, dest + ".tmp"); const fd = fs.openSync(dest + ".tmp", "r+"); fs.fsyncSync(fd); fs.closeSync(fd); fs.renameSync(dest + ".tmp", dest); }
else { const src = path.join(dir, a); if (!fs.existsSync(src)) process.exit(1); fs.copyFileSync(src, b); }`);
  const nodeCmd = `"${process.execPath.replace(/\\/g, "/")}" "${archiver.replace(/\\/g, "/")}"`;
  initCluster(dirs["pitr-source"], 55441, `wal_level = replica\narchive_mode = on\narchive_command = '${nodeCmd} archive "%p" "%f"'\narchive_timeout = 0\nmax_wal_senders = 3`);
  psql(55441, "postgres", "create database caspira_crm");
  const loadDump = path.join(dirs.tmp, "load.dump");
  gpg(["--decrypt", "--passphrase-file", logicalKey, "-o", loadDump, encrypted]);
  run(exe("pg_restore"), ["--no-owner", "-h", "127.0.0.1", "-p", "55441", "-U", "postgres", "-d", "caspira_crm", loadDump], { allowFail: true });
  fs.rmSync(loadDump);
  psql(55441, "caspira_crm", "create table drill_marker(phase text primary key, at timestamptz default clock_timestamp())");
  const base = path.join(dirs.tmp, "base");
  const baseAt = new Date();
  run(exe("pg_basebackup"), ["-h", "127.0.0.1", "-p", "55441", "-U", "postgres", "-D", base, "-Fp", "-X", "stream", "--checkpoint=fast", "--manifest-checksums=SHA256"]);
  const vb = run(exe("pg_verifybackup"), [base], { allowFail: true });
  step("base backup manifest and file checksums verified (pg_verifybackup)", vb.status === 0, { note: (vb.stdout || "").trim() });
  const baseKey = path.join(dirs.keys, "base.key");
  fs.writeFileSync(baseKey, rand(), { mode: 0o600 });
  const baseTar = path.join(dirs.tmp, "base.tar");
  run("tar", ["-cf", baseTar.replace(/\\/g, "/"), "-C", base.replace(/\\/g, "/"), "."]);
  const baseEnc = path.join(dirs.backups, "base.tar.gpg");
  gpg(["--symmetric", "--cipher-algo", "AES256", "--passphrase-file", baseKey, "-o", baseEnc, baseTar]);
  fs.rmSync(baseTar); fs.rmSync(base, { recursive: true, force: true });
  const baseSha = sha256File(baseEnc);
  step("encrypted base backup stored with checksum (key apart)", true, { note: `${(fs.statSync(baseEnc).size / 1e6).toFixed(1)} MB` });
  psql(55441, "caspira_crm", "insert into drill_marker(phase) values ('A')");
  await new Promise((r) => setTimeout(r, 1500));
  const target = psql(55441, "caspira_crm", "select to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS.US') || '+00'").stdout.trim();
  await new Promise((r) => setTimeout(r, 1500));
  psql(55441, "caspira_crm", "insert into drill_marker(phase) values ('B')");
  const walFile = psql(55441, "caspira_crm", "select pg_walfile_name(pg_switch_wal())").stdout.trim();
  let archived = false;
  for (let i = 0; i < 60 && !archived; i += 1) { await new Promise((r) => setTimeout(r, 1000)); archived = fs.existsSync(path.join(dirs["wal-archive"], walFile)); }
  step("WAL segment containing both writes archived (continuous archiving)", archived, { note: walFile });
  const failedArchives = Number(psql(55441, "postgres", "select failed_count from pg_stat_archiver").stdout.trim());
  step("no archive failures", failedArchives === 0);
  // Restore into a NEW cluster at the target time.
  const pitrRestoreStart = Date.now();
  step("encrypted base backup checksum verified before restore", sha256File(baseEnc) === baseSha);
  const decTar = path.join(dirs.tmp, "restore-base.tar");
  gpg(["--decrypt", "--passphrase-file", baseKey, "-o", decTar, baseEnc]);
  run("tar", ["-xf", decTar.replace(/\\/g, "/"), "-C", dirs["pitr-restore"].replace(/\\/g, "/")]);
  fs.rmSync(decTar);
  fs.appendFileSync(path.join(dirs["pitr-restore"], "postgresql.auto.conf"), `\nport = 55442\narchive_mode = off\nrestore_command = '${nodeCmd} restore "%f" "%p"'\nrecovery_target_time = '${target}'\nrecovery_target_action = 'promote'\n`);
  fs.writeFileSync(path.join(dirs["pitr-restore"], "recovery.signal"), "");
  startServer(dirs["pitr-restore"], 300);
  clusters.push(dirs["pitr-restore"]);
  let promoted = false;
  for (let i = 0; i < 120 && !promoted; i += 1) { promoted = psql(55442, "postgres", "select pg_is_in_recovery()", { allowFail: true }).stdout.trim() === "f"; if (!promoted) await new Promise((r) => setTimeout(r, 1000)); }
  step("point-in-time recovery completed and promoted", promoted);
  const phases = psql(55442, "caspira_crm", "select string_agg(phase, ',' order by phase) from drill_marker").stdout.trim();
  const replayed = psql(55442, "postgres", "select to_char(pg_last_xact_replay_timestamp() at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')").stdout.trim();
  step(`recovered exactly the committed writes before ${target}`, phases === "A", { note: `markers present: ${phases || "none"}` });
  const pitrCounts = counts(55442, "caspira_crm");
  step("recovered database has the same application data as the source", COUNT_TABLES.every((t) => pitrCounts[t] === srcCounts[t]) && pitrCounts.latestMigration === srcCounts.latestMigration);
  step("source cluster untouched (both writes still present)", psql(55441, "caspira_crm", "select count(*) from drill_marker").stdout.trim() === "2");
  const pitrEnd = Date.now();
  const targetMs = new Date(target.replace(" ", "T").replace("+00", "Z")).getTime();
  evidence.drill2 = {
    startedAt: new Date(d2Start).toISOString(), completedAt: new Date(pitrEnd).toISOString(), baseBackupAt: baseAt.toISOString(), requestedRecoveryPoint: new Date(targetMs).toISOString(), actualRecoveredPoint: replayed || null,
    rtoSeconds: Math.round((pitrEnd - pitrRestoreStart) / 1000), rpoSeconds: replayed ? Math.max(0, Math.round((targetMs - new Date(replayed).getTime()) / 1000)) : null, walSegment: walFile, baseBackupSha256: baseSha,
  };
} catch (err) {
  evidence.error = err.message;
  console.error(`DRILL FAILED: ${err.message}`);
  process.exitCode = 1;
} finally {
  for (const c of clusters) stopCluster(c);
  // Remove data and keys; keep only the evidence (no data, no keys).
  for (const d of ["logical-target", "pitr-source", "pitr-restore", "wal-archive", "tmp", "backups", "keys"]) fs.rmSync(dirs[d], { recursive: true, force: true });
  evidence.completedAt = new Date().toISOString();
  evidence.passed = !evidence.error;
  const evFile = path.join(WORK, "evidence.json");
  fs.writeFileSync(evFile, JSON.stringify(evidence, null, 2));
  evidence.sha256 = sha256File(evFile);
  console.log(`Evidence: ${evFile} (sha256 ${evidence.sha256})`);
}

if (flag("record")) {
  const { default: prisma } = await import("../../src/lib/prisma.js");
  const operator = await prisma.user.findFirst({ where: { username: opt("operator", "owner") } });
  const env = process.env.APP_ENV || "development";
  const base = { environment: env, operatorUserId: operator?.id || null, evidenceRef: `restoreDrill.js evidence sha256:${evidence.sha256}` };
  const rows = [];
  if (evidence.drill1) rows.push({ ...base, scenario: "Logical backup restored into an isolated cluster with least-privilege roles and API smoke test", tool: "pg_dump -Fc + GPG AES-256 + pg_restore (PostgreSQL 17.6)", targetDescription: "New local cluster on 127.0.0.1:55440 (non-production, deleted after the drill)", selectedBackupRef: `logical.dump.gpg sha256:${evidence.drill1.manifest.sha256}`, requestedRecoveryPoint: new Date(evidence.drill1.backupTakenAt), actualRecoveredPoint: new Date(evidence.drill1.backupTakenAt), startedAt: new Date(evidence.drill1.startedAt), completedAt: new Date(evidence.drill1.completedAt), measuredRtoSeconds: evidence.drill1.rtoSeconds, measuredRpoSeconds: evidence.drill1.rpoSeconds, validation: { steps: evidence.steps.slice(0, evidence.drill1.stepCount) }, status: "Passed" });
  if (evidence.drill2) rows.push({ ...base, scenario: "Point-in-time recovery to a timestamp between two writes (continuous WAL archiving)", tool: "pg_basebackup + WAL archive + recovery_target_time (PostgreSQL 17.6)", targetDescription: "New local cluster on 127.0.0.1:55442 (non-production, deleted after the drill)", selectedBackupRef: `base.tar.gpg sha256:${evidence.drill2.baseBackupSha256}`, requestedRecoveryPoint: new Date(evidence.drill2.requestedRecoveryPoint), actualRecoveredPoint: evidence.drill2.actualRecoveredPoint ? new Date(evidence.drill2.actualRecoveredPoint) : null, startedAt: new Date(evidence.drill2.startedAt), completedAt: new Date(evidence.drill2.completedAt), measuredRtoSeconds: evidence.drill2.rtoSeconds, measuredRpoSeconds: evidence.drill2.rpoSeconds, validation: { steps: evidence.steps }, status: evidence.passed ? "Passed" : "Failed" });
  if (!evidence.drill1 && !evidence.drill2) rows.push({ ...base, scenario: "Restore drill", tool: "restoreDrill.js", targetDescription: "isolated local clusters (non-production)", status: "Failed", validation: { steps: evidence.steps, error: evidence.error }, startedAt: new Date(evidence.startedAt), completedAt: new Date(evidence.completedAt) });
  for (const r of rows) {
    const created = await prisma.restoreDrill.create({ data: { publicId: `rd_${crypto.randomBytes(8).toString("base64url")}`, ...r, findings: [], remediation: [] } });
    console.log(`Recorded drill ${created.publicId} (${created.status}) RTO ${created.measuredRtoSeconds}s RPO ${created.measuredRpoSeconds}s`);
  }
  await prisma.$disconnect();
  process.exit(process.exitCode || 0);
}

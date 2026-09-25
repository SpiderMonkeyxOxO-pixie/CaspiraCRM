import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Pure platform logic with Prisma mocked: backup-agent protocol, backup
// evidence, recovery points, restore validation, separation of duties,
// alert dedupe/cooldown, release manifests, rollback compatibility and
// platform RBAC.
const db = {
  securityFinding: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  scanReport: { create: vi.fn() },
  platformAlertEvent: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  platformRoleAssignment: { findMany: vi.fn() },
  auditEvent: { create: vi.fn() },
  $queryRaw: vi.fn(),
};
vi.mock("../lib/prisma.js", () => ({ default: db }));
vi.mock("../lib/mailer.js", () => ({ sendMail: vi.fn(), verifyMailerConnection: vi.fn() }));

const { writeRequest, readResults, markProcessed, REQUEST_TYPES } = await import("./agentControl.js");
const { artifactsFromInfo } = await import("./backups.js");
const { validateRecoveryPoint, evaluateValidation } = await import("./restores.js");
const { compare, applyPolicy } = await import("./alerts.js");
const { assertSeparation, requirePlatform, platformPermissionsFor, PLATFORM_ROLES } = await import("./rbac.js");
const { validateManifest } = await import("./releases.js");
const { rollbackCompatibility, REPORTED_TRANSITIONS } = await import("./deployments.js");
const { canTransition, INCIDENT_TRANSITIONS } = await import("./disasterRecovery.js");
const { ingestScanReport } = await import("./findings.js");

beforeEach(() => { vi.clearAllMocks(); db.auditEvent.create.mockResolvedValue({}); });

describe("backup agent control protocol", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "caspira-agent-"));
  it("writes only allowlisted operations with validated, typed parameters", () => {
    const r = writeRequest({ id: "req-000001", type: "backup", params: { type: "full", extra: "rm -rf /" }, environment: "staging" }, dir);
    expect(r.params).toEqual({ type: "full" });
    expect(JSON.parse(fs.readFileSync(path.join(dir, "requests", "req-000001.json"), "utf8"))).toMatchObject({ type: "backup", protocol: 1 });
    expect(fs.existsSync(path.join(dir, "requests", "req-000001.json.tmp"))).toBe(false);
    expect(() => writeRequest({ type: "shell", params: { cmd: "id" } }, dir)).toThrow(/Unknown agent operation/);
    expect(() => writeRequest({ type: "backup", params: { type: "full; rm" } }, dir)).toThrow(/type must be one of/);
    expect(() => writeRequest({ type: "restore", params: { restoreId: "../../etc" } }, dir)).toThrow(/restoreId is invalid/);
    expect(() => writeRequest({ type: "restore", params: { restoreId: "abc123", set: "latest;drop" } }, dir)).toThrow(/label is invalid/);
    expect(() => writeRequest({ type: "expire", params: { retentionFull: 500, retentionDiff: 1 } }, dir)).toThrow(/retentionFull/);
    expect(() => writeRequest({ type: "check" }, null)).toThrow(/not configured/);
    expect(Object.keys(REQUEST_TYPES)).not.toContain("exec");
  });
  it("normalizes a point-in-time target and reads and archives results", () => {
    expect(REQUEST_TYPES.restore({ restoreId: "drill01", targetType: "time", target: "2026-09-25T10:00:00+05:30" }).target).toBe("2026-09-25T04:30:00.000Z");
    fs.writeFileSync(path.join(dir, "results", "r1.json"), JSON.stringify({ id: "r1", status: "succeeded" }));
    fs.writeFileSync(path.join(dir, "results", "r2.json"), "{broken");
    const results = readResults(dir);
    expect(results.map((r) => r.result?.status ?? null).sort()).toEqual([null, "succeeded"].sort());
    markProcessed(results[0].file);
    expect(fs.readdirSync(path.join(dir, "results", "processed"))).toHaveLength(1);
  });
});

describe("backup evidence from pgBackRest", () => {
  const info = [{ name: "caspira", cipher: "aes-256-cbc", db: [{ version: "17" }], backup: [
    { label: "20260925-010000F", type: "full", timestamp: { start: 1790000000, stop: 1790000600 }, archive: { start: "000000010000000000000010", stop: "000000010000000000000012" }, backrest: { version: "2.56.0" }, info: { repository: { size: 123456 } }, database: { "repo-key": 1 } },
    { label: "20260925-010000F_20260925-070000I", type: "incr", timestamp: { start: 1790021600, stop: 1790021700 }, error: true, database: { "repo-key": 2 } },
  ] }];
  it("maps backup sets with encryption, WAL range and repository", () => {
    const [full, incr] = artifactsFromInfo(info, "staging");
    expect(full).toMatchObject({ backupType: "full", status: "Succeeded", encrypted: true, tool: "pgBackRest", databaseVersion: "17", walStart: "000000010000000000000010", locationId: "pgbackrest:caspira:repo1", sizeBytes: 123456 });
    expect(full.completedAt.toISOString()).toBe(new Date(1790000600 * 1000).toISOString());
    expect(incr).toMatchObject({ status: "Failed", locationId: "pgbackrest:caspira:repo2" });
  });
  it("marks an unencrypted repository as unencrypted", () => {
    expect(artifactsFromInfo([{ ...info[0], cipher: "none" }], "staging")[0].encrypted).toBe(false);
    expect(artifactsFromInfo(null, "staging")).toEqual([]);
  });
});

describe("recovery points and restore validation", () => {
  const now = new Date("2026-09-25T12:00:00Z");
  const window = { from: new Date("2026-09-25T01:00:00Z"), to: new Date("2026-09-25T11:55:00Z") };
  it("accepts a timestamp inside the backup's recoverable window", () => {
    expect(validateRecoveryPoint({ recoveryType: "time", recoveryTarget: "2026-09-25T09:30:00Z" }, window, now).toISOString()).toBe("2026-09-25T09:30:00.000Z");
    expect(validateRecoveryPoint({ recoveryType: "latest" }, window, now)).toBeNull();
  });
  it("refuses future points, points before the backup and points past the archived WAL", () => {
    expect(() => validateRecoveryPoint({ recoveryType: "time", recoveryTarget: "2026-09-26T00:00:00Z" }, window, now)).toThrow(/future/);
    expect(() => validateRecoveryPoint({ recoveryType: "time", recoveryTarget: "2026-09-25T00:30:00Z" }, window, now)).toThrow(/before the selected backup/);
    expect(() => validateRecoveryPoint({ recoveryType: "time", recoveryTarget: "2026-09-25T11:58:00Z" }, window, now)).toThrow(/newest archived WAL/);
    expect(() => validateRecoveryPoint({ recoveryType: "time", recoveryTarget: "yesterday" }, window, now)).toThrow(/ISO timestamp/);
    expect(() => validateRecoveryPoint({ recoveryType: "overwrite" }, window, now)).toThrow(/recoveryType/);
  });
  it("passes a restore only when every application check passes", () => {
    const good = { connectivity: "ok", lastMigration: "20260928100000_phase13_refresh_function", organizations: 3, users: 12, systemOwners: 1, roles: 20, auditEvents: 400 };
    expect(evaluateValidation(good, "20260928100000_phase13_refresh_function").passed).toBe(true);
    expect(evaluateValidation({ ...good, lastMigration: "20260101000000_old" }, "20260928100000_phase13_refresh_function").checks.migration_version).toBe(false);
    expect(evaluateValidation({ ...good, systemOwners: 0 }).checks.auth_tables).toBe(false);
    expect(evaluateValidation({ ...good, connectivity: "failed" }).passed).toBe(false);
    expect(evaluateValidation(null).passed).toBe(false);
  });
});

describe("separation of duties", () => {
  const req = (id = "u1") => ({ user: { id, role: "Super-Admin" }, correlationId: "c-12345678", ip: null, headers: {} });
  it("allows a different approver", async () => {
    await expect(assertSeparation(req("u2"), "u1", "restore", null)).resolves.toBeNull();
  });
  it("refuses self-approval unless single-operator exceptions are enabled and justified", async () => {
    delete process.env.PLATFORM_ALLOW_SINGLE_OPERATOR;
    await expect(assertSeparation(req(), "u1", "deployment", "I am the only operator here")).rejects.toMatchObject({ status: 403, code: "SEPARATION_OF_DUTIES" });
    process.env.PLATFORM_ALLOW_SINGLE_OPERATOR = "true";
    await expect(assertSeparation(req(), "u1", "deployment", "short")).rejects.toMatchObject({ code: "SEPARATION_OF_DUTIES" });
    await expect(assertSeparation(req(), "u1", "deployment", "Only one operator on staff this week")).resolves.toMatch(/Only one operator/);
    expect(db.auditEvent.create).toHaveBeenCalled();
    delete process.env.PLATFORM_ALLOW_SINGLE_OPERATOR;
  });
});

describe("platform RBAC", () => {
  const res = () => { const r = { statusCode: 200, body: null }; r.status = (c) => { r.statusCode = c; return r; }; r.json = (b) => { r.body = b; return r; }; return r; };
  it("gives the System Owner every permission and organization admins none", async () => {
    expect((await platformPermissionsFor({ id: "o", role: "Super-Admin" })).size).toBeGreaterThan(10);
    db.platformRoleAssignment.findMany.mockResolvedValue([]);
    expect((await platformPermissionsFor({ id: "a", role: "Admin" })).size).toBe(0);
  });
  it("denies (and audits) an organization admin on platform routes", async () => {
    db.platformRoleAssignment.findMany.mockResolvedValue([]);
    const r = res(); const next = vi.fn();
    await requirePlatform("backup.read")({ user: { id: "a", role: "Admin" }, originalUrl: "/api/v1/admin/backups?x=1", correlationId: "c-12345678", headers: {} }, r, next);
    expect(next).not.toHaveBeenCalled();
    expect(r.statusCode).toBe(403);
    expect(r.body.code).toBe("PLATFORM_FORBIDDEN");
    expect(db.auditEvent.create.mock.calls[0][0].data).toMatchObject({ result: "Denied" });
  });
  it("opens a route to a delegated platform role holding the permission", async () => {
    const role = Object.entries(PLATFORM_ROLES).find(([, v]) => v.permissions.length)[0];
    db.platformRoleAssignment.findMany.mockResolvedValue([{ roleKey: role }]);
    const next = vi.fn();
    await requirePlatform(PLATFORM_ROLES[role].permissions[0])({ user: { id: "b", role: "User" }, originalUrl: "/x", headers: {} }, res(), next);
    expect(next).toHaveBeenCalled();
  });
});

describe("alerts", () => {
  const policy = { id: "p1", key: "backup_age_hours", title: "Backup too old", signal: "backup_age_hours", comparator: "gt", threshold: 26, windowMinutes: 60, cooldownMinutes: 60, dedupeKey: "backup_age_hours:production", severity: "Critical", environment: "production", channels: [] };
  const now = new Date("2026-09-25T12:00:00Z");
  it("compares thresholds and ignores missing values", () => {
    expect(compare(30, "gt", 26)).toBe(true);
    expect(compare(26, "gt", 26)).toBe(false);
    expect(compare(26, "gte", 26)).toBe(true);
    expect(compare(null, "gt", 0)).toBe(false);
    expect(compare("x", "lt", 5)).toBe(false);
  });
  it("opens one event, then deduplicates and respects the cooldown", async () => {
    db.platformAlertEvent.findFirst.mockResolvedValueOnce(null);
    db.platformAlertEvent.create.mockResolvedValue({ id: "e1" });
    expect(await applyPolicy(policy, 40, now)).toMatchObject({ firing: true, created: true });
    db.platformAlertEvent.findFirst.mockResolvedValueOnce({ id: "e1", status: "Firing", lastNotifiedAt: new Date(now.getTime() - 10 * 60_000) });
    db.platformAlertEvent.update.mockResolvedValue({ id: "e1" });
    expect(await applyPolicy(policy, 41, now)).toMatchObject({ firing: true, created: false, notified: false });
    db.platformAlertEvent.findFirst.mockResolvedValueOnce({ id: "e1", status: "Firing", lastNotifiedAt: new Date(now.getTime() - 61 * 60_000) });
    expect(await applyPolicy(policy, 42, now)).toMatchObject({ notified: true });
    db.platformAlertEvent.findFirst.mockResolvedValueOnce({ id: "e1", status: "Acknowledged", lastNotifiedAt: new Date(0) });
    expect(await applyPolicy(policy, 43, now)).toMatchObject({ notified: false });
    expect(db.platformAlertEvent.create).toHaveBeenCalledTimes(1);
  });
  it("resolves an open event when the signal recovers", async () => {
    db.platformAlertEvent.findFirst.mockResolvedValueOnce({ id: "e1", status: "Firing" });
    expect(await applyPolicy(policy, 3, now)).toEqual({ firing: false, resolved: true });
    expect(db.platformAlertEvent.update.mock.calls.at(-1)[0].data.status).toBe("Resolved");
  });
});

describe("releases and rollback", () => {
  const manifest = { releaseId: "2026.09.25-1", version: "1.13.0", gitCommit: "a".repeat(40), images: { api: `ghcr.io/x/caspira-api@sha256:${"b".repeat(64)}` }, buildTimestamp: "2026-09-25T08:00:00Z", migrationVersion: "20260928100000_phase13_refresh_function", migrations: ["20260928100000_phase13_refresh_function"], configSchemaVersion: 1 };
  it("accepts a digest-pinned manifest and refuses tags", () => {
    expect(validateManifest(manifest)).toEqual([]);
    const errs = validateManifest({ ...manifest, images: { api: "ghcr.io/x/caspira-api:latest" }, gitCommit: "main" }).join("\n");
    expect(errs).toMatch(/pinned by digest/);
    expect(errs).toMatch(/latest tag/);
    expect(errs).toMatch(/gitCommit/);
    expect(validateManifest({ ...manifest, migrations: [] }).join()).toMatch(/migrations must list/);
  });
  it("image rollback is compatible only when the schema hasn't moved past the target, or compatibility is declared", async () => {
    const target = { releaseId: "r1", testSummary: { migrations: ["m1", "m2"] } };
    db.$queryRaw.mockResolvedValueOnce([{ migration_name: "m1" }, { migration_name: "m2" }]);
    expect((await rollbackCompatibility({ releaseId: "r2" }, target)).compatible).toBe(true);
    db.$queryRaw.mockResolvedValueOnce([{ migration_name: "m1" }, { migration_name: "m2" }, { migration_name: "m3" }]);
    expect(await rollbackCompatibility({ releaseId: "r2", rollbackCompatibleWith: [] }, target)).toMatchObject({ compatible: false });
    db.$queryRaw.mockResolvedValueOnce([{ migration_name: "m1" }, { migration_name: "m2" }, { migration_name: "m3" }]);
    expect((await rollbackCompatibility({ releaseId: "r2", rollbackCompatibleWith: ["r1"] }, target)).compatible).toBe(true);
    db.$queryRaw.mockResolvedValueOnce([{ migration_name: "m1" }, { migration_name: "m2" }, { migration_name: "m3" }]);
    expect((await rollbackCompatibility({ releaseId: "r2", rollbackCompatibleWith: ["r1"], destructiveMigration: true }, target)).compatible).toBe(false);
  });
  it("host reports can't jump a deployment straight to Completed", () => {
    expect(REPORTED_TRANSITIONS.Deploying || []).not.toContain("Completed");
  });
});

describe("scan ingestion", () => {
  it("a scan of one target never resolves another target's findings, and a Critical fails the scan", async () => {
    db.securityFinding.findUnique.mockResolvedValue(null);
    db.securityFinding.create.mockImplementation(async ({ data }) => ({ id: `id-${data.title}`, ...data }));
    db.securityFinding.updateMany.mockResolvedValue({ count: 0 });
    db.scanReport.create.mockImplementation(async ({ data }) => ({ id: "scan1", ...data }));
    const r = await ingestScanReport({ correlationId: "c-12345678", user: { id: "o" }, headers: {} }, { scanner: "npm-audit", target: "dependency:web", findings: [{ id: "GHSA-1", title: "jsPDF", severity: "critical", component: "jspdf" }] });
    expect(db.securityFinding.create.mock.calls[0][0].data.scope).toBe("scan:dependency:web");
    expect(db.securityFinding.updateMany.mock.calls[0][0].where).toMatchObject({ source: "npm-audit", scope: "scan:dependency:web", status: "Open" });
    expect(r.scan.status).toBe("Failed");
  });
});

describe("disaster recovery incidents", () => {
  it("follows the declared lifecycle without skipping validation or review", () => {
    expect(canTransition(INCIDENT_TRANSITIONS, "Incident Declared", "Containment")).toBe(true);
    expect(canTransition(INCIDENT_TRANSITIONS, "Recovery", "Service Restored")).toBe(false);
    expect(canTransition(INCIDENT_TRANSITIONS, "Incident Declared", "Closed")).toBe(false);
    expect(canTransition(INCIDENT_TRANSITIONS, "Post-Incident Review", "Closed")).toBe(true);
  });
});

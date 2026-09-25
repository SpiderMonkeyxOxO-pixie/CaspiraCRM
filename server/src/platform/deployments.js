// Backend Phase 13 — controlled production deployment.
//
// Planned → Awaiting Approval → Approved → Preflight Running → Deploying →
// Migrating → Verifying → Completed (or Failed / Rollback Requested /
// Rolling Back / Rolled Back / Manual Recovery Required / Cancelled).
//
// The API owns the plan, approvals, the concurrency lock and the preflight
// gates. The host script (deploy/production/scripts/deploy.sh) performs the
// container changes and reports each step with a scoped automation token;
// it refuses to act on a plan the API hasn't moved to Deploying. The API
// never runs containers itself and there is no "deploy anything" primitive.
import prisma from "../lib/prisma.js";
import { PlatformError, currentEnvironment, publicId, platformAudit, toJson } from "./common.js";
import { assertSeparation } from "./rbac.js";
import { blockingCriticalFindings } from "./findings.js";
import { resolveConfig } from "../config/validate.js";
import { detailedHealth } from "./health.js";
import { backupStatus } from "./backups.js";

export const DEPLOYMENT_STATES = ["Planned", "Awaiting Approval", "Approved", "Preflight Running", "Deploying", "Migrating", "Verifying", "Completed", "Failed", "Rollback Requested", "Rolling Back", "Rolled Back", "Manual Recovery Required", "Cancelled"];
const ACTIVE = ["Preflight Running", "Deploying", "Migrating", "Verifying", "Rolling Back"];
// Host-reported progress transitions.
export const REPORTED_TRANSITIONS = {
  Deploying: ["Migrating", "Verifying", "Failed", "Manual Recovery Required"],
  Migrating: ["Verifying", "Failed", "Manual Recovery Required"],
  Verifying: ["Completed", "Failed"],
  "Rolling Back": ["Rolled Back", "Manual Recovery Required"],
};
const TEST_GATES = ["lint", "type_check", "unit_tests", "integration_tests", "authorization_tests", "tenant_isolation_tests", "migration_tests"];
// Gates that an approved, unexpired security exception may waive. Approval,
// configuration, migration and database gates can never be waived.
const WAIVABLE = new Set(["dependency_scan", "container_scan", "secret_scan", "critical_findings", "restore_verification", "storage_capacity"]);

export const serializeDeployment = (d, extra = {}) => toJson({ id: d.publicId, environment: d.environment, releaseId: d.releaseId, previousReleaseId: d.previousReleaseId, status: d.status, maintenanceRequired: d.maintenanceRequired, communicationNote: d.communicationNote, requestedByUserId: d.requestedByUserId, approvedByUserId: d.approvedByUserId, approvedAt: d.approvedAt, separationException: d.separationException, preflightAt: d.preflightAt, startedAt: d.startedAt, completedAt: d.completedAt, failureReason: d.failureReason, rollbackOfId: d.rollbackOfId, createdAt: d.createdAt, version: d.version, ...extra });

async function event(deploymentId, type, { status = null, message = null, req = null, tokenId = null } = {}) {
  await prisma.deploymentEvent.create({ data: { deploymentId, type, status, message: message ? String(message).slice(0, 1000) : null, actorUserId: req?.user?.id || null, automationTokenId: tokenId, correlationId: req?.correlationId || null } });
}

async function load(id) {
  const d = await prisma.deploymentPlan.findFirst({ where: { publicId: String(id), environment: currentEnvironment() } });
  if (!d) throw new PlatformError(404, "NOT_FOUND", "Deployment not found.");
  return d;
}

export async function planDeployment(req, { releaseId, maintenanceRequired = false, communicationNote }) {
  const release = await prisma.releaseArtifact.findUnique({ where: { releaseId: String(releaseId || "") } });
  if (!release) throw new PlatformError(404, "NOT_FOUND", "Release not found. Register the release manifest first.");
  if (release.status === "Revoked") throw new PlatformError(409, "REVOKED", "This release has been revoked.");
  const environment = currentEnvironment();
  const current = await prisma.deploymentPlan.findFirst({ where: { environment, status: "Completed" }, orderBy: { completedAt: "desc" } });
  const d = await prisma.deploymentPlan.create({ data: { publicId: publicId("dp"), environment, releaseId: release.releaseId, previousReleaseId: current?.releaseId || null, status: "Awaiting Approval", maintenanceRequired: !!maintenanceRequired || release.destructiveMigration, communicationNote: communicationNote ? String(communicationNote).slice(0, 2000) : null, requestedByUserId: req.user.id, correlationId: req.correlationId } });
  await event(d.id, "planned", { status: d.status, req });
  await platformAudit(req, "deployment.planned", "DeploymentPlan", d.publicId, { after: { releaseId: release.releaseId, digest: release.primaryImageDigest } });
  return d;
}

export async function approveDeployment(req, id, { approve = true, note, separationException, expectedVersion }) {
  const d = await load(id);
  if (d.status !== "Awaiting Approval") throw new PlatformError(409, "INVALID_STATE", `The deployment is ${d.status}.`);
  const exception = approve ? await assertSeparation(req, d.requestedByUserId, "deployment", separationException) : null;
  const { count } = await prisma.deploymentPlan.updateMany({ where: { id: d.id, status: "Awaiting Approval", ...(expectedVersion !== undefined ? { version: Number(expectedVersion) } : {}) }, data: { status: approve ? "Approved" : "Cancelled", approvedByUserId: req.user.id, approvedAt: new Date(), separationException: exception, version: { increment: 1 } } });
  if (!count) throw new PlatformError(409, "VERSION_CONFLICT", "The deployment changed. Refresh and try again.");
  await event(d.id, approve ? "approved" : "rejected", { status: approve ? "Approved" : "Cancelled", message: note, req });
  await platformAudit(req, approve ? "deployment.approved" : "deployment.rejected", "DeploymentPlan", d.publicId, { reason: note, after: { separationException: exception } });
  return load(id);
}

async function waiverFor(key, environment, now) {
  const f = await prisma.securityException.findFirst({ where: { environment, scope: `gate:${key}`, status: "Approved", expiresAt: { gt: now } } });
  return f || null;
}

// Evaluates every gate. Pure checks against recorded evidence; idempotent.
export async function evaluateGates(d, { now = new Date(), env = process.env } = {}) {
  const environment = d.environment;
  const release = await prisma.releaseArtifact.findUnique({ where: { releaseId: d.releaseId } });
  const gates = [];
  const gate = (key, passed, detail = {}, mandatory = true) => gates.push({ key, status: passed ? "Passed" : "Failed", detail, mandatory });
  const tests = release?.testSummary || {};
  // The codebase is JavaScript without a type checker: type_check may be
  // "not_applicable" (recorded as such); every other test gate must pass.
  for (const k of TEST_GATES) gate(k, tests[k] === "passed" || (k === "type_check" && tests[k] === "not_applicable"), { result: tests[k] || "not reported" });
  const scans = await prisma.scanReport.findMany({ where: { releaseId: d.releaseId } });
  // Scan reports name their kind in the scanner or target (e.g. "dependency:server").
  const scanOf = (kind) => scans.filter((s) => `${s.scanner} ${s.target}`.includes(kind));
  for (const [key, kind] of [["dependency_scan", "dependency"], ["container_scan", "container"], ["secret_scan", "secret"]]) {
    const list = scanOf(kind);
    gate(key, list.length > 0 && list.every((s) => s.status === "Passed"), { reports: list.length, failed: list.filter((s) => s.status !== "Passed").length });
  }
  const sboms = await prisma.sbomReference.count({ where: { releaseId: d.releaseId } });
  gate("sbom", sboms > 0, { sboms });
  const critical = await blockingCriticalFindings(environment, now);
  gate("critical_findings", critical.length === 0, { blocking: critical.map((f) => f.publicId) });
  gate("approvals", !!d.approvedByUserId && (d.approvedByUserId !== d.requestedByUserId || !!d.separationException), { approvedBy: d.approvedByUserId ? "recorded" : "missing", separationException: !!d.separationException });
  const cfg = resolveConfig(env);
  gate("configuration", cfg.errors.length === 0, { profile: cfg.profile, errors: cfg.errors.length });
  const backups = await backupStatus(now);
  const policy = backups.policy;
  const backupFresh = backups.lastBackupAgeHours !== null && backups.lastBackupAgeHours <= 26;
  const walOk = backups.walArchive && backups.walArchive.lagMinutes !== null && backups.walArchive.lagMinutes <= (policy?.walArchiveMaxLagMinutes || 15);
  gate("backup_readiness", backupFresh && !!walOk, { lastBackupAgeHours: backups.lastBackupAgeHours, walLagMinutes: backups.walArchive?.lagMinutes ?? null });
  const drillAgeDays = backups.lastSuccessfulRestoreDrillAt ? (now - new Date(backups.lastSuccessfulRestoreDrillAt)) / 86_400_000 : null;
  gate("restore_verification", drillAgeDays !== null && drillAgeDays <= (policy?.restoreTestIntervalDays || 30), { lastPassedDrillDaysAgo: drillAgeDays === null ? null : Math.round(drillAgeDays) });
  const health = await detailedHealth();
  const disk = health.capacity?.disk;
  gate("storage_capacity", !!disk && disk.usedPercent < 85, { usedPercent: disk?.usedPercent ?? null });
  const dbCap = health.capacity?.database;
  gate("database_health", health.checks.database.status === "ok" && (!dbCap || dbCap.connectionUsePercent < 80), { connectionUsePercent: dbCap?.connectionUsePercent ?? null });
  // Migration preflight: every migration already applied must be in the
  // release (ordering), and the release must not be older than the schema.
  const applied = (await prisma.$queryRaw`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`).map((r) => r.migration_name);
  const releaseMigrations = release?.testSummary?.migrations || [];
  const missing = applied.filter((m) => !releaseMigrations.includes(m));
  const pending = releaseMigrations.filter((m) => !applied.includes(m));
  const failedMigrations = await prisma.$queryRaw`SELECT count(*)::int AS n FROM "_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL`;
  gate("migration_preflight", missing.length === 0 && failedMigrations[0].n === 0, { currentSchema: applied[applied.length - 1] || null, target: release?.migrationVersion, pending: pending.length, appliedButNotInRelease: missing, unfinished: failedMigrations[0].n });
  gate("rollback_procedure", !!release && (!release.destructiveMigration || (d.maintenanceRequired && !!d.communicationNote)), { destructiveMigration: !!release?.destructiveMigration, rollbackCompatibleWith: release?.rollbackCompatibleWith || [] });
  gate("maintenance_communication", !d.maintenanceRequired || String(d.communicationNote || "").trim().length >= 10, { maintenanceRequired: d.maintenanceRequired });
  for (const g of gates) {
    if (g.status === "Failed" && WAIVABLE.has(g.key)) {
      const w = await waiverFor(g.key, environment, now);
      if (w) { g.status = "Waived"; g.exceptionId = w.id; g.detail = { ...g.detail, exception: w.publicId, expiresAt: w.expiresAt }; }
    }
  }
  return gates;
}

export async function executeDeployment(req, id) {
  const d = await load(id);
  if (d.status !== "Approved") throw new PlatformError(409, "NOT_APPROVED", "Only an approved deployment can be executed.");
  // Concurrency protection: one active deployment per environment.
  const active = await prisma.deploymentPlan.findFirst({ where: { environment: d.environment, status: { in: ACTIVE }, id: { not: d.id } } });
  if (active) throw new PlatformError(409, "DEPLOYMENT_LOCKED", `Deployment ${active.publicId} is already in progress.`);
  const claimed = await prisma.deploymentPlan.updateMany({ where: { id: d.id, status: "Approved" }, data: { status: "Preflight Running", preflightAt: new Date(), lockHolder: req.user.id, version: { increment: 1 } } });
  if (!claimed.count) throw new PlatformError(409, "INVALID_STATE", "The deployment is already running.");
  await event(d.id, "preflight_started", { status: "Preflight Running", req });
  let gates;
  try { gates = await evaluateGates(d); }
  catch (err) {
    await prisma.deploymentPlan.update({ where: { id: d.id }, data: { status: "Failed", failureReason: "Preflight could not complete.", lockHolder: null } });
    await event(d.id, "preflight_error", { status: "Failed", message: "Preflight could not complete.", req });
    throw new PlatformError(500, "PREFLIGHT_ERROR", "Preflight could not complete.");
  }
  await prisma.deploymentGate.deleteMany({ where: { deploymentId: d.id } });
  for (const g of gates) await prisma.deploymentGate.create({ data: { deploymentId: d.id, key: g.key, mandatory: g.mandatory, status: g.status, detail: toJson(g.detail), exceptionId: g.exceptionId || null } });
  const failed = gates.filter((g) => g.mandatory && g.status === "Failed");
  if (failed.length) {
    await prisma.deploymentPlan.update({ where: { id: d.id }, data: { status: "Failed", failureReason: `Blocked by gates: ${failed.map((g) => g.key).join(", ")}`, lockHolder: null } });
    await event(d.id, "preflight_blocked", { status: "Failed", message: failed.map((g) => g.key).join(", "), req });
    await platformAudit(req, "deployment.blocked", "DeploymentPlan", d.publicId, { result: "Denied", reason: failed.map((g) => g.key).join(", ") });
    return { deployment: serializeDeployment(await load(id)), gates, blocked: true };
  }
  await prisma.deploymentPlan.update({ where: { id: d.id }, data: { status: "Deploying", startedAt: new Date() } });
  await event(d.id, "ready_for_host", { status: "Deploying", message: "Gates passed; the host script may now pull the release by digest.", req });
  await platformAudit(req, "deployment.executing", "DeploymentPlan", d.publicId, { after: { gates: gates.length } });
  return { deployment: serializeDeployment(await load(id)), gates, blocked: false };
}

// Host script progress reports (automation token, scope deployment:report).
export async function reportProgress(req, id, { status, message }) {
  const d = await load(id);
  const allowed = REPORTED_TRANSITIONS[d.status] || [];
  if (!allowed.includes(status)) throw new PlatformError(409, "INVALID_TRANSITION", `A ${d.status} deployment can't report ${status}.`);
  const data = { status, version: { increment: 1 } };
  if (["Completed", "Failed", "Rolled Back", "Manual Recovery Required"].includes(status)) Object.assign(data, { completedAt: new Date(), lockHolder: null });
  if (status === "Failed" || status === "Manual Recovery Required") data.failureReason = String(message || status).slice(0, 500);
  await prisma.deploymentPlan.update({ where: { id: d.id }, data });
  if (status === "Completed") {
    await prisma.releaseArtifact.update({ where: { releaseId: d.releaseId }, data: { status: "Deployed" } });
    if (d.previousReleaseId && d.previousReleaseId !== d.releaseId) await prisma.releaseArtifact.updateMany({ where: { releaseId: d.previousReleaseId, status: "Deployed" }, data: { status: "Superseded" } });
  }
  if (status === "Rolled Back" && d.rollbackOfId) await prisma.deploymentPlan.updateMany({ where: { id: d.rollbackOfId }, data: { status: "Rolled Back" } });
  await event(d.id, "host_report", { status, message, req, tokenId: req.automationToken?.id || null });
  await platformAudit(req, "deployment.progress", "DeploymentPlan", d.publicId, { after: { status } });
  return serializeDeployment(await load(id));
}

// Can the target (older) release run against the CURRENT schema? Proven only
// when the newer release declared the target rollback-compatible (expand
// migrations only) or the schema hasn't moved past the target's migrations.
export async function rollbackCompatibility(current, target) {
  if (!target) return { compatible: false, reason: "No target release." };
  const applied = (await prisma.$queryRaw`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`).map((r) => r.migration_name);
  const targetMigrations = target.testSummary?.migrations || [];
  const beyond = applied.filter((m) => !targetMigrations.includes(m));
  if (!beyond.length) return { compatible: true, reason: "The schema has no migrations the target release doesn't know." };
  if (current && (current.rollbackCompatibleWith || []).includes(target.releaseId) && !current.destructiveMigration) return { compatible: true, reason: `Release ${current.releaseId} declares its migrations backward-compatible with ${target.releaseId} (expand phase).` };
  return { compatible: false, reason: `The schema includes ${beyond.length} migration(s) the target release doesn't know and compatibility isn't declared. Recovery needs a forward fix or an approved point-in-time restore.` };
}

export async function requestRollback(req, id, { targetReleaseId, mode = "image" }) {
  const d = await load(id);
  if (!["Completed", "Failed", "Verifying", "Manual Recovery Required"].includes(d.status)) throw new PlatformError(409, "INVALID_STATE", `A ${d.status} deployment can't be rolled back.`);
  if (!["image", "configuration", "proxy", "worker", "migration_containment", "pitr", "object_storage"].includes(mode)) throw new PlatformError(422, "INVALID_MODE", "Unknown rollback mode.");
  const targetId = targetReleaseId || d.previousReleaseId;
  const [current, target] = await Promise.all([prisma.releaseArtifact.findUnique({ where: { releaseId: d.releaseId } }), targetId ? prisma.releaseArtifact.findUnique({ where: { releaseId: targetId } }) : null]);
  const compat = ["image", "worker"].includes(mode) ? await rollbackCompatibility(current, target) : { compatible: mode !== "pitr", reason: mode === "pitr" ? "Point-in-time recovery follows the approved restore workflow." : "Configuration and proxy rollbacks don't change the schema." };
  const plan = await prisma.rollbackPlan.create({ data: { publicId: publicId("rb"), deploymentId: d.id, environment: d.environment, targetReleaseId: targetId || "none", mode, schemaCompatible: compat.compatible, compatibilityReason: compat.reason, status: compat.compatible ? "Requested" : "Manual Recovery Required", requestedByUserId: req.user.id, correlationId: req.correlationId } });
  // Never a universal "safe" button: incompatible rollbacks become manual recovery.
  await prisma.deploymentPlan.update({ where: { id: d.id }, data: { status: compat.compatible ? "Rollback Requested" : "Manual Recovery Required", failureReason: compat.compatible ? d.failureReason : compat.reason, version: { increment: 1 } } });
  await event(d.id, "rollback_requested", { status: compat.compatible ? "Rollback Requested" : "Manual Recovery Required", message: compat.reason, req });
  await platformAudit(req, "deployment.rollback_requested", "DeploymentPlan", d.publicId, { after: { mode, target: targetId, compatible: compat.compatible } });
  return { plan, compatibility: compat };
}

// A compatible rollback is itself an approved deployment of the target release.
export async function approveRollback(req, rollbackId, { separationException } = {}) {
  const plan = await prisma.rollbackPlan.findUnique({ where: { publicId: String(rollbackId) } });
  if (!plan || plan.environment !== currentEnvironment()) throw new PlatformError(404, "NOT_FOUND", "Rollback plan not found.");
  if (plan.status !== "Requested") throw new PlatformError(409, "INVALID_STATE", `The rollback is ${plan.status}.`);
  const exception = await assertSeparation(req, plan.requestedByUserId, "rollback", separationException);
  const source = await prisma.deploymentPlan.findUnique({ where: { id: plan.deploymentId } });
  const active = await prisma.deploymentPlan.findFirst({ where: { environment: plan.environment, status: { in: ACTIVE } } });
  if (active) throw new PlatformError(409, "DEPLOYMENT_LOCKED", `Deployment ${active.publicId} is in progress.`);
  const rb = await prisma.deploymentPlan.create({ data: { publicId: publicId("dp"), environment: plan.environment, releaseId: plan.targetReleaseId, previousReleaseId: source.releaseId, status: "Rolling Back", requestedByUserId: plan.requestedByUserId, approvedByUserId: req.user.id, approvedAt: new Date(), separationException: exception, rollbackOfId: source.id, startedAt: new Date(), correlationId: req.correlationId } });
  await prisma.rollbackPlan.update({ where: { id: plan.id }, data: { status: "Rolling Back", approvedByUserId: req.user.id } });
  await prisma.deploymentPlan.update({ where: { id: source.id }, data: { status: "Rolling Back" } });
  await event(rb.id, "rollback_started", { status: "Rolling Back", req });
  await platformAudit(req, "deployment.rollback_approved", "RollbackPlan", plan.publicId, { after: { deployment: rb.publicId } });
  return rb;
}

export async function cancelDeployment(req, id, reason) {
  const d = await load(id);
  if (!["Planned", "Awaiting Approval", "Approved"].includes(d.status)) throw new PlatformError(409, "INVALID_STATE", `A ${d.status} deployment can't be cancelled; report its outcome instead.`);
  await prisma.deploymentPlan.update({ where: { id: d.id }, data: { status: "Cancelled", failureReason: reason ? String(reason).slice(0, 300) : null, version: { increment: 1 } } });
  await event(d.id, "cancelled", { status: "Cancelled", message: reason, req });
  await platformAudit(req, "deployment.cancelled", "DeploymentPlan", d.publicId, { reason });
  return serializeDeployment(await load(id));
}

// Worker: deployments stuck mid-flight are never silently completed; after
// the timeout they become Manual Recovery Required (no stale deploy state).
export async function flagStuckDeployments(now = new Date(), timeoutMs = Number(process.env.DEPLOYMENT_STUCK_MS) || 2 * 3_600_000) {
  const stuck = await prisma.deploymentPlan.findMany({ where: { environment: currentEnvironment(), status: { in: ACTIVE }, updatedAt: { lt: new Date(now.getTime() - timeoutMs) } } });
  for (const d of stuck) {
    await prisma.deploymentPlan.update({ where: { id: d.id }, data: { status: "Manual Recovery Required", failureReason: "No progress reported within the deployment timeout.", lockHolder: null } });
    await event(d.id, "timeout", { status: "Manual Recovery Required", message: "No progress reported within the timeout." });
  }
  return stuck.length;
}

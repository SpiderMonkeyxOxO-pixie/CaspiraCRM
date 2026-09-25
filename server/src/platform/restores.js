// Backend Phase 13 — restore planning, approval, isolated execution and
// restore drills.
//
// Every restore defaults to a NEW, isolated target (a separate data
// directory and temporary PostgreSQL instance inside the backup agent) and
// never overwrites the active database. Production-in-place recovery is a
// manual, approved runbook (docs/runbooks/05-restore-and-pitr.md): the API
// refuses to execute it. Recovery points are validated against the backup
// set and the archived WAL range before a plan can be approved.
import prisma from "../lib/prisma.js";
import { PlatformError, currentEnvironment, publicId, platformAudit, toJson } from "./common.js";
import { assertSeparation } from "./rbac.js";
import { writeRequest, readStatus, agentConfigured } from "./agentControl.js";
import { refreshVerificationStatus } from "./backups.js";
import { recordFinding } from "./findings.js";

// The recoverable window of an artifact: from its stop time to the newest
// archived WAL (pgBackRest restores any point in that range).
export async function recoveryWindow(artifact) {
  const archiver = readStatus()?.archiver;
  const lastArchived = archiver?.last_archived_time ? new Date(archiver.last_archived_time) : null;
  const newer = await prisma.backupArtifact.findFirst({ where: { environment: artifact.environment, dataSource: artifact.dataSource, status: "Succeeded", completedAt: { gt: artifact.completedAt || new Date(0) } }, orderBy: { completedAt: "desc" } });
  return { from: artifact.completedAt, to: lastArchived || artifact.recoverableTo || newer?.completedAt || artifact.completedAt, walEvidence: lastArchived ? "pg_stat_archiver.last_archived_time" : "backup stop time only" };
}

export function validateRecoveryPoint({ recoveryType, recoveryTarget }, window, now = new Date()) {
  if (!["latest", "time", "full"].includes(recoveryType)) throw new PlatformError(422, "INVALID_RECOVERY_TYPE", "recoveryType must be latest, time or full.");
  if (recoveryType !== "time") return null;
  const t = new Date(recoveryTarget);
  if (!recoveryTarget || Number.isNaN(t.getTime())) throw new PlatformError(422, "INVALID_RECOVERY_POINT", "recoveryTarget must be an ISO timestamp.");
  if (t > now) throw new PlatformError(422, "INVALID_RECOVERY_POINT", "The recovery point is in the future.");
  if (!window.from || t < window.from) throw new PlatformError(422, "INVALID_RECOVERY_POINT", "The recovery point is before the selected backup finished; choose an earlier backup.");
  if (window.to && t > window.to) throw new PlatformError(422, "INVALID_RECOVERY_POINT", `The recovery point is after the newest archived WAL (${new Date(window.to).toISOString()}); data after that can't be recovered from this backup.`);
  return t;
}

export async function planRestore(req, body) {
  const environment = currentEnvironment();
  const target = body.target || "isolated";
  if (!["isolated", "production"].includes(target)) throw new PlatformError(422, "INVALID_TARGET", "target must be isolated or production.");
  const artifact = await prisma.backupArtifact.findFirst({ where: { publicId: String(body.sourceArtifactId || ""), environment } });
  if (!artifact || artifact.status !== "Succeeded") throw new PlatformError(422, "INVALID_SOURCE", "Choose a successful backup artifact from this environment.");
  const window = await recoveryWindow(artifact);
  const at = validateRecoveryPoint(body, window);
  if (target === "production") {
    const required = ["incidentRef", "impactAssessment", "maintenancePlan", "communicationPlan", "rollForwardPlan", "rollbackPlan"];
    const missing = required.filter((k) => String(body[k] || "").trim().length < 5);
    if (!body.incidentRef && !body.changeRef) missing.push("incidentRef or changeRef");
    if (missing.length) throw new PlatformError(422, "PRODUCTION_RESTORE_INCOMPLETE", `A production restore plan needs: ${[...new Set(missing)].join(", ")}.`);
  }
  const plan = await prisma.restorePlan.create({
    data: {
      publicId: publicId("rp"), environment, target, recoveryType: body.recoveryType, recoveryTarget: at, sourceArtifactId: artifact.id,
      walCoverageValidated: body.recoveryType !== "time" || window.walEvidence !== "backup stop time only", walCoverage: toJson(window),
      incidentRef: body.incidentRef || null, changeRef: body.changeRef || null, impactAssessment: body.impactAssessment || null, currentStateBackupRef: body.currentStateBackupRef || null,
      maintenancePlan: body.maintenancePlan || null, communicationPlan: body.communicationPlan || null, rollForwardPlan: body.rollForwardPlan || null, rollbackPlan: body.rollbackPlan || null,
      requestedByUserId: req.user.id, correlationId: req.correlationId,
    },
  });
  await platformAudit(req, "restore.planned", "RestorePlan", plan.publicId, { after: { target, recoveryType: body.recoveryType, recoveryTarget: at, artifact: artifact.publicId } });
  return plan;
}

export async function decideRestore(req, id, { approve, note, separationException }) {
  const plan = await prisma.restorePlan.findFirst({ where: { publicId: String(id), environment: currentEnvironment() } });
  if (!plan) throw new PlatformError(404, "NOT_FOUND", "Restore plan not found.");
  if (plan.status !== "Awaiting approval") throw new PlatformError(409, "INVALID_STATE", `The plan is ${plan.status}.`);
  if (approve && plan.recoveryType === "time" && !plan.walCoverageValidated) throw new PlatformError(409, "WAL_COVERAGE_UNVERIFIED", "WAL coverage for the recovery point couldn't be confirmed from archiver status; confirm it in the agent before approving.");
  const exception = approve ? await assertSeparation(req, plan.requestedByUserId, "restore", separationException) : null;
  const updated = await prisma.restorePlan.update({ where: { id: plan.id }, data: { status: approve ? "Approved" : "Rejected", approvedByUserId: req.user.id, approvedAt: new Date(), approvalNote: note ? String(note).slice(0, 1000) : null, separationException: exception, version: { increment: 1 } } });
  await platformAudit(req, approve ? "restore.approved" : "restore.rejected", "RestorePlan", plan.publicId, { reason: note });
  return updated;
}

export async function executeRestore(req, id) {
  const plan = await prisma.restorePlan.findFirst({ where: { publicId: String(id), environment: currentEnvironment() } });
  if (!plan) throw new PlatformError(404, "NOT_FOUND", "Restore plan not found.");
  if (plan.status !== "Approved") throw new PlatformError(409, "NOT_APPROVED", "Only an approved restore plan can be executed.");
  if (plan.target === "production") throw new PlatformError(409, "MANUAL_RUNBOOK_REQUIRED", "In-place production recovery is performed on the host with the restore runbook, never through the API. Record its execution against this plan.");
  if (!agentConfigured()) throw new PlatformError(503, "AGENT_NOT_CONFIGURED", "The backup agent is not configured in this environment.");
  const artifact = await prisma.backupArtifact.findUnique({ where: { id: plan.sourceArtifactId } });
  const claimed = await prisma.restorePlan.updateMany({ where: { id: plan.id, status: "Approved" }, data: { status: "Executing", version: { increment: 1 } } });
  if (!claimed.count) throw new PlatformError(409, "INVALID_STATE", "The plan is already executing.");
  const exec = await prisma.restoreExecution.create({ data: { planId: plan.id, environment: plan.environment, targetLabel: `isolated-${plan.publicId}`, executedByUserId: req.user.id, startedAt: new Date(), status: "Queued" } });
  writeRequest({ id: exec.id.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 60), type: artifact.dataSource === "object_storage" ? "object_restore" : "restore", params: artifact.dataSource === "object_storage" ? { restoreId: exec.id } : { restoreId: exec.id, set: artifact.backupType === "logical" ? null : artifact.label, targetType: plan.recoveryType === "time" ? "time" : "latest", target: plan.recoveryTarget, repo: artifact.backupType === "logical" ? null : repoOf(artifact) }, environment: plan.environment, correlationId: req.correlationId });
  await platformAudit(req, "restore.executed", "RestorePlan", plan.publicId, { after: { executionId: exec.id, target: exec.targetLabel } });
  return exec;
}

export async function cancelRestore(req, id, reason) {
  const plan = await prisma.restorePlan.findFirst({ where: { publicId: String(id), environment: currentEnvironment() } });
  if (!plan) throw new PlatformError(404, "NOT_FOUND", "Restore plan not found.");
  if (!["Awaiting approval", "Approved", "Executing"].includes(plan.status)) throw new PlatformError(409, "INVALID_STATE", `The plan is ${plan.status}.`);
  await prisma.restorePlan.update({ where: { id: plan.id }, data: { status: "Cancelled", version: { increment: 1 } } });
  const running = await prisma.restoreExecution.findFirst({ where: { planId: plan.id, status: { in: ["Queued", "Running", "Validating", "Succeeded"] } }, orderBy: { createdAt: "desc" } });
  // A cancelled isolated restore is cleaned up; nothing in production changes.
  if (running && agentConfigured()) writeRequest({ id: `cleanup-${running.id}`.slice(0, 60), type: "restore_cleanup", params: { restoreId: running.id }, environment: plan.environment, correlationId: req.correlationId });
  if (running) await prisma.restoreExecution.update({ where: { id: running.id }, data: { status: "Cancelled", completedAt: new Date(), failureSummary: `Cancelled: ${String(reason || "").slice(0, 200)}` } });
  await platformAudit(req, "restore.cancelled", "RestorePlan", plan.publicId, { reason });
  return { ok: true };
}

// Post-restore validation the agent performs against the isolated instance.
// Counts are aggregates only; no record contents leave the agent.
export const RESTORE_VALIDATION_KEYS = ["connectivity", "migration_version", "tenant_counts", "auth_tables", "permissions", "audit_integrity", "file_references", "jobs_tables", "analytics_tables"];

export function evaluateValidation(validation, expectedMigration) {
  const v = validation || {};
  const checks = {
    connectivity: v.connectivity === "ok",
    migration_version: !!v.lastMigration && (!expectedMigration || v.lastMigration === expectedMigration),
    tenant_counts: Number.isInteger(v.organizations) && v.organizations >= 0,
    auth_tables: Number.isInteger(v.users) && v.users > 0 && Number.isInteger(v.systemOwners) && v.systemOwners > 0,
    permissions: Number.isInteger(v.roles) && v.roles > 0,
    audit_integrity: Number.isInteger(v.auditEvents) && v.auditEvents >= 0,
  };
  return { passed: Object.values(checks).every(Boolean), checks };
}

export async function ingestRestoreResult(result) {
  // The agent echoes the request parameters; restoreId is the execution ID.
  const restoreId = String(result.params?.restoreId || "");
  const exec = restoreId ? await prisma.restoreExecution.findUnique({ where: { id: restoreId } }) : null;
  if (result.type === "restore_cleanup") {
    if (exec) await prisma.restoreExecution.update({ where: { id: exec.id }, data: { cleanedUpAt: new Date(), status: exec.status === "Cancelled" ? "Cancelled" : "Cleaned up" } });
    return;
  }
  if (!exec) return;
  const plan = await prisma.restorePlan.findUnique({ where: { id: exec.planId } });
  const artifact = await prisma.backupArtifact.findUnique({ where: { id: plan.sourceArtifactId } });
  const expected = await prisma.$queryRaw`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1`.then((r) => r[0]?.migration_name).catch(() => null);
  const ok = result.status === "succeeded";
  const evaluation = ok ? evaluateValidation(result.output?.validation, expected) : { passed: false, checks: {} };
  const recoveredTo = result.output?.recoveredTo ? new Date(result.output.recoveredTo) : null;
  await prisma.restoreExecution.update({ where: { id: exec.id }, data: { status: ok && evaluation.passed ? "Succeeded" : "Failed", completedAt: result.completedAt ? new Date(result.completedAt) : new Date(), recoveredTo, validation: toJson({ ...result.output?.validation, evaluation }), failureSummary: ok ? (evaluation.passed ? null : "Post-restore validation failed.") : String(result.error || "Restore failed.").slice(0, 500) } });
  await prisma.restorePlan.update({ where: { id: plan.id }, data: { status: ok && evaluation.passed ? "Completed" : "Failed" } });
  await prisma.backupVerification.create({ data: { artifactId: artifact.id, environment: artifact.environment, check: "isolated_restore", status: ok ? "Passed" : "Failed", details: toJson({ restoreExecution: exec.id, recoveredTo }) } });
  await prisma.backupVerification.create({ data: { artifactId: artifact.id, environment: artifact.environment, check: "app_smoke", status: evaluation.passed ? "Passed" : "Failed", details: toJson(evaluation) } });
  await refreshVerificationStatus(artifact.id);
  const drill = await prisma.restoreDrill.findFirst({ where: { correlationId: exec.id } });
  if (drill) {
    const startedAt = drill.startedAt || exec.startedAt || exec.createdAt;
    const completedAt = result.completedAt ? new Date(result.completedAt) : new Date();
    const passed = ok && evaluation.passed;
    await prisma.restoreDrill.update({ where: { id: drill.id }, data: {
      status: passed ? "Passed" : "Failed", completedAt, actualRecoveredPoint: recoveredTo,
      measuredRtoSeconds: Math.round((completedAt - startedAt) / 1000), measuredRpoSeconds: recoveredTo ? Math.max(0, Math.round((startedAt - recoveredTo) / 1000)) : null,
      validation: toJson(evaluation), selectedBackupRef: artifact.publicId,
    } });
    if (!passed) await recordFinding({ category: "restore", source: "restore-drill", title: `Restore drill ${drill.publicId} failed`, severity: "High", component: "backups", fingerprint: `drill-failed:${drill.publicId}` });
  }
}

// ─── Restore drills ──────────────────────────────────────────────────────────
export const serializeDrill = (d) => toJson({
  id: d.publicId, environment: d.environment, scenario: d.scenario, selectedBackup: d.selectedBackupRef, requestedRecoveryPoint: d.requestedRecoveryPoint, actualRecoveredPoint: d.actualRecoveredPoint,
  startedAt: d.startedAt, completedAt: d.completedAt, measuredRpoSeconds: d.measuredRpoSeconds, measuredRtoSeconds: d.measuredRtoSeconds, validation: d.validation, missingArtifacts: d.missingArtifacts,
  tool: d.tool, target: d.targetDescription, operatorUserId: d.operatorUserId, approverUserId: d.approverUserId, findings: d.findings, remediation: d.remediation, status: d.status, scheduledFor: d.scheduledFor, evidence: d.evidenceRef,
});

// The pgBackRest repository that holds an artifact's set ("pgbackrest:<stanza>:repoN").
export function repoOf(artifact) {
  const m = /:repo([12])$/.exec(artifact?.locationId || "");
  return m ? Number(m[1]) : null;
}

// Drills restore the newest set from the primary repository (repo1); an
// off-host set is used only when repo1 has none.
async function newestPhysical(environment) {
  const where = { environment, dataSource: "postgres", status: "Succeeded", backupType: { in: ["full", "diff", "incr"] } };
  return (await prisma.backupArtifact.findFirst({ where: { ...where, locationId: { endsWith: ":repo1" } }, orderBy: { completedAt: "desc" } }))
    || prisma.backupArtifact.findFirst({ where, orderBy: { completedAt: "desc" } });
}

// Starts an automated drill: an isolated restore of the newest backup to the
// latest point, validated like any restore. Never targets production.
export async function startDrill(req, { scenario = "Latest recoverable point into an isolated target", sourceArtifactId } = {}) {
  const environment = currentEnvironment();
  if (!agentConfigured()) throw new PlatformError(503, "AGENT_NOT_CONFIGURED", "The backup agent is not configured here; record an operator-run drill instead (POST with results).");
  const artifact = sourceArtifactId
    ? await prisma.backupArtifact.findFirst({ where: { publicId: String(sourceArtifactId), environment, status: "Succeeded" } })
    : await newestPhysical(environment);
  if (!artifact) throw new PlatformError(409, "NO_BACKUP", "No successful backup is available to drill.");
  const plan = await prisma.restorePlan.create({ data: { publicId: publicId("rp"), environment, target: "isolated", recoveryType: "latest", sourceArtifactId: artifact.id, walCoverageValidated: true, walCoverage: toJson(await recoveryWindow(artifact)), status: "Executing", requestedByUserId: req.user?.id || "system", approvedByUserId: req.user?.id || "system", approvedAt: new Date(), approvalNote: "Restore drill (isolated target)", correlationId: req.correlationId } });
  const exec = await prisma.restoreExecution.create({ data: { planId: plan.id, environment, targetLabel: `drill-${plan.publicId}`, executedByUserId: req.user?.id || null, startedAt: new Date() } });
  const drill = await prisma.restoreDrill.create({ data: { publicId: publicId("rd"), environment, scenario: String(scenario).slice(0, 200), selectedBackupRef: artifact.publicId, startedAt: new Date(), status: "Running", tool: "pgBackRest (backup agent)", targetDescription: "Isolated data directory and temporary PostgreSQL in the backup agent", operatorUserId: req.user?.id || null, correlationId: exec.id } });
  writeRequest({ id: exec.id.slice(0, 60), type: "restore", params: { restoreId: exec.id, set: artifact.label, targetType: "latest", repo: repoOf(artifact) }, environment, correlationId: req.correlationId });
  await platformAudit(req, "restore_drill.started", "RestoreDrill", drill.publicId, { after: { artifact: artifact.publicId } });
  return drill;
}

// Records a drill performed outside the agent (e.g. the operator-run drill
// script on a staging host or workstation) with its evidence.
export async function recordDrill(req, body) {
  const required = ["scenario", "startedAt", "completedAt", "status", "tool", "targetDescription"];
  for (const k of required) if (!body[k]) throw new PlatformError(422, "INVALID_DRILL", `${k} is required.`);
  if (!["Passed", "Failed"].includes(body.status)) throw new PlatformError(422, "INVALID_DRILL", "status must be Passed or Failed.");
  if (/production/i.test(body.targetDescription) && !/not production|non-production|isolated/i.test(body.targetDescription)) throw new PlatformError(422, "PRODUCTION_TARGET", "Drills must never target production.");
  const started = new Date(body.startedAt); const completed = new Date(body.completedAt);
  const recovered = body.actualRecoveredPoint ? new Date(body.actualRecoveredPoint) : null;
  const drill = await prisma.restoreDrill.create({ data: {
    publicId: publicId("rd"), environment: currentEnvironment(), scenario: String(body.scenario).slice(0, 300), selectedBackupRef: body.selectedBackupRef || null,
    requestedRecoveryPoint: body.requestedRecoveryPoint ? new Date(body.requestedRecoveryPoint) : null, actualRecoveredPoint: recovered, startedAt: started, completedAt: completed,
    measuredRtoSeconds: Number.isFinite(body.measuredRtoSeconds) ? Math.round(body.measuredRtoSeconds) : Math.round((completed - started) / 1000),
    measuredRpoSeconds: Number.isFinite(body.measuredRpoSeconds) ? Math.round(body.measuredRpoSeconds) : null,
    validation: toJson(body.validation || {}), missingArtifacts: toJson(body.missingArtifacts || []), tool: String(body.tool).slice(0, 200), targetDescription: String(body.targetDescription).slice(0, 300),
    operatorUserId: req.user.id, approverUserId: body.approverUserId || null, findings: toJson(body.findings || []), remediation: toJson(body.remediation || []), status: body.status, evidenceRef: body.evidenceRef ? String(body.evidenceRef).slice(0, 300) : null, correlationId: req.correlationId,
  } });
  if (body.status === "Failed") await recordFinding({ category: "restore", source: "restore-drill", title: `Restore drill ${drill.publicId} failed`, severity: "High", component: "backups", fingerprint: `drill-failed:${drill.publicId}` });
  await platformAudit(req, "restore_drill.recorded", "RestoreDrill", drill.publicId, { after: { status: body.status, rto: drill.measuredRtoSeconds, rpo: drill.measuredRpoSeconds } });
  return drill;
}

// Worker: a missed drill (none passed within the policy interval) is an operational finding.
export async function checkDrillSchedule(now = new Date()) {
  const environment = currentEnvironment();
  const policy = await prisma.backupPolicy.findFirst({ where: { environment, dataSource: "postgres", status: "Active" } });
  if (!policy) return null;
  const last = await prisma.restoreDrill.findFirst({ where: { environment, status: "Passed" }, orderBy: { completedAt: "desc" } });
  const overdue = !last || now - last.completedAt > policy.restoreTestIntervalDays * 86_400_000;
  if (!overdue) return { overdue: false, lastPassedAt: last.completedAt };
  const key = `drill-missed:${environment}:${now.toISOString().slice(0, 7)}`;
  await recordFinding({ category: "restore", source: "restore-drill-schedule", title: `No passed restore drill within ${policy.restoreTestIntervalDays} days`, severity: "High", component: "backups", fingerprint: key });
  const existingMissed = await prisma.restoreDrill.findFirst({ where: { environment, status: "Missed", scheduledFor: { gte: new Date(now.getTime() - 86_400_000) } } });
  if (!existingMissed) await prisma.restoreDrill.create({ data: { publicId: publicId("rd"), environment, scenario: "Scheduled restore drill", status: "Missed", scheduledFor: now, findings: toJson([`No passed drill since ${last?.completedAt?.toISOString() || "ever"}.`]) } });
  return { overdue: true, lastPassedAt: last?.completedAt || null };
}

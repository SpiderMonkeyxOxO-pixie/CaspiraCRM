// Backend Phase 13 — HTTP handlers for platform security, backups, restores,
// disaster recovery, releases, deployments, health, alerts and retention.
// Routes (src/routes/platformRoutes.js) enforce the platform permission,
// a live session and, for sensitive actions, recent authentication. No
// response ever contains a secret value, credential or storage key.
import prisma from "../../lib/prisma.js";
import { guard, PlatformError, currentEnvironment, toJson } from "../common.js";
import { platformPermissionsFor, PLATFORM_ROLES, grantPlatformRole, revokePlatformRole, isSystemOwner } from "../rbac.js";
import * as findings from "../findings.js";
import * as secrets from "../secretInventory.js";
import * as backups from "../backups.js";
import * as restores from "../restores.js";
import * as dr from "../disasterRecovery.js";
import * as releases from "../releases.js";
import * as deployments from "../deployments.js";
import * as alerts from "../alerts.js";
import * as retention from "../retention.js";
import { detailedHealth, diskUsage, databaseCapacity } from "../health.js";
import { httpWindow, slowEndpoints } from "../httpMetrics.js";
import { createAutomationToken, revokeAutomationToken } from "../automationTokens.js";
import { ensurePlatformSeed } from "../seed.js";

const env = currentEnvironment;
const page = (q, max = 200) => Math.min(max, Math.max(1, Number(q.limit) || 50));

// ─── Access ───────────────────────────────────────────────────────────────────
export const myAccess = guard(async (req, res) => {
  const perms = await platformPermissionsFor(req.user);
  res.json({ environment: env(), systemOwner: isSystemOwner(req.user), permissions: [...perms].sort() });
});

// ─── Security ─────────────────────────────────────────────────────────────────
export const securityOverview = guard(async (req, res) => {
  await ensurePlatformSeed();
  const [open, bySeverity, exceptions, secretsDue, alertsFiring, lastScan, baseline] = await Promise.all([
    prisma.securityFinding.count({ where: { environment: env(), status: "Open" } }),
    prisma.securityFinding.groupBy({ by: ["severity"], where: { environment: env(), status: { in: ["Open", "Excepted"] } }, _count: { _all: true } }),
    prisma.securityException.count({ where: { environment: env(), status: "Approved", expiresAt: { gt: new Date() } } }),
    prisma.secretInventoryItem.count({ where: { environment: env(), status: { in: ["Rotation due", "Compromised"] } } }),
    prisma.platformAlertEvent.count({ where: { environment: env(), status: "Firing" } }),
    prisma.scanReport.findFirst({ orderBy: { createdAt: "desc" } }),
    prisma.securityBaselineCheck.groupBy({ by: ["status"], where: { environment: env() }, _count: { _all: true } }),
  ]);
  res.json(toJson({
    environment: env(), openFindings: open, findingsBySeverity: Object.fromEntries(bySeverity.map((r) => [r.severity, r._count._all])), activeExceptions: exceptions,
    secretsNeedingAttention: secretsDue, alertsFiring, lastScan: lastScan ? { scanner: lastScan.scanner, target: lastScan.target, status: lastScan.status, at: lastScan.createdAt, summary: lastScan.summary } : null,
    baseline: Object.fromEntries(baseline.map((r) => [r.status, r._count._all])),
    blockingCriticalFindings: (await findings.blockingCriticalFindings()).length,
    note: "Evidence for review, not a compliance certification.",
  }));
});

export const listFindings = guard(async (req, res) => {
  const where = { environment: env(), ...(req.query.status ? { status: String(req.query.status) } : {}), ...(req.query.severity ? { severity: String(req.query.severity) } : {}), ...(req.query.category ? { category: String(req.query.category) } : {}) };
  const rows = await prisma.securityFinding.findMany({ where, orderBy: [{ lastSeenAt: "desc" }], take: page(req.query, 500) });
  const ex = await prisma.securityException.findMany({ where: { findingId: { in: rows.map((r) => r.id) } }, orderBy: { createdAt: "desc" } });
  res.json({ findings: rows.map((f) => ({ ...findings.serializeFinding(f), exceptions: ex.filter((e) => e.findingId === f.id).map((e) => ({ id: e.publicId, status: e.status, scope: e.scope, expiresAt: e.expiresAt, requestedByUserId: e.requestedByUserId, approvedByUserId: e.approvedByUserId })) })) });
});
export const setDisposition = guard(async (req, res) => res.json(await findings.setDisposition(req, req.params.id, { disposition: req.body?.disposition, note: req.body?.note, expectedVersion: req.body?.version })));
export const requestException = guard(async (req, res) => { const e = await findings.requestException(req, req.params.id, req.body || {}); res.status(201).json({ id: e.publicId, status: e.status, expiresAt: e.expiresAt }); });
export const decideException = guard(async (req, res) => { const e = await findings.decideException(req, req.params.id, { approve: req.body?.approve !== false, note: req.body?.note, separationException: req.body?.separationException }); res.json({ id: e.publicId, status: e.status, expiresAt: e.expiresAt }); });
export const ingestScan = guard(async (req, res) => { const r = await findings.ingestScanReport(req, req.body?.report || req.body, { releaseId: req.body?.releaseId || null }); res.status(201).json(toJson({ scanId: r.scan.id, counts: r.counts, resolved: r.resolved })); });

export const listBaseline = guard(async (req, res) => res.json({ checks: await prisma.securityBaselineCheck.findMany({ where: { environment: env() }, orderBy: [{ area: "asc" }, { control: "asc" }] }) }));
export const recordBaseline = guard(async (req, res) => {
  const { area, control, expected, status, evidence } = req.body || {};
  if (!area || !control || !expected) throw new PlatformError(422, "INVALID_BASELINE", "area, control and expected are required.");
  if (!["Met", "Not met", "Unknown", "Not applicable"].includes(status)) throw new PlatformError(422, "INVALID_BASELINE", "status must be Met, Not met, Unknown or Not applicable.");
  const row = await prisma.securityBaselineCheck.upsert({ where: { environment_area_control: { environment: env(), area: String(area).slice(0, 80), control: String(control).slice(0, 200) } }, update: { expected: String(expected).slice(0, 500), status, evidence: evidence ? String(evidence).slice(0, 2000) : null, checkedBy: req.user.id, checkedAt: new Date() }, create: { environment: env(), area: String(area).slice(0, 80), control: String(control).slice(0, 200), expected: String(expected).slice(0, 500), status, evidence: evidence ? String(evidence).slice(0, 2000) : null, checkedBy: req.user.id, checkedAt: new Date() } });
  res.json(row);
});

// ─── Secrets (metadata only) ──────────────────────────────────────────────────
export const listSecrets = guard(async (req, res) => {
  await secrets.seedSecretInventory();
  const rows = await prisma.secretInventoryItem.findMany({ where: { environment: env() }, orderBy: { secretKey: "asc" } });
  const events = await prisma.secretRotationEvent.findMany({ where: { environment: env() }, orderBy: { createdAt: "desc" }, take: 100 });
  res.json({ secrets: rows.map((s) => ({ ...secrets.serializeSecret(s), recentEvents: events.filter((e) => e.secretItemId === s.id).slice(0, 5).map((e) => ({ step: e.step, at: e.createdAt, toVersion: e.toVersion, actorUserId: e.actorUserId })) })), rotationSteps: secrets.ROTATION_STEPS, note: "Metadata only — secret values are never stored or returned." });
});
export const rotateSecret = guard(async (req, res) => res.json(await secrets.advanceRotation(req, req.params.id, { step: req.body?.step, reason: req.body?.reason, expectedVersion: req.body?.version })));
export const revokeSecret = guard(async (req, res) => res.json(await secrets.emergencyRevoke(req, req.params.id, req.body?.reason)));

// ─── Platform roles and automation tokens ─────────────────────────────────────
export const listPlatformRoles = guard(async (req, res) => {
  const rows = await prisma.platformRoleAssignment.findMany({ where: { revokedAt: null }, orderBy: { createdAt: "desc" } });
  const users = rows.length ? await prisma.user.findMany({ where: { id: { in: rows.map((r) => r.userId) } }, select: { id: true, username: true, name: true, email: true } }) : [];
  const uBy = Object.fromEntries(users.map((u) => [u.id, u]));
  res.json({ roles: Object.entries(PLATFORM_ROLES).map(([key, r]) => ({ key, name: r.name, permissions: r.permissions })), assignments: rows.map((r) => ({ userId: r.userId, user: uBy[r.userId] ? { username: uBy[r.userId].username, name: uBy[r.userId].name } : null, roleKey: r.roleKey, grantedByUserId: r.grantedByUserId, createdAt: r.createdAt })) });
});
export const grantRole = guard(async (req, res) => res.status(201).json(await grantPlatformRole(req, req.body?.userId, req.body?.roleKey, req.body?.reason)));
export const revokeRole = guard(async (req, res) => res.json(await revokePlatformRole(req, req.body?.userId, req.body?.roleKey)));
export const listTokens = guard(async (req, res) => res.json({ tokens: (await prisma.platformAutomationToken.findMany({ where: { environment: env() }, orderBy: { createdAt: "desc" } })).map((t) => ({ id: t.publicId, name: t.name, scopes: t.scopes, expiresAt: t.expiresAt, lastUsedAt: t.lastUsedAt, revokedAt: t.revokedAt, createdAt: t.createdAt })) }));
export const createToken = guard(async (req, res) => res.status(201).json(await createAutomationToken(req, req.body || {})));
export const revokeToken = guard(async (req, res) => res.json(await revokeAutomationToken(req, req.params.id)));

// ─── Backups ──────────────────────────────────────────────────────────────────
export const listPolicies = guard(async (req, res) => { await backups.seedBackupPolicies(); res.json({ policies: await prisma.backupPolicy.findMany({ where: { environment: env() }, orderBy: { name: "asc" } }) }); });
export const savePolicy = guard(async (req, res) => res.json(await backups.upsertPolicy(req, req.body || {})));
export const approveTargets = guard(async (req, res) => res.json(await backups.approveTargets(req, req.params.id)));
export const listJobs = guard(async (req, res) => res.json({ jobs: await prisma.backupJob.findMany({ where: { environment: env() }, orderBy: { createdAt: "desc" }, take: page(req.query) }) }));
export const runBackup = guard(async (req, res) => { const r = await backups.runBackupNow(req, { backupType: req.body?.backupType || "full" }); res.status(202).json({ job: r.job, existing: r.existing }); });
export const listArtifacts = guard(async (req, res) => {
  const rows = await prisma.backupArtifact.findMany({ where: { environment: env() }, orderBy: { completedAt: "desc" }, take: page(req.query) });
  const ver = await prisma.backupVerification.findMany({ where: { artifactId: { in: rows.map((r) => r.id) } }, orderBy: { verifiedAt: "desc" } });
  res.json({ artifacts: rows.map((a) => ({ ...backups.serializeArtifact(a), verifications: ver.filter((v) => v.artifactId === a.id).slice(0, 12).map((v) => ({ check: v.check, status: v.status, at: v.verifiedAt })) })) });
});
export const verifyArtifact = guard(async (req, res) => res.status(202).json(await backups.verifyArtifactNow(req, req.params.id)));
export const backupStatus = guard(async (req, res) => res.json(toJson(await backups.backupStatus())));

// ─── Restores and drills ──────────────────────────────────────────────────────
const serializePlan = (p) => ({ id: p.publicId, target: p.target, recoveryType: p.recoveryType, recoveryTarget: p.recoveryTarget, walCoverageValidated: p.walCoverageValidated, walCoverage: p.walCoverage, incidentRef: p.incidentRef, changeRef: p.changeRef, status: p.status, requestedByUserId: p.requestedByUserId, approvedByUserId: p.approvedByUserId, approvedAt: p.approvedAt, separationException: p.separationException, createdAt: p.createdAt, version: p.version });
export const listRestores = guard(async (req, res) => {
  const plans = await prisma.restorePlan.findMany({ where: { environment: env() }, orderBy: { createdAt: "desc" }, take: page(req.query) });
  const execs = await prisma.restoreExecution.findMany({ where: { planId: { in: plans.map((p) => p.id) } }, orderBy: { createdAt: "desc" } });
  res.json(toJson({ plans: plans.map((p) => ({ ...serializePlan(p), executions: execs.filter((e) => e.planId === p.id).map((e) => ({ id: e.id, status: e.status, target: e.targetLabel, startedAt: e.startedAt, completedAt: e.completedAt, recoveredTo: e.recoveredTo, validation: e.validation, failureSummary: e.failureSummary, cleanedUpAt: e.cleanedUpAt })) })) }));
});
export const planRestore = guard(async (req, res) => res.status(201).json(serializePlan(await restores.planRestore(req, req.body || {}))));
export const approveRestore = guard(async (req, res) => res.json(serializePlan(await restores.decideRestore(req, req.params.id, { approve: true, note: req.body?.note, separationException: req.body?.separationException }))));
export const rejectRestore = guard(async (req, res) => res.json(serializePlan(await restores.decideRestore(req, req.params.id, { approve: false, note: req.body?.note }))));
export const executeRestore = guard(async (req, res) => res.status(202).json(toJson(await restores.executeRestore(req, req.params.id))));
export const cancelRestore = guard(async (req, res) => res.json(await restores.cancelRestore(req, req.params.id, req.body?.reason)));
export const listDrills = guard(async (req, res) => res.json({ drills: (await prisma.restoreDrill.findMany({ where: { environment: env() }, orderBy: { createdAt: "desc" }, take: page(req.query) })).map(restores.serializeDrill) }));
export const createDrill = guard(async (req, res) => {
  const d = req.body?.mode === "start" ? await restores.startDrill(req, req.body || {}) : await restores.recordDrill(req, req.body || {});
  res.status(201).json(restores.serializeDrill(d));
});

// ─── Disaster recovery ────────────────────────────────────────────────────────
export const listDrPlans = guard(async (req, res) => { await dr.seedDrPlans(); res.json({ plans: (await prisma.drPlan.findMany({ where: { environment: env() }, orderBy: { key: "asc" } })).map(dr.serializePlan), states: dr.PLAN_STATES, singleHost: "The platform runs on one host and one database; a second backup location does not make it highly available." }); });
export const transitionDrPlan = guard(async (req, res) => res.json(await dr.transitionPlan(req, req.params.key, req.body?.to, { expectedVersion: req.body?.version, note: req.body?.note })));
export const listDrDrills = guard(async (req, res) => res.json({ drills: await prisma.drDrill.findMany({ where: { environment: env() }, orderBy: { createdAt: "desc" }, take: page(req.query) }), states: dr.DRILL_STATES }));
export const scheduleDrDrill = guard(async (req, res) => res.status(201).json(await dr.scheduleDrill(req, req.body || {})));
export const transitionDrDrill = guard(async (req, res) => res.json(await dr.transitionDrill(req, req.params.id, req.body?.to, req.body || {})));
export const listIncidents = guard(async (req, res) => {
  const rows = await prisma.drIncident.findMany({ where: { environment: env() }, orderBy: { declaredAt: "desc" }, take: page(req.query) });
  const actions = await prisma.drIncidentAction.findMany({ where: { incidentId: { in: rows.map((r) => r.id) } }, orderBy: { createdAt: "asc" } });
  res.json({ incidents: rows.map((i) => ({ id: i.publicId, title: i.title, severity: i.severity, status: i.status, declaredAt: i.declaredAt, declaredByUserId: i.declaredByUserId, summary: i.summary, closedAt: i.closedAt, version: i.version, allowedNext: dr.INCIDENT_TRANSITIONS[i.status], actions: actions.filter((a) => a.incidentId === i.id).map((a) => ({ from: a.fromStatus, to: a.toStatus, note: a.note, at: a.createdAt, actorUserId: a.actorUserId })) })), states: dr.INCIDENT_STATES });
});
export const declareIncident = guard(async (req, res) => { const i = await dr.declareIncident(req, req.body || {}); res.status(201).json({ id: i.publicId, status: i.status }); });
export const transitionIncident = guard(async (req, res) => { const i = await dr.transitionIncident(req, req.params.id, req.body?.to, { note: req.body?.note, expectedVersion: req.body?.version }); res.json({ id: i.publicId, status: i.status, version: i.version }); });

// ─── Releases and deployments ─────────────────────────────────────────────────
export const listReleases = guard(async (req, res) => {
  const rows = await prisma.releaseArtifact.findMany({ orderBy: { createdAt: "desc" }, take: page(req.query) });
  const [sboms, scans, approvals] = await Promise.all([prisma.sbomReference.findMany({ where: { releaseId: { in: rows.map((r) => r.releaseId) } } }), prisma.scanReport.findMany({ where: { releaseId: { in: rows.map((r) => r.releaseId) } } }), prisma.releaseApproval.findMany({ where: { releaseId: { in: rows.map((r) => r.releaseId) } } })]);
  res.json({ releases: rows.map((r) => ({ ...releases.serializeRelease(r), sboms: sboms.filter((s) => s.releaseId === r.releaseId).map((s) => ({ component: s.component, format: s.format, componentCount: s.componentCount, sha256: s.sha256 })), scans: scans.filter((s) => s.releaseId === r.releaseId).map((s) => ({ scanner: s.scanner, target: s.target, status: s.status, summary: s.summary })), approvals: approvals.filter((a) => a.releaseId === r.releaseId).map((a) => ({ environment: a.environment, decision: a.decision, approverUserId: a.approverUserId, at: a.createdAt })) })) });
});
export const registerRelease = guard(async (req, res) => { const r = await releases.registerRelease(req, req.body || {}); res.status(r.existing ? 200 : 201).json({ ...releases.serializeRelease(r.release), existing: r.existing }); });
export const approveRelease = guard(async (req, res) => res.json(await releases.approveRelease(req, req.params.id, req.body || {})));
export const listDeployments = guard(async (req, res) => res.json({ deployments: (await prisma.deploymentPlan.findMany({ where: { environment: env() }, orderBy: { createdAt: "desc" }, take: page(req.query) })).map((d) => deployments.serializeDeployment(d)), states: deployments.DEPLOYMENT_STATES }));
export const getDeployment = guard(async (req, res) => {
  const d = await prisma.deploymentPlan.findFirst({ where: { publicId: String(req.params.id), environment: env() } });
  if (!d) throw new PlatformError(404, "NOT_FOUND", "Deployment not found.");
  const [gates, events, rollbacks, release] = await Promise.all([prisma.deploymentGate.findMany({ where: { deploymentId: d.id }, orderBy: { key: "asc" } }), prisma.deploymentEvent.findMany({ where: { deploymentId: d.id }, orderBy: { createdAt: "asc" } }), prisma.rollbackPlan.findMany({ where: { deploymentId: d.id } }), prisma.releaseArtifact.findUnique({ where: { releaseId: d.releaseId } })]);
  res.json(deployments.serializeDeployment(d, { release: release ? { releaseId: release.releaseId, images: release.images, migrationVersion: release.migrationVersion } : null, gates: gates.map((g) => ({ key: g.key, status: g.status, mandatory: g.mandatory, detail: g.detail })), events: events.map((e) => ({ type: e.type, status: e.status, message: e.message, at: e.createdAt, byAutomation: !!e.automationTokenId })), rollbacks: rollbacks.map((r) => ({ id: r.publicId, mode: r.mode, targetReleaseId: r.targetReleaseId, schemaCompatible: r.schemaCompatible, reason: r.compatibilityReason, status: r.status })) }));
});
export const planDeployment = guard(async (req, res) => res.status(201).json(deployments.serializeDeployment(await deployments.planDeployment(req, req.body || {}))));
export const approveDeployment = guard(async (req, res) => res.json(deployments.serializeDeployment(await deployments.approveDeployment(req, req.params.id, { approve: req.body?.approve !== false, note: req.body?.note, separationException: req.body?.separationException, expectedVersion: req.body?.version }))));
export const executeDeployment = guard(async (req, res) => { const r = await deployments.executeDeployment(req, req.params.id); res.status(r.blocked ? 409 : 202).json(toJson(r)); });
export const rollbackDeployment = guard(async (req, res) => { const r = await deployments.requestRollback(req, req.params.id, req.body || {}); res.status(202).json(toJson({ rollback: { id: r.plan.publicId, status: r.plan.status, schemaCompatible: r.plan.schemaCompatible }, compatibility: r.compatibility })); });
export const approveRollback = guard(async (req, res) => res.json(deployments.serializeDeployment(await deployments.approveRollback(req, req.params.id, req.body || {}))));
export const cancelDeployment = guard(async (req, res) => res.json(await deployments.cancelDeployment(req, req.params.id, req.body?.reason)));
// Automation (host script) endpoints.
export const automationGetDeployment = guard(async (req, res) => {
  const d = await prisma.deploymentPlan.findFirst({ where: { publicId: String(req.params.id), environment: env() } });
  if (!d) throw new PlatformError(404, "NOT_FOUND", "Deployment not found.");
  const release = await prisma.releaseArtifact.findUnique({ where: { releaseId: d.releaseId } });
  res.json({ id: d.publicId, status: d.status, releaseId: d.releaseId, images: release?.images || null, migrationVersion: release?.migrationVersion || null, maintenanceRequired: d.maintenanceRequired, rollbackOf: d.rollbackOfId ? true : false });
});
export const automationReport = guard(async (req, res) => res.json(await deployments.reportProgress(req, req.params.id, { status: req.body?.status, message: req.body?.message })));
export const automationRecordDrill = guard(async (req, res) => res.status(201).json(restores.serializeDrill(await restores.recordDrill({ ...req, user: { id: null } }, req.body || {}))));

// ─── System health, capacity and alerts ───────────────────────────────────────
export const systemHealth = guard(async (req, res) => res.json(await detailedHealth()));
export const systemCapacity = guard(async (req, res) => {
  const [db, http, slow] = await Promise.all([databaseCapacity().catch(() => null), httpWindow(15).catch(() => null), slowEndpoints(60).catch(() => [])]);
  const repo = (await backups.backupStatus()).repository;
  res.json(toJson({ disk: diskUsage(), database: db, backupRepository: repo, http15m: http, slowEndpoints: slow, process: { rssBytes: process.memoryUsage().rss, uptimeSeconds: Math.round(process.uptime()) } }));
});
export const listAlerts = guard(async (req, res) => {
  const [policies, events] = await Promise.all([prisma.platformAlertPolicy.findMany({ where: { environment: env() }, orderBy: { key: "asc" } }), prisma.platformAlertEvent.findMany({ where: { environment: env() }, orderBy: { lastFiredAt: "desc" }, take: 200 })]);
  res.json({ policies, events });
});
export const updateAlertPolicy = guard(async (req, res) => {
  let p;
  try { p = await alerts.updatePolicy(req, req.params.key, req.body || {}); } catch (e) { throw new PlatformError(422, "INVALID_POLICY", `Invalid ${e.message}.`); }
  if (!p) throw new PlatformError(404, "NOT_FOUND", "Alert policy not found.");
  res.json(p);
});
export const acknowledgeAlert = guard(async (req, res) => {
  const e = await prisma.platformAlertEvent.findFirst({ where: { id: String(req.params.id), environment: env() } });
  if (!e) throw new PlatformError(404, "NOT_FOUND", "Alert not found.");
  res.json(await prisma.platformAlertEvent.update({ where: { id: e.id }, data: { status: "Acknowledged", acknowledgedByUserId: req.user.id } }));
});
export const evaluateAlertsNow = guard(async (req, res) => res.json(await alerts.evaluateAlerts()));
export const listJobRuns = guard(async (req, res) => res.json({ runs: await prisma.platformJobRun.findMany({ where: { environment: env() }, orderBy: { startedAt: "desc" }, take: page(req.query, 500) }) }));

// ─── Retention ────────────────────────────────────────────────────────────────
export const listRetention = guard(async (req, res) => res.json({ categories: await retention.policiesFor(), runs: await prisma.retentionRun.findMany({ where: { environment: env() }, orderBy: { startedAt: "desc" }, take: 50 }), note: "Data removed from the live system can remain in protected backups until those backups expire." }));
export const setRetention = guard(async (req, res) => res.json(await retention.setPolicy(req, req.body || {})));
export const runRetention = guard(async (req, res) => {
  const dryRun = req.body?.dryRun !== false;
  if (req.body?.category) return res.json(await retention.runRetention(String(req.body.category), { dryRun }));
  res.json({ results: await retention.runAllRetention({ dryRun }) });
});

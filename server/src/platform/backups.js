// Backend Phase 13 — backup policies, jobs, artifacts and verification.
//
// Execution belongs to pgBackRest in the isolated backup agent (encrypted
// full/differential/incremental backups with continuous WAL archiving for
// point-in-time recovery, plus a logical pg_dump for portability and
// configuration and object-storage copies). This module schedules and
// dispatches work, ingests results into artifacts, and records verification
// separately from job results. A backup is "Verified" only after an isolated
// restore and a post-restore smoke check have passed.
import prisma from "../lib/prisma.js";
import { PlatformError, currentEnvironment, publicId, platformAudit, toJson } from "./common.js";
import { writeRequest, readResults, markProcessed, readStatus, agentConfigured, requestPending } from "./agentControl.js";

export const BACKUP_TYPES = ["full", "diff", "incr", "logical", "configuration", "object"];
export const VERIFICATION_CHECKS = ["existence", "manifest", "checksum", "wal_continuity", "encryption", "coverage", "native_check", "isolated_restore", "app_smoke"];
const JOB_TIMEOUT_MS = Number(process.env.BACKUP_JOB_TIMEOUT_MS) || 6 * 3_600_000;

export async function seedBackupPolicies(environment = currentEnvironment()) {
  const defaults = [
    { name: "PostgreSQL (pgBackRest)", dataSource: "postgres", repositories: [{ id: "repo1", label: "primary (backup volume)" }, { id: "repo2", label: "off-host (object storage, versioned)" }] },
    { name: "Object storage", dataSource: "object_storage", fullIntervalHours: 24, diffIntervalHours: 24, incrIntervalHours: 24, repositories: [{ id: "objects-offsite", label: "versioned off-host bucket" }] },
    { name: "Configuration and release manifests", dataSource: "configuration", fullIntervalHours: 24, diffIntervalHours: 24, incrIntervalHours: 24, repositories: [{ id: "config-offsite", label: "encrypted off-host archive" }] },
  ];
  let created = 0;
  for (const d of defaults) {
    const exists = await prisma.backupPolicy.findUnique({ where: { environment_name: { environment, name: d.name } } });
    if (exists) continue;
    await prisma.backupPolicy.create({ data: { publicId: publicId("bp"), environment, ...d } });
    created += 1;
  }
  return created;
}

const POLICY_FIELDS = { fullIntervalHours: [1, 24 * 31], diffIntervalHours: [1, 24 * 7], incrIntervalHours: [1, 24], logicalExportIntervalHours: [1, 24 * 7], retentionFull: [1, 52], retentionDiff: [1, 90], walArchiveMaxLagMinutes: [1, 240], verifyIntervalHours: [1, 24 * 7], restoreTestIntervalDays: [1, 180], rpoTargetMinutes: [1, 24 * 60], rtoTargetMinutes: [5, 7 * 24 * 60] };

export async function upsertPolicy(req, body) {
  const environment = currentEnvironment();
  const data = {};
  for (const [k, [min, max]] of Object.entries(POLICY_FIELDS)) {
    if (body[k] === undefined) continue;
    const n = Number(body[k]);
    if (!Number.isInteger(n) || n < min || n > max) throw new PlatformError(422, "INVALID_POLICY", `${k} must be a whole number from ${min} to ${max}.`);
    data[k] = n;
  }
  if (body.status !== undefined) { if (!["Active", "Paused"].includes(body.status)) throw new PlatformError(422, "INVALID_POLICY", "status must be Active or Paused."); data.status = body.status; }
  if (body.encryptionRequired === false) throw new PlatformError(422, "ENCRYPTION_REQUIRED", "Backups must be encrypted.");
  // Changing RPO/RTO targets resets their approval: they're planning values until approved again.
  if (data.rpoTargetMinutes !== undefined || data.rtoTargetMinutes !== undefined) Object.assign(data, { targetsApproved: false, targetsApprovedByUserId: null, targetsApprovedAt: null });
  let policy;
  if (body.id) {
    const existing = await prisma.backupPolicy.findFirst({ where: { publicId: String(body.id), environment } });
    if (!existing) throw new PlatformError(404, "NOT_FOUND", "Backup policy not found.");
    const { count } = await prisma.backupPolicy.updateMany({ where: { id: existing.id, ...(body.version !== undefined ? { version: Number(body.version) } : {}) }, data: { ...data, version: { increment: 1 } } });
    if (!count) throw new PlatformError(409, "VERSION_CONFLICT", "The policy changed. Refresh and try again.");
    policy = await prisma.backupPolicy.findUnique({ where: { id: existing.id } });
  } else {
    const name = String(body.name || "").trim();
    if (!name) throw new PlatformError(422, "INVALID_POLICY", "name is required.");
    if (!["postgres", "object_storage", "configuration"].includes(body.dataSource)) throw new PlatformError(422, "INVALID_POLICY", "dataSource must be postgres, object_storage or configuration.");
    policy = await prisma.backupPolicy.create({ data: { publicId: publicId("bp"), environment, name: name.slice(0, 120), dataSource: body.dataSource, createdByUserId: req.user.id, ...data } });
  }
  await platformAudit(req, "backup.policy_saved", "BackupPolicy", policy.publicId, { after: data });
  return policy;
}

// Approving RPO/RTO turns planning targets into service commitments.
export async function approveTargets(req, id) {
  const p = await prisma.backupPolicy.findFirst({ where: { publicId: String(id), environment: currentEnvironment() } });
  if (!p) throw new PlatformError(404, "NOT_FOUND", "Backup policy not found.");
  const updated = await prisma.backupPolicy.update({ where: { id: p.id }, data: { targetsApproved: true, targetsApprovedByUserId: req.user.id, targetsApprovedAt: new Date(), version: { increment: 1 } } });
  await platformAudit(req, "backup.targets_approved", "BackupPolicy", p.publicId, { after: { rpoTargetMinutes: p.rpoTargetMinutes, rtoTargetMinutes: p.rtoTargetMinutes } });
  return updated;
}

export async function enqueueJob({ policyId = null, dataSource = "postgres", backupType, trigger = "manual", requestedByUserId = null, correlationId = null, environment = currentEnvironment() }) {
  if (![...BACKUP_TYPES, "verify", "check", "expire"].includes(backupType)) throw new PlatformError(422, "INVALID_TYPE", `backupType must be one of ${BACKUP_TYPES.join(", ")}, verify, check or expire.`);
  // One active job per type (idempotent scheduling).
  const active = await prisma.backupJob.findFirst({ where: { environment, backupType, status: { in: ["Queued", "Dispatched", "Running"] } } });
  if (active) return { job: active, existing: true };
  const job = await prisma.backupJob.create({ data: { publicId: publicId("bj"), environment, policyId, dataSource, backupType, trigger, requestedByUserId, correlationId } });
  return { job, existing: false };
}

export async function runBackupNow(req, { backupType = "full" }) {
  if (!agentConfigured()) throw new PlatformError(503, "AGENT_NOT_CONFIGURED", "The backup agent is not configured in this environment (BACKUP_CONTROL_DIR). Run backups with the runbook on the host.");
  const policy = await prisma.backupPolicy.findFirst({ where: { environment: currentEnvironment(), dataSource: backupType === "object" ? "object_storage" : backupType === "configuration" ? "configuration" : "postgres" } });
  const r = await enqueueJob({ policyId: policy?.id || null, dataSource: policy?.dataSource || "postgres", backupType, trigger: "manual", requestedByUserId: req.user.id, correlationId: req.correlationId });
  await platformAudit(req, "backup.run_requested", "BackupJob", r.job.publicId, { after: { backupType, existing: r.existing } });
  return r;
}

const AGENT_OP = { full: ["backup", { type: "full" }], diff: ["backup", { type: "diff" }], incr: ["backup", { type: "incr" }], logical: ["logical", {}], configuration: ["configuration", {}], object: ["object_backup", {}], verify: ["verify", {}], check: ["check", {}] };

// Worker: hand queued jobs to the agent.
export async function dispatchQueued() {
  if (!agentConfigured()) return 0;
  const queued = await prisma.backupJob.findMany({ where: { environment: currentEnvironment(), status: "Queued" }, orderBy: { createdAt: "asc" }, take: 5 });
  for (const job of queued) {
    const claimed = await prisma.backupJob.updateMany({ where: { id: job.id, status: "Queued" }, data: { status: "Dispatched", dispatchedAt: new Date(), attempts: { increment: 1 } } });
    if (!claimed.count) continue;
    let op = AGENT_OP[job.backupType];
    if (job.backupType === "expire") {
      const policy = job.policyId ? await prisma.backupPolicy.findUnique({ where: { id: job.policyId } }) : null;
      op = ["expire", { retentionFull: policy?.retentionFull || 4, retentionDiff: policy?.retentionDiff || 14 }];
    }
    writeRequest({ id: job.publicId, type: op[0], params: op[1], environment: job.environment, correlationId: job.correlationId });
  }
  return queued.length;
}

// pgBackRest `info --output=json` → artifact rows (idempotent by label).
export function artifactsFromInfo(info, environment) {
  const stanza = Array.isArray(info) ? info[0] : null;
  if (!stanza) return [];
  const cipher = stanza.cipher && stanza.cipher !== "none";
  const dbVersion = stanza.db?.[stanza.db.length - 1]?.version || null;
  return (stanza.backup || []).map((b) => ({
    environment, dataSource: "postgres", backupType: b.type, label: b.label,
    startedAt: b.timestamp?.start ? new Date(b.timestamp.start * 1000) : null, completedAt: b.timestamp?.stop ? new Date(b.timestamp.stop * 1000) : null,
    status: b.error ? "Failed" : "Succeeded", tool: "pgBackRest", toolVersion: b.backrest?.version || null, databaseVersion: dbVersion,
    walStart: b.archive?.start || null, walStop: b.archive?.stop || null,
    recoverableFrom: b.timestamp?.stop ? new Date(b.timestamp.stop * 1000) : null,
    locationId: `pgbackrest:${stanza.name}:repo${b.database?.["repo-key"] || 1}`, encrypted: !!cipher, encryptionKeyVersion: cipher ? String(stanza.cipher) : null,
    sizeBytes: b.info?.repository?.size ?? b.info?.size ?? null, checksum: b.lsn ? `lsn:${b.lsn.start}-${b.lsn.stop}` : null,
  }));
}

async function upsertArtifacts(rows, jobId = null) {
  const out = [];
  for (const r of rows) {
    const existing = await prisma.backupArtifact.findUnique({ where: { environment_dataSource_label: { environment: r.environment, dataSource: r.dataSource, label: r.label } } });
    if (existing) out.push(await prisma.backupArtifact.update({ where: { id: existing.id }, data: { status: r.status, sizeBytes: r.sizeBytes, walStop: r.walStop } }));
    else out.push(await prisma.backupArtifact.create({ data: { publicId: publicId("ba"), ...r, jobId } }));
  }
  return out;
}

async function recordVerification(artifact, check, status, details = {}, extra = {}) {
  await prisma.backupVerification.create({ data: { artifactId: artifact.id, environment: artifact.environment, check, status, details: toJson(details), ...extra } });
}

// Recomputes an artifact's verification status: Verified only when every
// mandatory check has passed, including an isolated restore and a smoke test.
export async function refreshVerificationStatus(artifactId) {
  const rows = await prisma.backupVerification.findMany({ where: { artifactId }, orderBy: { verifiedAt: "desc" } });
  const latest = {};
  for (const r of rows) if (!latest[r.check]) latest[r.check] = r;
  const art = await prisma.backupArtifact.findUnique({ where: { id: artifactId } });
  const required = art.dataSource === "postgres" ? ["existence", "checksum", "wal_continuity", "encryption", "native_check", "isolated_restore", "app_smoke"] : ["existence", "checksum", "encryption"];
  const failed = Object.values(latest).some((r) => r.status === "Failed");
  const complete = required.every((c) => latest[c]?.status === "Passed");
  const status = failed ? "Verification failed" : complete ? "Verified" : "Unverified";
  await prisma.backupArtifact.update({ where: { id: artifactId }, data: { verificationStatus: status, lastVerifiedAt: rows[0]?.verifiedAt || null } });
  return { status, latest: Object.fromEntries(Object.entries(latest).map(([k, v]) => [k, v.status])) };
}

// Worker: ingest agent results into jobs, artifacts and verifications.
export async function ingestAgentResults() {
  let n = 0;
  for (const { file, result } of readResults()) {
    n += 1;
    if (!result?.id) { console.warn(`[backups] unreadable agent result ${file}; archived without effect`); markProcessed(file); continue; }
    const job = await prisma.backupJob.findUnique({ where: { publicId: result.id } });
    if (result.type === "restore" || result.type === "restore_cleanup" || result.type === "object_restore") {
      const { ingestRestoreResult } = await import("./restores.js");
      await ingestRestoreResult(result);
      markProcessed(file);
      continue;
    }
    if (!job) { markProcessed(file); continue; }
    const ok = result.status === "succeeded";
    const safeError = ok ? null : String(result.error || "The backup agent reported a failure.").slice(0, 500);
    await prisma.backupJob.update({ where: { id: job.id }, data: { status: ok ? "Succeeded" : "Failed", startedAt: result.startedAt ? new Date(result.startedAt) : job.startedAt, completedAt: result.completedAt ? new Date(result.completedAt) : new Date(), toolExitCode: Number.isInteger(result.exitCode) ? result.exitCode : null, failureSummary: safeError } });
    if (["full", "diff", "incr"].includes(job.backupType) && result.output?.info) {
      const arts = await upsertArtifacts(artifactsFromInfo(result.output.info, job.environment), job.id);
      // One job backs up to each repository (repo1, then repo2): every set it made gets the checks.
      const since = job.dispatchedAt || job.createdAt;
      const made = arts.filter((a) => a.backupType === job.backupType && a.completedAt && a.completedAt >= since).sort((a, b) => b.completedAt - a.completedAt);
      if (made[0]) await prisma.backupJob.update({ where: { id: job.id }, data: { artifactId: made[0].id } });
      for (const art of made) {
        await recordVerification(art, "existence", "Passed", { source: "pgbackrest info" });
        await recordVerification(art, "encryption", art.encrypted ? "Passed" : "Failed", { cipher: art.encryptionKeyVersion || "none" });
        await refreshVerificationStatus(art.id);
      }
    }
    if (["logical", "configuration", "object"].includes(job.backupType) && ok && result.output?.artifact) {
      const a = result.output.artifact;
      const [art] = await upsertArtifacts([{
        environment: job.environment, dataSource: job.backupType === "object" ? "object_storage" : job.backupType === "configuration" ? "configuration" : "postgres",
        backupType: job.backupType, label: String(a.label).slice(0, 120), startedAt: result.startedAt ? new Date(result.startedAt) : null, completedAt: result.completedAt ? new Date(result.completedAt) : new Date(),
        status: "Succeeded", tool: String(a.tool || "agent").slice(0, 60), toolVersion: a.toolVersion || null, databaseVersion: a.databaseVersion || null,
        locationId: String(a.locationId).slice(0, 200), encrypted: !!a.encrypted, encryptionKeyVersion: a.encryptionKeyVersion || null, sizeBytes: a.sizeBytes ?? null, checksum: a.sha256 ? `sha256:${a.sha256}` : null,
      }], job.id);
      await prisma.backupJob.update({ where: { id: job.id }, data: { artifactId: art.id } });
      await recordVerification(art, "existence", "Passed", { source: "agent" });
      await recordVerification(art, "checksum", a.sha256 ? "Passed" : "Failed", { algorithm: "sha256" });
      await recordVerification(art, "encryption", a.encrypted ? "Passed" : "Failed", {});
      await refreshVerificationStatus(art.id);
    }
    if (job.backupType === "verify") {
      // pgBackRest `verify` checks every file's checksum and the WAL chain for the repository.
      const latest = await prisma.backupArtifact.findMany({ where: { environment: job.environment, dataSource: "postgres", status: "Succeeded", backupType: { in: ["full", "diff", "incr"] } }, orderBy: { completedAt: "desc" }, take: 5 });
      for (const art of latest) {
        await recordVerification(art, "native_check", ok ? "Passed" : "Failed", { tool: "pgbackrest verify", summary: result.output?.summary || null });
        await recordVerification(art, "checksum", ok ? "Passed" : "Failed", { tool: "pgbackrest verify" });
        await recordVerification(art, "manifest", ok ? "Passed" : "Failed", { tool: "pgbackrest verify" });
        await recordVerification(art, "wal_continuity", ok && !result.output?.walGaps ? "Passed" : "Failed", { walGaps: result.output?.walGaps || 0 });
        await refreshVerificationStatus(art.id);
      }
    }
    await platformAudit({ correlationId: job.correlationId }, `backup.${ok ? "succeeded" : "failed"}`, "BackupJob", job.publicId, { result: ok ? "Success" : "Failure", reason: safeError });
    if (!ok) {
      const { recordFinding } = await import("./findings.js");
      await recordFinding({ category: "configuration", source: "backup-agent", title: `Backup job ${job.backupType} failed`, severity: "High", component: "backups", fingerprint: `backup-failed:${job.environment}:${job.backupType}` });
    }
    markProcessed(file);
  }
  return n;
}

// Worker: record every backup set the agent reports in its status
// (`pgbackrest info`), including ones not started by a platform job (a manual
// or pre-deployment backup, or a job whose result report was lost). Idempotent
// by label; new sets get their existence and encryption checks recorded.
export async function syncArtifactsFromStatus() {
  const info = readStatus()?.info;
  if (!info) return { synced: 0 };
  const rows = artifactsFromInfo(info, currentEnvironment());
  let created = 0;
  for (const r of rows) {
    const existing = await prisma.backupArtifact.findUnique({ where: { environment_dataSource_label: { environment: r.environment, dataSource: r.dataSource, label: r.label } } });
    const [art] = await upsertArtifacts([r]);
    if (!existing && art) {
      created += 1;
      await recordVerification(art, "existence", "Passed", { source: "pgbackrest info" });
      await recordVerification(art, "encryption", art.encrypted ? "Passed" : "Failed", { cipher: art.encryptionKeyVersion || "none" });
      await refreshVerificationStatus(art.id);
    }
  }
  return { synced: rows.length, created };
}

// Worker: jobs that never came back are timed out (never deleted: failures stay for investigation).
export async function timeOutStuckJobs(now = new Date()) {
  const environment = currentEnvironment();
  // A job started before the agent last (re)started will never report back:
  // the agent drops the request when it starts a job. Close it now instead of
  // after the timeout, so the next job of that type can run.
  const startedAt = readStatus()?.heartbeat?.startedAt;
  const agentStartedAt = startedAt ? new Date(startedAt) : null;
  let interrupted = 0;
  if (agentStartedAt && !Number.isNaN(agentStartedAt.getTime())) {
    const lost = await prisma.backupJob.findMany({ where: { environment, status: { in: ["Dispatched", "Running"] }, dispatchedAt: { lt: agentStartedAt } } });
    for (const job of lost.filter((j) => !requestPending(j.publicId))) {
      const r = await prisma.backupJob.updateMany({ where: { id: job.id, status: { in: ["Dispatched", "Running"] } }, data: { status: "Interrupted", completedAt: now, failureSummary: "The backup agent restarted while this job was running; the schedule runs it again." } });
      interrupted += r.count;
    }
    const { closeInterruptedRestores } = await import("./restores.js");
    interrupted += await closeInterruptedRestores(agentStartedAt, now);
  }
  const { count } = await prisma.backupJob.updateMany({ where: { environment, status: { in: ["Dispatched", "Running"] }, dispatchedAt: { lt: new Date(now.getTime() - JOB_TIMEOUT_MS) } }, data: { status: "Timed out", failureSummary: "No result from the backup agent within the timeout." } });
  return count + interrupted;
}

// Worker: schedule what each active policy says is due.
export async function scheduleDueBackups(now = new Date()) {
  if (!agentConfigured()) return [];
  const environment = currentEnvironment();
  const queued = [];
  const lastSuccess = async (types) => (await prisma.backupJob.findFirst({ where: { environment, backupType: { in: types }, status: "Succeeded" }, orderBy: { completedAt: "desc" } }))?.completedAt || null;
  const age = (d) => (d ? (now - d) / 3_600_000 : Infinity);
  // After a failure, wait before trying the same type again (the failure is
  // already a finding and an alert; retrying every minute only adds noise).
  const RETRY_AFTER_HOURS = Number(process.env.BACKUP_RETRY_AFTER_HOURS) || 1;
  const failedRecently = async (type) => {
    const f = await prisma.backupJob.findFirst({ where: { environment, backupType: type, status: { in: ["Failed", "Timed out"] } }, orderBy: { createdAt: "desc" } });
    return !!f && age(f.completedAt || f.createdAt) < RETRY_AFTER_HOURS;
  };
  const due = async (type, lastOkTypes, intervalHours) => age(await lastSuccess(lastOkTypes)) >= intervalHours && !(await failedRecently(type));
  for (const p of await prisma.backupPolicy.findMany({ where: { environment, status: "Active" } })) {
    const base = { policyId: p.id, dataSource: p.dataSource, trigger: "schedule", environment };
    if (p.dataSource === "postgres") {
      const full = await lastSuccess(["full"]);
      const diff = await lastSuccess(["full", "diff"]);
      const any = await lastSuccess(["full", "diff", "incr"]);
      let type = null;
      if (age(full) >= p.fullIntervalHours) type = "full";
      else if (age(diff) >= p.diffIntervalHours) type = "diff";
      else if (age(any) >= p.incrIntervalHours) type = "incr";
      if (type && await failedRecently(type)) type = null;
      if (type) queued.push((await enqueueJob({ ...base, backupType: type })).job);
      if (await due("logical", ["logical"], p.logicalExportIntervalHours)) queued.push((await enqueueJob({ ...base, backupType: "logical" })).job);
      if (await due("verify", ["verify"], p.verifyIntervalHours)) queued.push((await enqueueJob({ ...base, backupType: "verify" })).job);
      if (await due("expire", ["expire"], 24)) queued.push((await enqueueJob({ ...base, backupType: "expire" })).job);
    } else {
      // Object storage is only backed up once it exists (the Documents service isn't built yet).
      if (p.dataSource === "object_storage" && !process.env.OBJECT_STORAGE_ENDPOINT) continue;
      const type = p.dataSource === "object_storage" ? "object" : "configuration";
      if (await due(type, [type], p.fullIntervalHours)) queued.push((await enqueueJob({ ...base, backupType: type })).job);
    }
  }
  return queued;
}

export const serializeArtifact = (a) => toJson({
  id: a.publicId, environment: a.environment, dataSource: a.dataSource, backupType: a.backupType, label: a.label, status: a.status, tool: a.tool, toolVersion: a.toolVersion,
  databaseVersion: a.databaseVersion, startedAt: a.startedAt, completedAt: a.completedAt, walStart: a.walStart, walStop: a.walStop, recoverableFrom: a.recoverableFrom, recoverableTo: a.recoverableTo,
  locationId: a.locationId, encrypted: a.encrypted, encryptionKeyVersion: a.encryptionKeyVersion ? "configured" : null, sizeBytes: a.sizeBytes, checksum: a.checksum,
  verificationStatus: a.verificationStatus, lastVerifiedAt: a.lastVerifiedAt, retentionExpiresAt: a.retentionExpiresAt, failureSummary: a.failureSummary,
});

export async function verifyArtifactNow(req, id) {
  const art = await prisma.backupArtifact.findFirst({ where: { publicId: String(id), environment: currentEnvironment() } });
  if (!art) throw new PlatformError(404, "NOT_FOUND", "Backup artifact not found.");
  if (!agentConfigured()) throw new PlatformError(503, "AGENT_NOT_CONFIGURED", "The backup agent is not configured in this environment.");
  const r = await enqueueJob({ dataSource: art.dataSource, backupType: "verify", trigger: "manual", requestedByUserId: req.user.id, correlationId: req.correlationId });
  await platformAudit(req, "backup.verify_requested", "BackupArtifact", art.publicId, {});
  return { job: r.job, note: "Repository verification is queued. An isolated restore (restore drill) is still required before the artifact is Verified." };
}

// Status for dashboards and alerting (agent heartbeat, WAL archiving, capacity).
export async function backupStatus(now = new Date()) {
  const environment = currentEnvironment();
  const status = readStatus();
  const policy = await prisma.backupPolicy.findFirst({ where: { environment, dataSource: "postgres" } });
  const lastBackup = await prisma.backupArtifact.findFirst({ where: { environment, dataSource: "postgres", status: "Succeeded", backupType: { in: ["full", "diff", "incr"] } }, orderBy: { completedAt: "desc" } });
  const lastVerified = await prisma.backupArtifact.findFirst({ where: { environment, verificationStatus: "Verified" }, orderBy: { lastVerifiedAt: "desc" } });
  const lastDrill = await prisma.restoreDrill.findFirst({ where: { environment, status: "Passed" }, orderBy: { completedAt: "desc" } });
  const archiver = status?.archiver || null;
  const walLagMinutes = archiver?.last_archived_time ? Math.round((now - new Date(archiver.last_archived_time)) / 60000) : null;
  const heartbeatAgeSec = status?.heartbeat?.at ? Math.round((now - new Date(status.heartbeat.at)) / 1000) : null;
  return {
    agentConfigured: agentConfigured(), agentHeartbeatAgeSeconds: heartbeatAgeSec,
    lastBackupAt: lastBackup?.completedAt || null, lastBackupAgeHours: lastBackup?.completedAt ? Math.round((now - lastBackup.completedAt) / 360000) / 10 : null,
    walArchive: archiver ? { lastArchivedAt: archiver.last_archived_time || null, lagMinutes: walLagMinutes, failedCount: archiver.failed_count ?? null, lastFailedAt: archiver.last_failed_time || null } : null,
    repository: status?.repository || null,
    lastVerifiedAt: lastVerified?.lastVerifiedAt || null, lastSuccessfulRestoreDrillAt: lastDrill?.completedAt || null,
    policy: policy ? { rpoTargetMinutes: policy.rpoTargetMinutes, rtoTargetMinutes: policy.rtoTargetMinutes, targetsApproved: policy.targetsApproved, restoreTestIntervalDays: policy.restoreTestIntervalDays, walArchiveMaxLagMinutes: policy.walArchiveMaxLagMinutes, fullIntervalHours: policy.fullIntervalHours, incrIntervalHours: policy.incrIntervalHours } : null,
    targetsNote: policy && !policy.targetsApproved ? "RPO/RTO are planning targets, not service commitments, until an approver accepts them." : null,
  };
}

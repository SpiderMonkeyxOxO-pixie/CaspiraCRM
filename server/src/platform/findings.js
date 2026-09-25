// Backend Phase 13 — security and vulnerability findings, dispositions and
// time-limited exceptions. Scanner reports (dependency, container, secret,
// Dockerfile, Compose, license) are ingested with the scanner, finding,
// severity, component, installed and fixed versions. Unresolved Critical
// findings block production deployment unless an approved, unexpired,
// audited exception exists — and nobody approves their own exception.
import crypto from "node:crypto";
import prisma from "../lib/prisma.js";
import { PlatformError, currentEnvironment, publicId, platformAudit } from "./common.js";
import { assertSeparation } from "./rbac.js";

export const SEVERITIES = ["Critical", "High", "Medium", "Low", "Informational"];
export const DISPOSITIONS = { fixed: "Fixed", false_positive: "False positive", accepted_risk: "Accepted risk", reopen: "Open" };

const normSeverity = (s) => {
  const v = String(s || "").toLowerCase();
  return v.startsWith("crit") ? "Critical" : v.startsWith("high") ? "High" : v.startsWith("mod") || v.startsWith("med") ? "Medium" : v.startsWith("low") ? "Low" : "Informational";
};

// Upsert by fingerprint (a repeat sighting refreshes lastSeenAt).
export async function recordFinding({ category, source, scope = "platform", title, severity, component = null, installedVersion = null, fixedVersion = null, fingerprint, releaseId = null, environment = currentEnvironment(), correlationId = null }) {
  const fp = fingerprint || crypto.createHash("sha256").update(`${category}|${source}|${component}|${title}`).digest("hex").slice(0, 32);
  const existing = await prisma.securityFinding.findUnique({ where: { environment_fingerprint: { environment, fingerprint: fp } } });
  if (existing) {
    const reopen = existing.status === "Fixed";
    return prisma.securityFinding.update({ where: { id: existing.id }, data: { lastSeenAt: new Date(), severity: normSeverity(severity), fixedVersion, installedVersion, releaseId: releaseId || existing.releaseId, scope, ...(reopen ? { status: "Open", resolvedAt: null } : {}) } });
  }
  return prisma.securityFinding.create({ data: { publicId: publicId("sf"), environment, category, source, scope, title: String(title).slice(0, 300), severity: normSeverity(severity), component, installedVersion, fixedVersion, fingerprint: fp, releaseId, correlationId } });
}

// Normalized scanner output: { scanner, target, findings: [{ id, title, severity, component, installedVersion, fixedVersion, category }] }.
// Findings from an earlier run of the same scanner and target that no longer
// appear are marked Fixed (with the run as evidence).
// A finding belongs to the scanned target (e.g. "dependency:web"), so a scan of
// one target never resolves another target's findings.
const scanScope = (report) => `scan:${String(report.target || "repository").slice(0, 180)}`;

export async function ingestScanReport(req, report, { releaseId = null } = {}) {
  if (!report || typeof report !== "object" || !report.scanner || !Array.isArray(report.findings)) throw new PlatformError(422, "INVALID_REPORT", "A scan report needs scanner, target and a findings array.");
  const environment = currentEnvironment();
  const seen = [];
  for (const f of report.findings.slice(0, 5000)) {
    const row = await recordFinding({
      category: f.category || "dependency", source: String(report.scanner).slice(0, 60), scope: scanScope(report), title: f.title || f.id || "Finding", severity: f.severity,
      component: f.component || null, installedVersion: f.installedVersion || null, fixedVersion: f.fixedVersion || null,
      fingerprint: crypto.createHash("sha256").update(`${report.scanner}|${report.target}|${f.id || f.title}|${f.component}|${f.installedVersion}`).digest("hex").slice(0, 32),
      releaseId, correlationId: req?.correlationId,
    });
    seen.push(row.id);
  }
  const resolved = await prisma.securityFinding.updateMany({
    where: { environment, source: String(report.scanner).slice(0, 60), scope: scanScope(report), status: "Open", id: { notIn: seen }, category: { in: [...new Set(report.findings.map((f) => f.category || "dependency")).values(), report.category || "dependency"] } },
    data: { status: "Fixed", resolvedAt: new Date(), disposition: "Fixed", dispositionNote: "No longer reported by the scanner." },
  });
  const counts = Object.fromEntries(SEVERITIES.map((s) => [s, report.findings.filter((f) => normSeverity(f.severity) === s).length]));
  const scan = await prisma.scanReport.create({ data: { releaseId, scanner: String(report.scanner).slice(0, 60), target: String(report.target || "repository").slice(0, 200), status: counts.Critical ? "Failed" : "Passed", summary: { counts, resolved: resolved.count }, reportSha256: report.sha256 || null, location: report.location || null } });
  await platformAudit(req, "security.scan_ingested", "ScanReport", scan.id, { after: { scanner: report.scanner, counts } });
  return { scan, counts, resolved: resolved.count };
}

export const serializeFinding = (f) => ({
  id: f.publicId, category: f.category, source: f.source, title: f.title, severity: f.severity, component: f.component, installedVersion: f.installedVersion,
  fixedVersion: f.fixedVersion, status: f.status, disposition: f.disposition, dispositionNote: f.dispositionNote, releaseId: f.releaseId,
  firstSeenAt: f.firstSeenAt, lastSeenAt: f.lastSeenAt, resolvedAt: f.resolvedAt, version: f.version,
});

export async function setDisposition(req, id, { disposition, note, expectedVersion }) {
  const f = await prisma.securityFinding.findFirst({ where: { publicId: String(id), environment: currentEnvironment() } });
  if (!f) throw new PlatformError(404, "NOT_FOUND", "Finding not found.");
  const status = DISPOSITIONS[disposition];
  if (!status) throw new PlatformError(422, "INVALID_DISPOSITION", `disposition must be one of: ${Object.keys(DISPOSITIONS).join(", ")}.`);
  if (String(note || "").trim().length < 10) throw new PlatformError(422, "NOTE_REQUIRED", "Explain the disposition (at least 10 characters).");
  // Accepting a Critical finding is an exception, not a disposition.
  if (disposition === "accepted_risk" && f.severity === "Critical") throw new PlatformError(422, "EXCEPTION_REQUIRED", "Critical findings can't be accepted permanently; request a time-limited exception.");
  const { count } = await prisma.securityFinding.updateMany({ where: { id: f.id, ...(expectedVersion !== undefined ? { version: Number(expectedVersion) } : {}) }, data: { status, disposition: status, dispositionNote: String(note).slice(0, 1000), dispositionByUserId: req.user.id, resolvedAt: status === "Open" ? null : new Date(), version: { increment: 1 } } });
  if (!count) throw new PlatformError(409, "VERSION_CONFLICT", "The finding changed. Refresh and try again.");
  await platformAudit(req, "security.finding_disposition", "SecurityFinding", f.publicId, { reason: note, before: { status: f.status }, after: { status } });
  return serializeFinding(await prisma.securityFinding.findUnique({ where: { id: f.id } }));
}

export async function requestException(req, id, { reason, scope, days }) {
  const f = await prisma.securityFinding.findFirst({ where: { publicId: String(id), environment: currentEnvironment() } });
  if (!f) throw new PlatformError(404, "NOT_FOUND", "Finding not found.");
  const d = Number(days);
  if (!Number.isInteger(d) || d < 1 || d > (f.severity === "Critical" ? 30 : 90)) throw new PlatformError(422, "INVALID_EXPIRY", `Exceptions last 1–${f.severity === "Critical" ? 30 : 90} days.`);
  if (String(reason || "").trim().length < 20) throw new PlatformError(422, "REASON_REQUIRED", "Justify the exception (at least 20 characters), including compensating controls.");
  const ex = await prisma.securityException.create({ data: { publicId: publicId("sx"), findingId: f.id, environment: f.environment, scope: String(scope || "deployment").slice(0, 200), reason: String(reason).slice(0, 2000), requestedByUserId: req.user.id, expiresAt: new Date(Date.now() + d * 86_400_000), correlationId: req.correlationId } });
  await platformAudit(req, "security.exception_requested", "SecurityException", ex.publicId, { reason, after: { finding: f.publicId, days: d } });
  return ex;
}

export async function decideException(req, exceptionId, { approve, note, separationException }) {
  const ex = await prisma.securityException.findFirst({ where: { publicId: String(exceptionId), environment: currentEnvironment() } });
  if (!ex) throw new PlatformError(404, "NOT_FOUND", "Exception not found.");
  if (ex.status !== "Requested") throw new PlatformError(409, "INVALID_STATE", `The exception is ${ex.status}.`);
  const finding = await prisma.securityFinding.findUnique({ where: { id: ex.findingId } });
  // Nobody approves their own critical-security exception — no staffing override.
  if (ex.requestedByUserId === req.user.id) {
    if (finding?.severity === "Critical") throw new PlatformError(403, "SEPARATION_OF_DUTIES", "You can't approve your own exception for a Critical finding.");
    await assertSeparation(req, ex.requestedByUserId, "security exception", separationException);
  }
  const updated = await prisma.securityException.update({ where: { id: ex.id }, data: approve ? { status: "Approved", approvedByUserId: req.user.id, approvedAt: new Date(), version: { increment: 1 } } : { status: "Rejected", approvedByUserId: req.user.id, version: { increment: 1 } } });
  if (approve) await prisma.securityFinding.update({ where: { id: ex.findingId }, data: { status: "Excepted", disposition: "Excepted", dispositionNote: `Exception ${ex.publicId} until ${ex.expiresAt.toISOString().slice(0, 10)}` } });
  await platformAudit(req, approve ? "security.exception_approved" : "security.exception_rejected", "SecurityException", ex.publicId, { reason: note });
  return updated;
}

// Worker: expired exceptions reopen their findings.
export async function expireExceptions(now = new Date()) {
  const expired = await prisma.securityException.findMany({ where: { status: "Approved", expiresAt: { lt: now } } });
  for (const ex of expired) {
    await prisma.securityException.update({ where: { id: ex.id }, data: { status: "Expired" } });
    await prisma.securityFinding.updateMany({ where: { id: ex.findingId, status: "Excepted" }, data: { status: "Open", disposition: null, dispositionNote: `Exception ${ex.publicId} expired.` } });
  }
  return expired.length;
}

// Unresolved Critical findings without a valid exception (deployment gate).
export async function blockingCriticalFindings(environment = currentEnvironment(), now = new Date()) {
  const open = await prisma.securityFinding.findMany({ where: { environment, severity: "Critical", status: { in: ["Open", "Excepted"] } } });
  const blocking = [];
  for (const f of open) {
    const ex = await prisma.securityException.findFirst({ where: { findingId: f.id, status: "Approved", expiresAt: { gt: now } } });
    if (!ex) blocking.push(f);
  }
  return blocking;
}

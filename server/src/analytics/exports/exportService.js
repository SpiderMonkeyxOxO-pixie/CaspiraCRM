// Backend Phase 12 — governed data exports. An export freezes its query at
// request time; generation re-checks the requester's CURRENT grants (never
// broader than at request), runs with their record scope, neutralizes
// formula injection, encrypts the file (AES-256-GCM, integration keyring)
// and expires it. Sensitive exports need approval by someone else. Links are
// never public: downloads require a session, are counted, limited and audited.
import crypto from "node:crypto";
import prisma from "../../lib/prisma.js";
import { QueryError, validateRequest, runQuery, hasGrant } from "../query/queryService.js";
import { METRIC_BY_KEY } from "../metrics/definitions.js";
import { registry } from "../metrics/registry.js";
import { FORMATS } from "./formats.js";
import { canRead } from "../reports/reportService.js";
import { encryptSecret, decryptSecret } from "../../integrations/credentials/vault.js";
import { recordAuditEvent, requestContext } from "../../services/auditService.js";
import { recordOutboxEvent } from "../../services/outboxService.js";

const E = "analytics_exports";
const EXPIRY_DAYS = Number(process.env.ANALYTICS_EXPORT_EXPIRY_DAYS) || 7;
const MAX_ROWS = 50_000;
const MAX_BYTES = 20 * 1024 * 1024;
export const EXPORT_STATES = ["Requested", "Validating", "Awaiting approval", "Queued", "Generating", "Scanning", "Ready", "Downloaded", "Expired", "Cancelled", "Failed", "Revoked"];
const aad = (job) => `${job.organizationId}|${job.publicId}|analytics_export`;

const audit = (ctx, action, targetId, extra = {}) => recordAuditEvent({
  correlationId: ctx.correlationId || crypto.randomUUID(), ipAddress: ctx.ipAddress || null, userAgent: ctx.userAgent || null,
  actorUserId: ctx.userId || null, actorMembershipId: ctx.membershipId || null, organizationId: ctx.organizationId, action, targetType: "AnalyticsExport", targetId, result: "Success", ...extra,
}).catch(() => {});
const reqCtx = (req) => ({ ...requestContext(req), userId: req.user?.id, membershipId: req.membership?.id, organizationId: req.organizationId });

export const serializeExport = (j) => ({
  _id: j.publicId, status: j.status, format: j.format, purpose: j.purpose, classification: j.classification, reportId: j.reportId, reportVersion: j.reportVersion,
  approvalRequired: j.approvalRequired, approvedAt: j.approvedAt, rowCount: j.rowCount, fileSize: j.fileSize, downloads: j.downloads, downloadLimit: j.downloadLimit,
  expiresAt: j.expiresAt, createdAt: j.createdAt, requestedByMembershipId: j.requestedByMembershipId, scheduled: !!j.scheduleRunId,
  metrics: j.query?.metrics || [], failureCategory: j.failureCategory, safeError: j.safeError, revokedAt: j.revokedAt,
});

// Classification from the metrics in the frozen query.
const classify = (metrics) => (metrics.some((k) => METRIC_BY_KEY[k]?.sensitivity === "sensitive") ? "Confidential" : "Internal");

async function frozenQueryFor(req, body) {
  if (body.reportId) {
    const report = await prisma.analyticsReport.findFirst({ where: { publicId: String(body.reportId), organizationId: req.organizationId } });
    if (!report) throw new QueryError(404, "NOT_FOUND", "Report not found.");
    const shares = await prisma.analyticsReportShare.findMany({ where: { reportId: report.id } });
    if (!canRead(req, report, shares)) throw new QueryError(404, "NOT_FOUND", "Report not found.");
    const v = await prisma.analyticsReportVersion.findUnique({ where: { reportId_version: { reportId: report.id, version: report.latestVersion } } });
    const d = v.definition;
    const metrics = d.metrics.filter((k) => hasGrant(req, METRIC_BY_KEY[k].module, "read"));
    if (!metrics.length) throw new QueryError(403, "METRIC_FORBIDDEN", "You cannot export any metric in this report.");
    return { query: { metrics, groupBy: d.groupBy, grain: d.grain, filters: d.filters, range: body.range ?? d.range, comparison: d.comparison, currencyMode: d.currencyMode, limit: d.limit }, report, version: v.version, title: report.name };
  }
  const opts = validateRequest(body.query || {});
  for (const k of opts.metrics) if (!hasGrant(req, METRIC_BY_KEY[k].module, "read")) throw new QueryError(403, "METRIC_FORBIDDEN", `You cannot export ${METRIC_BY_KEY[k].name}.`);
  return { query: { ...opts, range: body.query.range ?? "last_30_days" }, report: null, version: null, title: "Analytics export" };
}

export async function requestExport(req, body = {}, { scheduleRunId = null, recipientMembershipIds = [] } = {}) {
  if (!req.membership?.id) throw new QueryError(403, "MEMBERSHIP_REQUIRED", "Exports need a membership in this organization.");
  if (!hasGrant(req, E, "basic")) throw new QueryError(403, "EXPORT_FORBIDDEN", "You do not have permission to export analytics.");
  const format = String(body.format || "csv");
  if (!FORMATS[format]) throw new QueryError(422, "INVALID_FORMAT", `format must be one of ${Object.keys(FORMATS).join(", ")}.`);
  // JSON is a technical format: metric administrators and warehouse operators only.
  if (format === "json" && !hasGrant(req, "analytics_metrics", "manage") && !hasGrant(req, "analytics_warehouse", "monitor")) throw new QueryError(403, "FORMAT_FORBIDDEN", "JSON exports are limited to technical roles; choose CSV, XLSX or PDF.");
  const purpose = String(body.purpose || "").trim();
  if (purpose.length < 3) throw new QueryError(422, "PURPOSE_REQUIRED", "Describe the purpose of the export.");
  const frozen = await frozenQueryFor(req, body);
  const classification = classify(frozen.query.metrics);
  if (classification === "Confidential" && !hasGrant(req, E, "sensitive")) throw new QueryError(403, "SENSITIVE_EXPORT_FORBIDDEN", "This export contains financial data; you need the sensitive export permission.");
  // Scheduled deliveries were approved when the schedule was created.
  const approvalRequired = classification === "Confidential" && !scheduleRunId;
  const job = await prisma.analyticsExportJob.create({
    data: {
      publicId: `exp_${crypto.randomBytes(9).toString("base64url")}`, organizationId: req.organizationId, requestedByMembershipId: req.membership.id,
      reportId: frozen.report?.publicId || null, reportVersion: frozen.version, dataset: frozen.title, query: frozen.query, format, purpose: purpose.slice(0, 500), classification,
      status: approvalRequired ? "Awaiting approval" : "Queued", approvalRequired, recipientMembershipIds, scheduleRunId,
      downloadLimit: Math.min(20, Math.max(1, Number(body.downloadLimit) || 5)),
    },
  });
  await audit(reqCtx(req), "analytics.export.requested", job.publicId, { after: { format, classification, metrics: frozen.query.metrics, approvalRequired } });
  if (approvalRequired) {
    await recordOutboxEvent(prisma, { aggregateType: "AnalyticsExport", aggregateId: job.id, eventType: "analytics.export.approval_requested", payload: { organizationId: req.organizationId, exportId: job.publicId, notifyGrant: `${E}:approve` } }).catch(() => {});
  }
  return job;
}

async function loadJob(req, id) {
  const j = await prisma.analyticsExportJob.findFirst({ where: { publicId: String(id), organizationId: req.organizationId } });
  if (!j) throw new QueryError(404, "NOT_FOUND", "Export not found.");
  const mine = j.requestedByMembershipId === req.membership?.id || (j.recipientMembershipIds || []).includes(req.membership?.id);
  if (!mine && !hasGrant(req, E, "approve") && !req.isSystemOwnerOverride) throw new QueryError(404, "NOT_FOUND", "Export not found.");
  return { j, mine };
}

export async function listExports(req, { all = false } = {}) {
  const everyone = all && (hasGrant(req, E, "approve") || req.isSystemOwnerOverride);
  const me = req.membership?.id || "none";
  const rows = await prisma.analyticsExportJob.findMany({
    where: { organizationId: req.organizationId, ...(everyone ? {} : { OR: [{ requestedByMembershipId: me }, { recipientMembershipIds: { array_contains: [me] } }] }) },
    orderBy: { createdAt: "desc" }, take: 200, omit: { fileData: true },
  });
  return rows.map(serializeExport);
}

export async function getExport(req, id) { const { j } = await loadJob(req, id); return serializeExport(j); }

export async function approveExport(req, id, approve = true, reason = "") {
  if (!hasGrant(req, E, "approve")) throw new QueryError(403, "FORBIDDEN", "You cannot approve exports.");
  const { j } = await loadJob(req, id);
  if (j.status !== "Awaiting approval") throw new QueryError(409, "INVALID_STATE", `The export is ${j.status}.`);
  if (j.requestedByMembershipId === req.membership?.id) throw new QueryError(403, "SELF_APPROVAL", "Someone else must approve your export.");
  const updated = await prisma.analyticsExportJob.update({ where: { id: j.id }, data: approve ? { status: "Queued", approvedByMembershipId: req.membership?.id || null, approvedAt: new Date() } : { status: "Cancelled", safeError: `Rejected: ${String(reason || "no reason given").slice(0, 300)}` } });
  await audit(reqCtx(req), approve ? "analytics.export.approved" : "analytics.export.rejected", j.publicId, { reason: reason ? String(reason).slice(0, 300) : null });
  return serializeExport(updated);
}

export async function revokeExport(req, id, reason = "") {
  const { j, mine } = await loadJob(req, id);
  if (!mine && !hasGrant(req, E, "approve") && !req.isSystemOwnerOverride) throw new QueryError(403, "FORBIDDEN", "You cannot revoke this export.");
  if (["Revoked", "Expired", "Cancelled"].includes(j.status)) throw new QueryError(409, "INVALID_STATE", `The export is already ${j.status}.`);
  const updated = await prisma.analyticsExportJob.update({ where: { id: j.id }, data: { status: ["Ready", "Downloaded"].includes(j.status) ? "Revoked" : "Cancelled", revokedByMembershipId: req.membership?.id || null, revokedAt: new Date(), fileData: null, fileIv: null, fileTag: null } });
  await audit(reqCtx(req), "analytics.export.revoked", j.publicId, { reason: reason ? String(reason).slice(0, 300) : null });
  return serializeExport(updated);
}

// → { buffer, mime, filename }
export async function downloadExport(req, id) {
  const { j, mine } = await loadJob(req, id);
  if (!mine) throw new QueryError(403, "FORBIDDEN", "Only the requester or a recipient can download this export.");
  if (!hasGrant(req, E, "basic")) throw new QueryError(403, "EXPORT_FORBIDDEN", "You no longer have export permission.");
  if (j.classification === "Confidential" && !hasGrant(req, E, "sensitive")) throw new QueryError(403, "SENSITIVE_EXPORT_FORBIDDEN", "You no longer have sensitive export permission.");
  if (!["Ready", "Downloaded"].includes(j.status)) throw new QueryError(409, "NOT_READY", `The export is ${j.status}.`);
  if (j.expiresAt && j.expiresAt < new Date()) {
    await prisma.analyticsExportJob.update({ where: { id: j.id }, data: { status: "Expired", fileData: null, fileIv: null, fileTag: null } });
    throw new QueryError(410, "EXPIRED", "The export has expired. Request a new one.");
  }
  // Atomic: only succeeds while under the download limit.
  const { count } = await prisma.analyticsExportJob.updateMany({ where: { id: j.id, downloads: { lt: j.downloadLimit }, status: { in: ["Ready", "Downloaded"] } }, data: { downloads: { increment: 1 }, status: "Downloaded" } });
  if (!count) throw new QueryError(429, "DOWNLOAD_LIMIT", "The download limit for this export has been reached.");
  const b64 = decryptSecret({ ciphertext: Buffer.from(j.fileData).toString("base64"), nonce: j.fileIv, authTag: j.fileTag, keyVersion: j.fileKeyVersion }, aad(j));
  const buffer = Buffer.from(b64, "base64");
  if (crypto.createHash("sha256").update(buffer).digest("hex") !== j.fileSha256) throw new QueryError(500, "INTEGRITY", "The export file failed its integrity check.");
  await prisma.analyticsExportDownload.create({ data: { exportJobId: j.id, organizationId: j.organizationId, membershipId: req.membership?.id || null, ipAddress: req.ip || null, userAgent: String(req.headers?.["user-agent"] || "").slice(0, 300) || null } });
  await audit(reqCtx(req), "analytics.export.downloaded", j.publicId, { after: { download: j.downloads + 1, limit: j.downloadLimit } });
  const f = FORMATS[j.format];
  const safeName = String(j.dataset || "analytics").replace(/[^A-Za-z0-9 _-]/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "analytics";
  return { buffer, mime: f.mime, filename: `${safeName}-${j.createdAt.toISOString().slice(0, 10)}.${f.ext}` };
}

// ─── Generation (worker) ──────────────────────────────────────────────────────
// A request-like context for a membership (grants and scope as of now).
export async function contextForMembership(membershipId) {
  const membership = await prisma.organizationMembership.findUnique({ where: { id: membershipId }, include: { roles: { include: { role: true } }, user: true } });
  if (!membership || membership.status !== "Active") return null;
  return { user: membership.user, membership, organizationId: membership.organizationId, isSystemOwnerOverride: false, headers: {}, correlationId: crypto.randomUUID() };
}

const labelFor = (dim) => ({ owner: "Owner", team: "Team", department: "Department", stage: "Stage", status: "Status", currency: "Currency" }[dim] || dim.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()));
const cell = (m) => (m.value === null || m.value === undefined ? "" : m.value);

// Flattens a query result into a table for any format.
export function tableFromResult(result, { title, requester, generatedAt, versions }) {
  const ms = result.metrics;
  let columns; let rows;
  if (result.groupBy) {
    columns = [labelFor(result.groupBy), ...ms.map((m) => `${m.name}${m.currency ? ` (${m.currency})` : ""}`)];
    const keys = []; const seen = new Set();
    for (const m of ms) for (const g of m.groups || []) if (!seen.has(g.key)) { seen.add(g.key); keys.push({ key: g.key, label: g.label }); }
    rows = keys.map((k) => [k.label, ...ms.map((m) => cell((m.groups || []).find((g) => g.key === k.key) || {}))]);
  } else if (result.grain) {
    columns = ["Period", ...ms.map((m) => `${m.name}${m.currency ? ` (${m.currency})` : ""}`)];
    const periods = [...new Set(ms.flatMap((m) => (m.series || []).map((p) => p.period)))].sort();
    rows = periods.map((p) => [p, ...ms.map((m) => cell((m.series || []).find((x) => x.period === p) || {}))]);
  } else {
    columns = ["Metric", "Value", "Unit", "Currency", "Previous period", "Change", "Change %", "Metric version"];
    rows = ms.map((m) => [m.name, cell(m), m.unit, m.currency || "", m.comparison?.value ?? "", m.comparison?.change ?? "", m.comparison?.changePercent ?? "", m.version ?? ""]);
  }
  const notes = [...new Set(ms.map((m) => m.note).filter(Boolean))];
  const watermark = `Exported for ${requester} at ${generatedAt} - Confidential to the organization`;
  const meta = [
    ["Title", title], ["Generated at", generatedAt], ["Range", `${result.range.from} to ${result.range.to}`], ["Time zone", result.timeZone], ["Base currency", result.baseCurrency],
    ["Metric versions", Object.entries(versions).map(([k, v]) => `${k}@${v}`).join("; ")], ["Scope", "Limited to the records the requester could access when the file was generated"],
    ["Notes", notes.join(" ") || "None"], ["Disclaimer", result.disclaimer], ["Watermark", watermark],
  ];
  return { title, columns, rows, meta, watermark };
}

async function notify(job, eventType, extra = {}) {
  const ids = [...new Set([job.requestedByMembershipId, ...(job.recipientMembershipIds || [])])];
  await recordOutboxEvent(prisma, { aggregateType: "AnalyticsExport", aggregateId: job.id, eventType, payload: { organizationId: job.organizationId, exportId: job.publicId, notifyMembershipIds: ids, ...extra } }).catch(() => {});
}

export async function generateExport(job) {
  const claim = await prisma.analyticsExportJob.updateMany({ where: { id: job.id, status: "Queued" }, data: { status: "Generating" } });
  if (!claim.count) return null;
  const fail = async (category, message) => {
    const out = await prisma.analyticsExportJob.update({ where: { id: job.id }, data: { status: "Failed", failureCategory: category, safeError: message } });
    await notify(job, "analytics.export.failed");
    return out;
  };
  try {
    const ctx = await contextForMembership(job.requestedByMembershipId);
    if (!ctx || ctx.organizationId !== job.organizationId) return fail("access_revoked", "The requester is no longer an active member.");
    if (!hasGrant(ctx, E, "basic")) return fail("access_revoked", "The requester no longer has export permission.");
    if (job.classification === "Confidential" && !hasGrant(ctx, E, "sensitive")) return fail("access_revoked", "The requester no longer has sensitive export permission.");
    for (const k of job.query.metrics) if (!hasGrant(ctx, METRIC_BY_KEY[k]?.module, "read")) return fail("access_revoked", "The requester no longer has access to every metric in this export.");
    const result = await runQuery(ctx, job.query, { skipCache: true });
    const reg = await registry();
    const versions = Object.fromEntries(job.query.metrics.map((k) => [k, reg[k]?.version ?? null]));
    const generatedAt = new Date().toISOString();
    const requester = ctx.user?.fullName || ctx.user?.name || ctx.user?.username || "member";
    const table = tableFromResult(result, { title: job.dataset || "Analytics export", requester, generatedAt, versions });
    if (table.rows.length > MAX_ROWS) return fail("too_large", `Exports are limited to ${MAX_ROWS} rows.`);
    await prisma.analyticsExportJob.update({ where: { id: job.id }, data: { status: "Scanning" } });
    const buffer = FORMATS[job.format].write(table);
    if (buffer.length > MAX_BYTES) return fail("too_large", "The export file is too large.");
    const enc = encryptSecret(buffer.toString("base64"), aad(job));
    const ready = await prisma.analyticsExportJob.update({
      where: { id: job.id },
      data: {
        status: "Ready", rowCount: table.rows.length, fileSize: buffer.length, fileSha256: crypto.createHash("sha256").update(buffer).digest("hex"),
        fileData: Buffer.from(enc.ciphertext, "base64"), fileIv: enc.nonce, fileTag: enc.authTag, fileKeyVersion: enc.keyVersion,
        metricVersions: versions, watermark: table.watermark, expiresAt: new Date(Date.now() + EXPIRY_DAYS * 86_400_000), failureCategory: null, safeError: null,
      },
    });
    await audit({ organizationId: job.organizationId, membershipId: job.requestedByMembershipId }, "analytics.export.generated", job.publicId, { after: { rows: table.rows.length, bytes: buffer.length, format: job.format } });
    await notify(job, "analytics.export.ready");
    return ready;
  } catch (err) {
    console.error(`[analytics] export ${job.publicId} failed:`, err?.code || err?.name || "error");
    return fail("internal", "The export could not be generated.");
  }
}

export async function runExportCycle({ limit = 5 } = {}) {
  const queued = await prisma.analyticsExportJob.findMany({ where: { status: "Queued" }, orderBy: { createdAt: "asc" }, take: limit, omit: { fileData: true } });
  for (const j of queued) await generateExport(j);
  return queued.length;
}

// Expired or stuck exports lose their file bytes.
export async function expireExports(now = new Date()) {
  const expired = await prisma.analyticsExportJob.updateMany({ where: { status: { in: ["Ready", "Downloaded"] }, expiresAt: { lt: now } }, data: { status: "Expired", fileData: null, fileIv: null, fileTag: null } });
  const stuck = await prisma.analyticsExportJob.updateMany({ where: { status: { in: ["Generating", "Scanning"] }, updatedAt: { lt: new Date(now.getTime() - 30 * 60_000) } }, data: { status: "Queued" } });
  return { expired: expired.count, requeued: stuck.count };
}

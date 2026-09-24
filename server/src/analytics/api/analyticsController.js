// Backend Phase 12 — HTTP handlers for analytics dashboards, the semantic
// query API, drill-down, metric registry, AI metric explanations, reports,
// schedules, exports and warehouse administration. Authorization happens in
// the routes (module grants) and again inside the services (metric, record
// scope and object-level checks).
import prisma from "../../lib/prisma.js";
import { AiError, sendAiError } from "../../ai/common/errors.js";
import { runAi } from "../../ai/gateway/gateway.js";
import { QueryError, runQuery, dashboard as runDashboard, drilldown as runDrilldown, hasGrant, canReadMetric } from "../query/queryService.js";
import { METRICS, METRIC_BY_KEY, DASHBOARDS, definitionPayload, metricDimensions } from "../metrics/definitions.js";
import { registry, draftVersion, publishVersion, retireMetric } from "../metrics/registry.js";
import * as reports from "../reports/reportService.js";
import * as schedules from "../reports/scheduleService.js";
import * as exportsSvc from "../exports/exportService.js";
import { enqueueWarehouseJob, freshness, refreshMaterializedViews, rebuildAllowed, ALL_SOURCES, SNAPSHOT_SOURCES, ACTIVE_STATES } from "../warehouse/jobs.js";
import { calendarFor } from "../common/calendar.js";
import { recordAuditEvent, requestContext } from "../../services/auditService.js";

export const guard = (fn) => async (req, res, next) => {
  try { await fn(req, res, next); }
  catch (err) {
    if (err instanceof QueryError) return res.status(err.status).json({ code: err.code, message: err.message });
    if (err instanceof AiError) return sendAiError(res, err);
    return next(err);
  }
};
const audit = (req, action, targetType, targetId, extra = {}) => recordAuditEvent({ ...requestContext(req), actorUserId: req.user?.id || null, actorMembershipId: req.membership?.id || null, organizationId: req.organizationId, action, targetType, targetId, result: "Success", ...extra }).catch(() => {});

// ─── Dashboards and queries ───────────────────────────────────────────────────
export const getDashboard = (name) => guard(async (req, res) => {
  const { range, comparison, currencyMode } = req.query;
  let r = range;
  if (req.query.from && req.query.to) r = { from: String(req.query.from), to: String(req.query.to) };
  res.json(await runDashboard(req, name, { range: r || "last_30_days", comparison: comparison || "previous_period", currencyMode: currencyMode || "base" }));
});

export const query = guard(async (req, res) => { res.json(await runQuery(req, req.body)); });
export const drilldown = guard(async (req, res) => {
  const out = await runDrilldown(req, req.body);
  await audit(req, "analytics.drilldown", "AnalyticsMetric", req.body?.metric, { after: { rows: out.rows.length } });
  res.json(out);
});

export const dashboards = guard(async (req, res) => {
  res.json({ dashboards: Object.entries(DASHBOARDS).filter(([, d]) => hasGrant(req, d.module, "read")).map(([key, d]) => ({ key, metrics: d.metrics.filter((k) => canReadMetric(req, k, key)) })) });
});

export const getFreshness = guard(async (req, res) => {
  const [fresh, cal, issues] = await Promise.all([
    freshness(req.organizationId), calendarFor(req.organizationId),
    prisma.analyticsDataQualityIssue.findMany({ where: { organizationId: req.organizationId, status: "Open" }, select: { source: true, issueType: true, severity: true, summary: true, affectedCount: true, lastSeenAt: true } }),
  ]);
  res.json({ sources: fresh, timeZone: cal.timeZone, baseCurrency: cal.baseCurrency, fiscalYearStartMonth: cal.fiscalYearStartMonth, openIssues: issues, note: "Analytics refresh on a schedule; figures are not real-time." });
});

// ─── Metric registry ──────────────────────────────────────────────────────────
export const listMetrics = guard(async (req, res) => {
  const reg = await registry();
  res.json({ metrics: METRICS.map((m) => ({ key: m.key, name: m.name, module: m.module, unit: m.unit, status: reg[m.key]?.status || "Draft", version: reg[m.key]?.version ?? null, definition: reg[m.key]?.definition || definitionPayload(m), dimensions: metricDimensions(m.key), sensitivity: m.sensitivity, accessible: hasGrant(req, m.module, "read") })) });
});

export const getMetric = guard(async (req, res) => {
  const m = METRIC_BY_KEY[req.params.key];
  const row = m && await prisma.analyticsMetric.findUnique({ where: { key: m.key } });
  if (!m || !row) throw new QueryError(404, "NOT_FOUND", "Metric not found.");
  const versions = await prisma.analyticsMetricVersion.findMany({ where: { metricId: row.id }, orderBy: { version: "desc" } });
  res.json({ key: m.key, name: m.name, module: m.module, unit: m.unit, status: row.status, publishedVersion: row.publishedVersion, versions: versions.map((v) => ({ version: v.version, status: v.status, definition: v.definition, effectiveDate: v.effectiveDate, deprecatedDate: v.deprecatedDate, createdAt: v.createdAt })) });
});

export const draftMetric = guard(async (req, res) => {
  const { organizationId: _org, ...changes } = req.body || {};
  const out = await draftVersion(req.params.key, changes, req.user?.id || null);
  if (out.error) throw new QueryError(out.error, out.error === 404 ? "NOT_FOUND" : "INVALID_METRIC", out.message);
  await audit(req, "analytics.metric.drafted", "AnalyticsMetric", req.params.key, { after: { version: out.version.version } });
  res.status(201).json({ version: out.version.version, status: out.version.status, definition: out.version.definition });
});

export const publishMetric = guard(async (req, res) => {
  const out = await publishVersion(req.params.key, req.params.version, req.user?.id || null);
  if (out.error) throw new QueryError(out.error, out.error === 404 ? "NOT_FOUND" : "INVALID_STATE", out.message);
  await audit(req, "analytics.metric.published", "AnalyticsMetric", req.params.key, { after: { version: out.version.version } });
  res.json({ version: out.version.version, status: out.version.status });
});

export const retire = guard(async (req, res) => {
  const out = await retireMetric(req.params.key);
  if (out.error) throw new QueryError(out.error, "NOT_FOUND", out.message);
  await audit(req, "analytics.metric.retired", "AnalyticsMetric", req.params.key);
  res.json({ ok: true });
});

// ─── AI explanation (never the source of a number) ────────────────────────────
const fmt = (m) => (m.value === null || m.value === undefined ? "no value" : `${m.value}${m.unit === "percent" ? "%" : ""}${m.currency ? ` ${m.currency}` : ""}`);

export const explain = guard(async (req, res) => {
  if (!hasGrant(req, "ai_features", "use")) throw new QueryError(403, "AI_FORBIDDEN", "You do not have access to AI features.");
  const { metric, range, comparison = "previous_period" } = req.body || {};
  if (!METRIC_BY_KEY[metric]) throw new QueryError(422, "UNKNOWN_METRIC", "Unknown metric.");
  const result = await runQuery(req, { metrics: [metric], range: range || "last_30_days", comparison });
  const m = result.metrics[0];
  const c = m.comparison;
  const summary = [
    `${m.name} was ${fmt(m)} from ${result.range.from} to ${result.range.to}.`,
    c && c.value !== null && c.value !== undefined ? `In ${c.label} it was ${c.value}${m.unit === "percent" ? "%" : ""}${c.change !== null ? `, a change of ${c.change}` : ""}${c.changePercent !== null && c.changePercent !== undefined ? ` (${c.changePercent}%)` : ""}.` : "",
    `Definition: ${m.definition}`,
    m.note || "",
  ].filter(Boolean).join(" ");
  const facts = {
    metric: m.key, metricVersion: m.version, value: m.value, unit: m.unit, currency: m.currency || null, from: result.range.from, to: result.range.to,
    previousValue: c?.value ?? null, change: c?.change ?? null, changePercent: c?.changePercent ?? null, previousFrom: result.comparisonRange?.from ?? null, previousTo: result.comparisonRange?.to ?? null,
    lastLoadedAt: m.freshness.lastLoadedAt, stale: m.freshness.stale,
  };
  const outcome = await runAi({ req, useCaseKey: "overview.narrative", dataVariables: { executiveSummary: summary, facts }, numericFacts: facts });
  const text = outcome?.output?.text;
  const clean = !!text && !outcome.refused && !(outcome.validation?.warnings || []).length;
  res.json({
    explanation: clean ? text : summary, numbersVerified: clean, usedDeterministicFallback: !clean,
    reference: { metric: m.key, version: m.version, value: m.value, currency: m.currency || null, range: result.range, comparison: c, freshness: m.freshness },
    provider: outcome.provider, requestId: outcome.request?.id,
    disclaimer: "AI wording over governed metric values; every number comes from the metric engine. Not financial advice or audited figures.",
  });
});

// ─── Reports ──────────────────────────────────────────────────────────────────
export const listReports = guard(async (req, res) => res.json({ reports: await reports.listReports(req, { includeArchived: req.query.archived === "true" }) }));
export const getReport = guard(async (req, res) => res.json(await reports.getReport(req, req.params.id)));
export const createReport = guard(async (req, res) => res.status(201).json(await reports.createReport(req, req.body || {})));
export const updateReport = guard(async (req, res) => res.json(await reports.updateReport(req, req.params.id, req.body || {})));
export const archiveReport = guard(async (req, res) => res.json(await reports.archiveReport(req, req.params.id, req.body?.archived !== false)));
export const cloneReport = guard(async (req, res) => res.status(201).json(await reports.cloneReport(req, req.params.id, req.body || {})));
export const shareReport = guard(async (req, res) => res.json(await reports.shareReport(req, req.params.id, req.body || {})));
export const runReport = guard(async (req, res) => {
  const b = req.method === "GET" ? req.query : req.body || {};
  const range = b.from && b.to ? { from: String(b.from), to: String(b.to) } : b.range || undefined;
  res.json(await reports.runReport(req, req.params.id, { range, comparison: b.comparison, currencyMode: b.currencyMode }));
});

// ─── Schedules ────────────────────────────────────────────────────────────────
export const listSchedules = guard(async (req, res) => res.json({ schedules: await schedules.listSchedules(req) }));
export const getSchedule = guard(async (req, res) => res.json(await schedules.getSchedule(req, req.params.id)));
export const createSchedule = guard(async (req, res) => res.status(201).json(await schedules.createSchedule(req, req.body || {})));
export const updateSchedule = guard(async (req, res) => res.json(await schedules.updateSchedule(req, req.params.id, req.body || {})));
export const deleteSchedule = guard(async (req, res) => res.json(await schedules.deleteSchedule(req, req.params.id)));
export const runScheduleNow = guard(async (req, res) => res.status(202).json(await schedules.runScheduleNow(req, req.params.id)));

// ─── Exports ──────────────────────────────────────────────────────────────────
export const listExports = guard(async (req, res) => res.json({ exports: await exportsSvc.listExports(req, { all: req.query.all === "true" }) }));
export const getExport = guard(async (req, res) => res.json(await exportsSvc.getExport(req, req.params.id)));
export const createExport = guard(async (req, res) => res.status(202).json(exportsSvc.serializeExport(await exportsSvc.requestExport(req, req.body || {}))));
export const approveExport = guard(async (req, res) => res.json(await exportsSvc.approveExport(req, req.params.id, true, req.body?.reason)));
export const rejectExport = guard(async (req, res) => res.json(await exportsSvc.approveExport(req, req.params.id, false, req.body?.reason)));
export const revokeExport = guard(async (req, res) => res.json(await exportsSvc.revokeExport(req, req.params.id, req.body?.reason)));
export const downloadExport = guard(async (req, res) => {
  const f = await exportsSvc.downloadExport(req, req.params.id);
  res.set({ "Content-Type": f.mime, "Content-Disposition": `attachment; filename="${f.filename}"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.send(f.buffer);
});

// ─── Warehouse administration ─────────────────────────────────────────────────
export const warehouseStatus = guard(async (req, res) => {
  const org = req.organizationId;
  const [checkpoints, jobs, issues, recon, fresh] = await Promise.all([
    prisma.analyticsJobCheckpoint.findMany({ where: { organizationId: org } }),
    prisma.analyticsWarehouseJob.findMany({ where: { organizationId: org }, orderBy: { createdAt: "desc" }, take: 60 }),
    prisma.analyticsDataQualityIssue.findMany({ where: { organizationId: org }, orderBy: { lastSeenAt: "desc" }, take: 100 }),
    prisma.analyticsReconciliationRun.findMany({ where: { organizationId: org }, orderBy: { createdAt: "desc" }, take: 60 }),
    freshness(org),
  ]);
  const cpBy = Object.fromEntries(checkpoints.map((c) => [c.source, c]));
  const reconBy = {};
  for (const r of recon) if (!reconBy[r.source]) reconBy[r.source] = r;
  res.json({
    sources: ALL_SOURCES.map((s) => ({ source: s, snapshot: SNAPSHOT_SOURCES.includes(s), watermark: cpBy[s]?.watermark || null, lastLoadedAt: fresh[s]?.lastLoadedAt || null, lastStatus: jobs.find((j) => j.source === s)?.status || null, reconciliation: reconBy[s] ? { status: reconBy[s].status, checks: reconBy[s].checks, at: reconBy[s].createdAt } : null })),
    jobs: jobs.map(serializeJob), issues: issues.map((i) => ({ id: i.id, source: i.source, issueType: i.issueType, severity: i.severity, summary: i.summary, affectedCount: i.affectedCount, metricKeys: i.metricKeys, status: i.status, firstSeenAt: i.firstSeenAt, lastSeenAt: i.lastSeenAt, resolvedAt: i.resolvedAt })),
    rebuildAllowed: rebuildAllowed(),
  });
});

const serializeJob = (j) => ({ _id: j.publicId, source: j.source, jobType: j.jobType, status: j.status, attempts: j.attempts, rowsRead: j.rowsRead, rowsInserted: j.rowsInserted, rowsUpdated: j.rowsUpdated, rowsDeleted: j.rowsDeleted, rowsRejected: j.rowsRejected, watermarkFrom: j.watermarkFrom, watermarkTo: j.watermarkTo, failureCategory: j.failureCategory, safeError: j.safeError, correlationId: j.correlationId, startedAt: j.startedAt, completedAt: j.completedAt, createdAt: j.createdAt });

export const startJob = guard(async (req, res) => {
  const { source, jobType = "incremental", confirm } = req.body || {};
  if (source !== "all" && !ALL_SOURCES.includes(source)) throw new QueryError(422, "INVALID_SOURCE", `source must be all or one of ${ALL_SOURCES.join(", ")}.`);
  if (!["incremental", "manual", "backfill", "reconcile", "rebuild"].includes(jobType)) throw new QueryError(422, "INVALID_JOB", "jobType must be incremental, manual, backfill, reconcile or rebuild.");
  if (jobType === "rebuild") {
    if (!hasGrant(req, "analytics_warehouse", "rebuild")) throw new QueryError(403, "FORBIDDEN", "Full rebuilds need the warehouse rebuild permission.");
    if (!rebuildAllowed()) throw new QueryError(403, "REBUILD_DISABLED", "Full rebuilds are disabled in this environment.");
    if (source === "all" || confirm !== `REBUILD ${source}`) throw new QueryError(422, "CONFIRMATION_REQUIRED", `Type "REBUILD ${source === "all" ? "<source>" : source}" to confirm a rebuild of one source.`);
  }
  const sources = source === "all" ? ALL_SOURCES : [source];
  const out = [];
  for (const s of sources) {
    const type = SNAPSHOT_SOURCES.includes(s) && ["incremental", "backfill"].includes(jobType) ? "manual" : jobType;
    const { job, existing } = await enqueueWarehouseJob(req.organizationId, s, type, { requestedByUserId: req.user?.id || null, correlationId: req.correlationId });
    out.push({ ...serializeJob(job), existing });
  }
  await audit(req, `analytics.warehouse.${jobType}`, "AnalyticsWarehouse", source, { after: { sources: sources.length } });
  res.status(202).json({ jobs: out });
});

export const retryJob = guard(async (req, res) => {
  const j = await prisma.analyticsWarehouseJob.findFirst({ where: { publicId: String(req.params.id), organizationId: req.organizationId } });
  if (!j) throw new QueryError(404, "NOT_FOUND", "Job not found.");
  if (!["Failed", "Dead letter", "Cancelled"].includes(j.status)) throw new QueryError(409, "INVALID_STATE", `The job is ${j.status}.`);
  const active = await prisma.analyticsWarehouseJob.count({ where: { organizationId: j.organizationId, source: j.source, status: { in: ACTIVE_STATES } } });
  if (active) throw new QueryError(409, "JOB_ACTIVE", "Another job for this source is already queued or running.");
  const updated = await prisma.analyticsWarehouseJob.update({ where: { id: j.id }, data: { status: "Queued", attempts: 0, failureCategory: null, safeError: null, completedAt: null } });
  await audit(req, "analytics.warehouse.retry", "AnalyticsWarehouseJob", j.publicId);
  res.json(serializeJob(updated));
});

export const refreshViews = guard(async (req, res) => {
  const out = await refreshMaterializedViews();
  await audit(req, "analytics.warehouse.refresh_views", "AnalyticsWarehouse", "views", { after: out });
  res.json({ views: out });
});

// What the signed-in member may do in Analytics & Reports (drives navigation;
// every endpoint still checks its own grant).
const ANALYTICS_MODULES = ["analytics_overview", "analytics_sales", "analytics_activities", "analytics_support", "analytics_projects", "analytics_finance", "analytics_ai", "analytics_metrics", "analytics_reports", "analytics_exports", "analytics_warehouse"];
export const myAccess = guard(async (req, res) => {
  const organizationId = req.query.organizationId;
  if (!organizationId) return res.status(400).json({ code: "MISSING_ORGANIZATION_ID", message: "organizationId is required." });
  const membership = await prisma.organizationMembership.findUnique({ where: { organizationId_userId: { organizationId: String(organizationId), userId: req.user.id } }, include: { roles: { include: { role: true } } } });
  const owner = req.user.role === "Super-Admin";
  if (!owner && (!membership || membership.status !== "Active")) return res.status(404).json({ code: "NOT_FOUND", message: "Not found." });
  const access = {};
  for (const moduleId of ANALYTICS_MODULES) {
    const actions = new Set();
    for (const mr of membership?.roles || []) for (const g of mr.role.permissionGrants || []) if (g.moduleId === moduleId) (g.actions || []).forEach((x) => actions.add(x));
    access[moduleId] = [...actions];
  }
  res.json({ access, systemOwner: owner, membershipId: membership?.id || null, aiFeatures: owner || (membership?.roles || []).some((mr) => (mr.role.permissionGrants || []).some((g) => g.moduleId === "ai_features" && (g.actions || []).includes("use"))) });
});

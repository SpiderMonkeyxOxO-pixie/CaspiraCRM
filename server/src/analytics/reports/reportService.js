// Backend Phase 12 — saved reports. A report stores a governed query
// definition (metrics, dimensions, filters, range, comparison, currency,
// grain, visualization) as immutable versions. Visibility decides who may
// open the report; running it ALWAYS uses the viewer's own grants and record
// scope, so sharing a report never shares data the viewer couldn't query.
import crypto from "node:crypto";
import prisma from "../../lib/prisma.js";
import { QueryError, validateRequest, runQuery, hasGrant } from "../query/queryService.js";
import { METRIC_BY_KEY } from "../metrics/definitions.js";
import { recordAuditEvent, requestContext } from "../../services/auditService.js";

export const VISIBILITIES = ["Private", "Shared", "Team", "Department", "Organization", "Executive", "Template"];
const VISUALIZATIONS = ["table", "bar", "line", "kpi"];
const M = "analytics_reports";

const audit = (req, action, targetId, extra = {}) => recordAuditEvent({ ...requestContext(req), actorUserId: req.user?.id || null, actorMembershipId: req.membership?.id || null, organizationId: req.organizationId, action, targetType: "AnalyticsReport", targetId, result: "Success", ...extra }).catch(() => {});

const roleKeys = (req) => (req.membership?.roles || []).map((r) => r.role.key);

// Can the caller open this report (not: see its data — that is re-checked per metric).
export function canRead(req, report, shares = []) {
  if (req.isSystemOwnerOverride) return true;
  const me = req.membership?.id;
  const any = ["read_own", "read_team", "read_department", "read_organization"].some((a) => hasGrant(req, M, a));
  if (!any) return false;
  if (report.ownerMembershipId === me) return true;
  if (hasGrant(req, M, "read_organization") && ["Organization", "Executive", "Team", "Department", "Shared"].includes(report.visibility)) return true;
  if (report.visibility === "Team" && report.team && report.team === req.user?.team && hasGrant(req, M, "read_team")) return true;
  if (report.visibility === "Department" && report.department && report.department === req.user?.department && hasGrant(req, M, "read_department")) return true;
  if (report.visibility === "Template") return hasGrant(req, M, "create");
  return shares.some((s) => (s.targetType === "Membership" && s.targetId === me) || (s.targetType === "Role" && roleKeys(req).includes(s.targetId)));
}

export const canEdit = (req, report) => req.isSystemOwnerOverride || (report.ownerMembershipId && report.ownerMembershipId === req.membership?.id);

// Validates a definition and checks the author may query every metric in it.
export function validateDefinition(req, def) {
  if (!def || typeof def !== "object") throw new QueryError(422, "INVALID_DEFINITION", "A report definition is required.");
  const { visualization = "table", sort = null, ...query } = def;
  if (!VISUALIZATIONS.includes(visualization)) throw new QueryError(422, "INVALID_DEFINITION", `visualization must be one of ${VISUALIZATIONS.join(", ")}.`);
  if (sort !== null && !["value_desc", "value_asc", "label"].includes(sort)) throw new QueryError(422, "INVALID_DEFINITION", "sort must be value_desc, value_asc or label.");
  const opts = validateRequest(query);
  for (const k of opts.metrics) if (!hasGrant(req, METRIC_BY_KEY[k].module, "read")) throw new QueryError(403, "METRIC_FORBIDDEN", `You cannot add ${METRIC_BY_KEY[k].name} to a report.`);
  const range = query.range ?? "last_30_days";
  if (typeof range !== "string" && !(range && typeof range === "object")) throw new QueryError(422, "INVALID_RANGE", "range must be a preset or { from, to }.");
  return { metrics: opts.metrics, groupBy: opts.groupBy, grain: opts.grain, filters: opts.filters, range, comparison: opts.comparison, currencyMode: opts.currencyMode, limit: opts.limit, visualization, sort };
}

export const serialize = (r, v, extra = {}) => ({
  _id: r.publicId, name: r.name, description: r.description, visibility: r.visibility, team: r.team, department: r.department, isTemplate: r.isTemplate,
  version: r.latestVersion, definition: v?.definition || null, ownerMembershipId: r.ownerMembershipId, archived: !!r.archivedAt, createdAt: r.createdAt, updatedAt: r.updatedAt, ...extra,
});

async function load(req, id) {
  const r = await prisma.analyticsReport.findFirst({ where: { publicId: String(id), organizationId: req.organizationId } });
  if (!r) throw new QueryError(404, "NOT_FOUND", "Report not found.");
  const shares = await prisma.analyticsReportShare.findMany({ where: { reportId: r.id } });
  // Unreadable reports are indistinguishable from missing ones.
  if (!canRead(req, r, shares)) throw new QueryError(404, "NOT_FOUND", "Report not found.");
  return { r, shares };
}

const latest = (r) => prisma.analyticsReportVersion.findUnique({ where: { reportId_version: { reportId: r.id, version: r.latestVersion } } });

export async function listReports(req, { includeArchived = false } = {}) {
  const rows = await prisma.analyticsReport.findMany({ where: { organizationId: req.organizationId, ...(includeArchived ? {} : { archivedAt: null }) }, orderBy: { updatedAt: "desc" }, take: 500 });
  const shares = rows.length ? await prisma.analyticsReportShare.findMany({ where: { reportId: { in: rows.map((r) => r.id) } } }) : [];
  const visible = rows.filter((r) => canRead(req, r, shares.filter((s) => s.reportId === r.id)));
  const versions = visible.length ? await prisma.analyticsReportVersion.findMany({ where: { OR: visible.map((r) => ({ reportId: r.id, version: r.latestVersion })) } }) : [];
  const vBy = Object.fromEntries(versions.map((v) => [v.reportId, v]));
  return visible.map((r) => serialize(r, vBy[r.id], { canEdit: canEdit(req, r) }));
}

export async function getReport(req, id) {
  const { r, shares } = await load(req, id);
  const versions = await prisma.analyticsReportVersion.findMany({ where: { reportId: r.id }, orderBy: { version: "desc" }, take: 50, select: { version: true, createdAt: true, createdByUserId: true } });
  return serialize(r, await latest(r), { canEdit: canEdit(req, r), versions, shares: canEdit(req, r) ? shares.map((s) => ({ targetType: s.targetType, targetId: s.targetId })) : undefined });
}

function checkVisibility(req, visibility) {
  if (!VISIBILITIES.includes(visibility)) throw new QueryError(422, "INVALID_VISIBILITY", `visibility must be one of ${VISIBILITIES.join(", ")}.`);
  if (visibility === "Private") return;
  if (!hasGrant(req, M, "share")) throw new QueryError(403, "SHARE_FORBIDDEN", "You need the report share permission to make a report visible to others.");
  if (["Organization", "Executive", "Template"].includes(visibility) && !hasGrant(req, M, "read_organization")) throw new QueryError(403, "SHARE_FORBIDDEN", "Only organization-wide report readers can publish organization reports.");
}

export async function createReport(req, body) {
  if (!req.membership?.id) throw new QueryError(403, "MEMBERSHIP_REQUIRED", "Reports need a membership in this organization.");
  const name = String(body?.name || "").trim().slice(0, 200);
  if (!name) throw new QueryError(422, "INVALID_NAME", "name is required.");
  const visibility = body.visibility || "Private";
  checkVisibility(req, visibility);
  const definition = validateDefinition(req, body.definition);
  const r = await prisma.analyticsReport.create({
    data: {
      publicId: `rpt_${crypto.randomBytes(8).toString("base64url")}`, organizationId: req.organizationId, ownerMembershipId: req.membership.id, name,
      description: String(body.description || "").slice(0, 2000), visibility, team: visibility === "Team" ? req.user?.team || null : null, department: visibility === "Department" ? req.user?.department || null : null,
      isTemplate: visibility === "Template",
    },
  });
  const v = await prisma.analyticsReportVersion.create({ data: { reportId: r.id, organizationId: req.organizationId, version: 1, definition, createdByUserId: req.user?.id || null } });
  await audit(req, "analytics.report.created", r.publicId, { after: { name, visibility } });
  return serialize(r, v, { canEdit: true });
}

// Every definition change is a new version; metadata edits are not.
export async function updateReport(req, id, body) {
  const { r } = await load(req, id);
  if (!canEdit(req, r)) throw new QueryError(403, "FORBIDDEN", "Only the report owner can change it.");
  if (body.version !== undefined && Number(body.version) !== r.latestVersion) throw new QueryError(409, "VERSION_CONFLICT", "The report was changed by someone else. Refresh and try again.");
  const data = {};
  if (body.name !== undefined) { const n = String(body.name).trim().slice(0, 200); if (!n) throw new QueryError(422, "INVALID_NAME", "name cannot be empty."); data.name = n; }
  if (body.description !== undefined) data.description = String(body.description).slice(0, 2000);
  if (body.visibility !== undefined && body.visibility !== r.visibility) {
    checkVisibility(req, body.visibility);
    Object.assign(data, { visibility: body.visibility, team: body.visibility === "Team" ? req.user?.team || null : null, department: body.visibility === "Department" ? req.user?.department || null : null, isTemplate: body.visibility === "Template" });
  }
  let v = await latest(r);
  if (body.definition !== undefined) {
    const definition = validateDefinition(req, body.definition);
    if (JSON.stringify(definition) !== JSON.stringify(v?.definition)) {
      v = await prisma.analyticsReportVersion.create({ data: { reportId: r.id, organizationId: req.organizationId, version: r.latestVersion + 1, definition, createdByUserId: req.user?.id || null } });
      data.latestVersion = v.version;
    }
  }
  const updated = await prisma.analyticsReport.update({ where: { id: r.id }, data });
  await audit(req, "analytics.report.updated", r.publicId, { before: { visibility: r.visibility, version: r.latestVersion }, after: { visibility: updated.visibility, version: updated.latestVersion } });
  return serialize(updated, v, { canEdit: true });
}

export async function archiveReport(req, id, archived = true) {
  const { r } = await load(req, id);
  if (!canEdit(req, r)) throw new QueryError(403, "FORBIDDEN", "Only the report owner can archive it.");
  const updated = await prisma.analyticsReport.update({ where: { id: r.id }, data: { archivedAt: archived ? new Date() : null } });
  if (archived) await prisma.analyticsReportSchedule.updateMany({ where: { reportId: r.id, active: true }, data: { active: false, pausedReason: "Report archived" } });
  await audit(req, archived ? "analytics.report.archived" : "analytics.report.restored", r.publicId);
  return serialize(updated, await latest(r), { canEdit: true });
}

export async function cloneReport(req, id, body = {}) {
  const { r } = await load(req, id);
  if (!hasGrant(req, M, "create")) throw new QueryError(403, "FORBIDDEN", "You cannot create reports.");
  const v = await latest(r);
  // The clone is private and re-validated against the cloner's own grants.
  return createReport(req, { name: String(body.name || `${r.name} (copy)`).slice(0, 200), description: r.description, visibility: "Private", definition: v.definition });
}

export async function shareReport(req, id, body) {
  const { r } = await load(req, id);
  if (!canEdit(req, r)) throw new QueryError(403, "FORBIDDEN", "Only the report owner can share it.");
  if (!hasGrant(req, M, "share")) throw new QueryError(403, "SHARE_FORBIDDEN", "You do not have permission to share reports.");
  const targets = [].concat(body?.targets || []);
  if (targets.length > 50) throw new QueryError(422, "TOO_MANY_TARGETS", "At most 50 share targets at once.");
  for (const t of targets) {
    if (!["Membership", "Role"].includes(t?.targetType) || typeof t.targetId !== "string") throw new QueryError(422, "INVALID_TARGET", "Targets are { targetType: Membership|Role, targetId }.");
    if (t.targetType === "Membership") {
      const m = await prisma.organizationMembership.findFirst({ where: { id: t.targetId, organizationId: req.organizationId, status: "Active" } });
      if (!m) throw new QueryError(422, "INVALID_TARGET", "Share targets must be active members of this organization.");
    } else {
      const role = await prisma.role.findFirst({ where: { key: t.targetId, status: "Active" } });
      if (!role) throw new QueryError(422, "INVALID_TARGET", "Unknown role.");
    }
  }
  if (body.replace) await prisma.analyticsReportShare.deleteMany({ where: { reportId: r.id } });
  for (const t of targets) {
    await prisma.analyticsReportShare.upsert({ where: { reportId_targetType_targetId: { reportId: r.id, targetType: t.targetType, targetId: t.targetId } }, update: {}, create: { reportId: r.id, organizationId: req.organizationId, targetType: t.targetType, targetId: t.targetId, createdByUserId: req.user?.id || null } });
  }
  for (const t of [].concat(body?.remove || [])) await prisma.analyticsReportShare.deleteMany({ where: { reportId: r.id, targetType: t?.targetType, targetId: t?.targetId } });
  if (r.visibility === "Private" && targets.length) await prisma.analyticsReport.update({ where: { id: r.id }, data: { visibility: "Shared" } });
  await audit(req, "analytics.report.shared", r.publicId, { after: { targets: targets.map((t) => `${t.targetType}:${t.targetId}`), removed: [].concat(body?.remove || []).length } });
  return getReport(req, id);
}

// Runs the report with the VIEWER's grants and scope; metrics the viewer
// cannot read are left out (and counted), never shown.
export async function runReport(req, id, overrides = {}) {
  const { r } = await load(req, id);
  if (r.archivedAt) throw new QueryError(409, "ARCHIVED", "This report is archived.");
  const v = await latest(r);
  const def = v.definition;
  const visible = def.metrics.filter((k) => METRIC_BY_KEY[k] && hasGrant(req, METRIC_BY_KEY[k].module, "read"));
  const hidden = def.metrics.length - visible.length;
  const base = { report: serialize(r, v), hiddenMetrics: hidden };
  if (!visible.length) return { ...base, metrics: [], note: "You do not have access to any metric in this report." };
  const range = overrides.range ?? def.range;
  const result = await runQuery(req, { metrics: visible, groupBy: def.groupBy, grain: def.grain, filters: def.filters, range, comparison: overrides.comparison ?? def.comparison, currencyMode: overrides.currencyMode ?? def.currencyMode, limit: def.limit });
  return { ...base, ...result, visualization: def.visualization, sort: def.sort };
}

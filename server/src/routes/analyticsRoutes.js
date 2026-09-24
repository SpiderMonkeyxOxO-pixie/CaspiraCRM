// Backend Phase 12 — /api/v1/analytics and /api/v1/reports. Session-cookie
// auth, CSRF on writes, deny-by-default module grants, organizationId (query,
// body or X-Organization-Id) checked against a live membership. The services
// re-check metric grants, record scope and object access on every call.
import { Router } from "express";
import { authenticateCookie } from "../controllers/auth2Controller.js";
import { requireCrmOrgPermission, authorizeOrgAccess } from "../middleware/rbac.js";
import { requireCsrf } from "../middleware/csrf.js";
import * as a from "../analytics/api/analyticsController.js";

const can = (m, act) => requireCrmOrgPermission(m, act);
const write = (m, act) => [requireCsrf, can(m, act)];
const canAny = (...pairs) => async (req, res, next) => {
  const organizationId = req.body?.organizationId || req.query.organizationId || req.headers["x-organization-id"];
  if (!organizationId) return res.status(400).json({ code: "MISSING_ORGANIZATION_ID", message: "organizationId is required (query param, body field, or X-Organization-Id header)." });
  let last;
  for (const [m, act] of pairs) {
    last = await authorizeOrgAccess(req.user, organizationId, m, act);
    if (last.ok) { req.organizationId = organizationId; req.membership = last.membership; req.isSystemOwnerOverride = last.isSystemOwnerOverride; return next(); }
  }
  return res.status(last.status).json({ code: last.code, message: last.message });
};
// The System Owner administers the platform (templates, warehouse health), not
// tenant analytics: tenant figures use the owner's own membership grants, and
// without a membership in the organization they are refused.
const tenantData = (req, res, next) => {
  if (!req.isSystemOwnerOverride) return next();
  if (!req.membership) return res.status(403).json({ code: "TENANT_DATA_RESTRICTED", message: "System Owner access to tenant analytics is limited to templates and warehouse health." });
  req.isSystemOwnerOverride = false;
  return next();
};
const DASH = ["analytics_overview", "analytics_sales", "analytics_activities", "analytics_support", "analytics_projects", "analytics_finance", "analytics_ai"].map((m) => [m, "read"]);
const REPORT_READ = ["read_own", "read_team", "read_department", "read_organization"].map((x) => ["analytics_reports", x]);

export const analyticsRouter = Router();
analyticsRouter.use(authenticateCookie);
analyticsRouter.get("/access", a.myAccess);
analyticsRouter.get("/", canAny(...DASH), a.dashboards);
analyticsRouter.get("/freshness", canAny(...DASH), a.getFreshness);
for (const name of ["overview", "sales", "activities", "support", "projects", "finance", "ai"]) {
  analyticsRouter.get(`/${name}`, can(`analytics_${name}`, "read"), tenantData, a.getDashboard(name));
}
// Query and drill-down are reads, but take a JSON body (POST, CSRF-protected).
analyticsRouter.post("/query", requireCsrf, canAny(...DASH), tenantData, a.query);
analyticsRouter.post("/drilldown", requireCsrf, canAny(...DASH), tenantData, a.drilldown);
analyticsRouter.post("/explain", requireCsrf, canAny(...DASH), tenantData, a.explain);
// Report authors need the catalog to build reports; definitions hold no data.
analyticsRouter.get("/metrics", canAny(["analytics_metrics", "read"], ["analytics_reports", "create"]), a.listMetrics);
analyticsRouter.get("/metrics/:key", can("analytics_metrics", "read"), a.getMetric);
analyticsRouter.post("/metrics/:key/versions", ...write("analytics_metrics", "manage"), a.draftMetric);
analyticsRouter.post("/metrics/:key/versions/:version/publish", ...write("analytics_metrics", "manage"), a.publishMetric);
analyticsRouter.post("/metrics/:key/retire", ...write("analytics_metrics", "manage"), a.retire);
analyticsRouter.get("/warehouse", can("analytics_warehouse", "monitor"), a.warehouseStatus);
analyticsRouter.post("/warehouse/jobs", ...write("analytics_warehouse", "refresh"), a.startJob);
analyticsRouter.post("/warehouse/jobs/:id/retry", ...write("analytics_warehouse", "refresh"), a.retryJob);
analyticsRouter.post("/warehouse/refresh-views", ...write("analytics_warehouse", "refresh"), a.refreshViews);

export const reportsRouter = Router();
reportsRouter.use(authenticateCookie);
// Schedules and exports first so their paths never match "/:id".
reportsRouter.get("/schedules", canAny(["analytics_reports", "schedule"], ...REPORT_READ), a.listSchedules);
reportsRouter.post("/schedules", ...write("analytics_reports", "schedule"), tenantData, a.createSchedule);
reportsRouter.get("/schedules/:id", canAny(["analytics_reports", "schedule"], ...REPORT_READ), a.getSchedule);
reportsRouter.patch("/schedules/:id", ...write("analytics_reports", "schedule"), a.updateSchedule);
reportsRouter.delete("/schedules/:id", ...write("analytics_reports", "schedule"), a.deleteSchedule);
reportsRouter.post("/schedules/:id/run-now", ...write("analytics_reports", "schedule"), a.runScheduleNow);
const EXPORT_ANY = canAny(["analytics_exports", "basic"], ["analytics_exports", "approve"]);
reportsRouter.get("/exports", EXPORT_ANY, a.listExports);
reportsRouter.post("/exports", ...write("analytics_exports", "basic"), tenantData, a.createExport);
reportsRouter.get("/exports/:id", EXPORT_ANY, a.getExport);
reportsRouter.get("/exports/:id/download", can("analytics_exports", "basic"), tenantData, a.downloadExport);
reportsRouter.post("/exports/:id/approve", ...write("analytics_exports", "approve"), a.approveExport);
reportsRouter.post("/exports/:id/reject", ...write("analytics_exports", "approve"), a.rejectExport);
reportsRouter.post("/exports/:id/revoke", requireCsrf, EXPORT_ANY, a.revokeExport);

reportsRouter.get("/", canAny(...REPORT_READ), a.listReports);
reportsRouter.post("/", ...write("analytics_reports", "create"), a.createReport);
reportsRouter.get("/:id", canAny(...REPORT_READ), a.getReport);
reportsRouter.patch("/:id", requireCsrf, canAny(["analytics_reports", "create"], ...REPORT_READ), a.updateReport);
reportsRouter.post("/:id/archive", requireCsrf, canAny(["analytics_reports", "create"], ...REPORT_READ), a.archiveReport);
reportsRouter.post("/:id/clone", ...write("analytics_reports", "create"), a.cloneReport);
reportsRouter.post("/:id/share", ...write("analytics_reports", "share"), a.shareReport);
reportsRouter.get("/:id/run", canAny(...REPORT_READ), tenantData, a.runReport);
reportsRouter.post("/:id/run", requireCsrf, canAny(...REPORT_READ), tenantData, a.runReport);

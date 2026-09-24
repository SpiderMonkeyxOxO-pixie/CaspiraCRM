// What the signed-in member may do in Analytics & Reports (backend analytics
// mode only), from GET /analytics/access. Drives the navigation; the backend
// still checks every request, metric and record.
import { useEffect, useState } from "react";
import * as api from "./backendAnalyticsClient";
import { getActiveOrganizationId } from "./backendSession";

let cache = { orgId: null, promise: null };

export function loadAnalyticsAccess() {
  const orgId = getActiveOrganizationId();
  if (!orgId) return Promise.resolve(null);
  if (cache.orgId !== orgId || !cache.promise) cache = { orgId, promise: api.analyticsAccess().catch(() => null) };
  return cache.promise;
}
export function resetAnalyticsAccess() { cache = { orgId: null, promise: null }; }

export const analyticsCan = (data, moduleId, action) => !!data && (data.systemOwner || (data.access?.[moduleId] || []).includes(action));
const REPORT_READ = ["read_own", "read_team", "read_department", "read_organization"].map((a) => ["analytics_reports", a]);

// Each page and the grants that open it (any of).
export const ANALYTICS_PAGES = [
  { to: "/analytics/overview", label: "Executive Overview", requires: [["analytics_overview", "read"]] },
  { to: "/analytics/sales", label: "Sales", requires: [["analytics_sales", "read"]] },
  { to: "/analytics/activities", label: "Activities", requires: [["analytics_activities", "read"]] },
  { to: "/analytics/support", label: "Support", requires: [["analytics_support", "read"]] },
  { to: "/analytics/projects", label: "Projects", requires: [["analytics_projects", "read"]] },
  { to: "/analytics/finance", label: "Finance", requires: [["analytics_finance", "read"]] },
  { to: "/analytics/ai", label: "AI", requires: [["analytics_ai", "read"]] },
  { to: "/reports", label: "Reports", requires: REPORT_READ },
  { to: "/reports/builder", label: "Report Builder", requires: [["analytics_reports", "create"]] },
  { to: "/reports/schedules", label: "Scheduled Reports", requires: [["analytics_reports", "schedule"]] },
  { to: "/reports/exports", label: "Exports", requires: [["analytics_exports", "basic"], ["analytics_exports", "approve"]] },
  { to: "/analytics/metrics", label: "Metric Definitions", requires: [["analytics_metrics", "read"]] },
  { to: "/analytics/warehouse", label: "Data Warehouse", requires: [["analytics_warehouse", "monitor"]] },
];
export const visibleAnalyticsPages = (data) => ANALYTICS_PAGES.filter((p) => p.requires.some(([m, a]) => analyticsCan(data, m, a)));
export const pageRequires = (to) => ANALYTICS_PAGES.find((p) => p.to === to)?.requires || [];

export function useAnalyticsAccess() {
  const [state, setState] = useState({ loading: api.BACKEND_ANALYTICS_MODE_ENABLED, data: null });
  useEffect(() => {
    if (!api.BACKEND_ANALYTICS_MODE_ENABLED) return undefined;
    let alive = true;
    loadAnalyticsAccess().then((data) => alive && setState({ loading: false, data }));
    return () => { alive = false; };
  }, []);
  return { ...state, can: (m, a) => analyticsCan(state.data, m, a) };
}

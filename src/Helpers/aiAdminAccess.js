// What the signed-in member may do in AI administration (backend AI mode
// only), from GET /ai/governance/access. Drives the "AI Administration"
// navigation; the backend still checks every request.
import { useEffect, useState } from "react";
import * as api from "./backendAiClient";
import { getActiveOrganizationId } from "./backendSession";

let cache = { orgId: null, promise: null };

export function loadAiAdminAccess() {
  const orgId = getActiveOrganizationId();
  if (!orgId) return Promise.resolve(null);
  if (cache.orgId !== orgId || !cache.promise) cache = { orgId, promise: api.aiAdminAccess().catch(() => null) };
  return cache.promise;
}
export function resetAiAdminAccess() { cache = { orgId: null, promise: null }; }

export const aiCan = (data, moduleId, action) => !!data && (data.systemOwner || (data.access?.[moduleId] || []).includes(action));

// Each AI Administration page and the grants that open it (any of).
export const AI_ADMIN_PAGES = [
  { to: "/ai/governance", label: "Governance", requires: [["ai_governance", "read"]] },
  { to: "/ai/evaluations", label: "Evaluations", requires: [["ai_gov_evaluations", "read"]] },
  { to: "/ai/monitoring", label: "Monitoring", requires: [["ai_monitoring", "read"], ["ai_safety", "review"]] },
  { to: "/ai/incidents", label: "Incidents", requires: [["ai_incidents", "view"]] },
  { to: "/ai/releases", label: "Releases", requires: [["ai_governance", "read"]] },
  { to: "/ai/usage", label: "Usage & Cost", requires: [["ai_usage_governance", "read"]] },
];
export const visibleAiAdminPages = (data) => AI_ADMIN_PAGES.filter((p) => p.requires.some(([m, a]) => aiCan(data, m, a)));

export function useAiAdminAccess() {
  const [state, setState] = useState({ loading: api.BACKEND_AI_MODE_ENABLED, data: null });
  useEffect(() => {
    if (!api.BACKEND_AI_MODE_ENABLED) return undefined;
    let alive = true;
    loadAiAdminAccess().then((data) => alive && setState({ loading: false, data }));
    return () => { alive = false; };
  }, []);
  return { ...state, can: (m, a) => aiCan(state.data, m, a) };
}

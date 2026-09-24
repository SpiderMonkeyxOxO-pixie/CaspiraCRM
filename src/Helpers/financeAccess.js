// What the signed-in member may do in Finance (backend mode only), from
// GET /finance/access. Used to show only the Finance links and buttons the
// backend would allow — the backend still checks every request.
import { useEffect, useState } from "react";
import * as api from "./backendFinanceClient";
import { getActiveOrganizationId } from "./backendSession";

let cache = { orgId: null, promise: null };

export function loadFinanceAccess() {
  const orgId = getActiveOrganizationId();
  if (!orgId) return Promise.resolve(null);
  if (cache.orgId !== orgId || !cache.promise) {
    cache = { orgId, promise: api.getFinanceAccess(orgId).catch(() => null) };
  }
  return cache.promise;
}

export function resetFinanceAccess() {
  cache = { orgId: null, promise: null };
}

export const canDo = (data, moduleId, action) => !!data && (data.systemOwner || (data.access?.[moduleId] || []).includes(action));
export const hasAnyFinance = (data) => !!data && (data.systemOwner || Object.values(data.access || {}).some((a) => a.length > 0));

// → { loading, data, can(moduleId, action) }
export function useFinanceAccess() {
  const [state, setState] = useState({ loading: api.BACKEND_FINANCE_MODE_ENABLED, data: null });
  useEffect(() => {
    if (!api.BACKEND_FINANCE_MODE_ENABLED) return undefined;
    let alive = true;
    loadFinanceAccess().then((data) => alive && setState({ loading: false, data }));
    return () => { alive = false; };
  }, []);
  return { ...state, can: (m, a) => canDo(state.data, m, a) };
}

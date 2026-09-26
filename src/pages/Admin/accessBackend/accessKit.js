// Non-component helpers for the live Users & Access screens.
import { useCallback, useEffect, useState } from "react";
import { listMembers, listOrgRoles } from "../../../Helpers/backendAuthClient";
import { orgId } from "../../../Helpers/crmBackendCommon";

export const btn = "px-3 py-1.5 rounded-lg border border-gray-700 hover:bg-gray-800 text-sm disabled:opacity-50";
export const btnPrimary = "px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium disabled:opacity-50";
export const btnDanger = "px-3 py-1.5 rounded-lg border border-red-700 text-red-300 hover:bg-red-900/30 text-sm disabled:opacity-50";
export const input = "w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white";

export function errorText(error, fallback = "Something went wrong. Please try again.") {
  if (error?.response?.status === 403) return error.response.data?.message || "Your role doesn't allow this. Ask an administrator.";
  return error?.response?.data?.message || error?.message || fallback;
}

export const fmtDate = (v) => (v ? new Date(v).toLocaleDateString() : "—");
export const fmtDateTime = (v) => (v ? new Date(v).toLocaleString() : "—");
export const personName = (m) => m?.user?.name || m?.user?.username || m?.user?.email || "Unknown";

// Every member (the API pages at 100) and the roles this admin may hand out.
export function useMembersAndRoles() {
  const [state, setState] = useState({ members: null, roles: [], error: null });
  const load = useCallback(async () => {
    try {
      const members = [];
      for (let page = 1; page < 50; page += 1) {
        const { members: batch = [], pagination } = await listMembers(orgId(), { page, pageSize: 100 });
        members.push(...batch);
        if (!pagination || members.length >= pagination.total || !batch.length) break;
      }
      const { roles = [] } = await listOrgRoles(orgId());
      setState({ members, roles, error: null });
    } catch (error) {
      setState({ members: [], roles: [], error: errorText(error) });
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  return { ...state, reload: load };
}


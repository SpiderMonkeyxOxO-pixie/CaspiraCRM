import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link } from "react-router-dom";
import { RefreshCw, AlertTriangle } from "lucide-react";
import {
  fetchOrganizations, fetchWorkItemPreviews, retryWorkItemSync, selectIntegrations,
} from "../../redux/admin/integrationsSlice";
import { isSystemOwner, canViewExternalTasks, canManageExternalTasksPreview } from "./projectsDevelopmentConfig";
import { findProvider } from "../../Helpers/mockIntegrationsData";
import { MAPPING_REVIEW_REQUIRED } from "../../Helpers/mockProjectsDevelopmentData";

export default function TasksIntegrationList() {
  const dispatch = useDispatch();
  const role = useSelector((s) => s.auth.role);
  const { organizations, workItemPreviews, loading, error } = useSelector(selectIntegrations);
  const owner = isSystemOwner(role);

  const [selectedOrgId, setSelectedOrgId] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");

  useEffect(() => { dispatch(fetchOrganizations()); }, [dispatch]);

  useEffect(() => {
    const filters = owner ? (selectedOrgId ? { organizationId: selectedOrgId } : {}) : {};
    dispatch(fetchWorkItemPreviews(filters));
  }, [dispatch, owner, selectedOrgId]);

  const orgLabel = useMemo(() => (owner ? null : organizations[0]?.name || "Your organization"), [owner, organizations]);

  const statusOptions = useMemo(() => [...new Set(workItemPreviews.map((w) => w.canonicalStatus))], [workItemPreviews]);
  const priorityOptions = useMemo(() => [...new Set(workItemPreviews.map((w) => w.canonicalPriority))], [workItemPreviews]);

  const filtered = useMemo(
    () => workItemPreviews.filter((w) => (!statusFilter || w.canonicalStatus === statusFilter) && (!priorityFilter || w.canonicalPriority === priorityFilter)),
    [workItemPreviews, statusFilter, priorityFilter]
  );

  const retry = (workItemId) => dispatch(retryWorkItemSync(workItemId));

  return (
    <div className="p-4 md:p-6 space-y-5 text-white">
      <div className="text-xs text-gray-500 flex items-center gap-1">
        <span>Administration</span> <span>/</span>{" "}
        <Link to="/admin/integrations/projects-development" className="hover:text-gray-300">Projects & Development</Link>{" "}
        <span>/</span> <span className="text-gray-300">Tasks</span>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold text-white">Work Item Synchronization</h1>
            <span className="px-2 py-0.5 rounded-full text-[11px] border bg-blue-500/15 text-blue-300 border-blue-500/30">Frontend Preview</span>
          </div>
          <p className="text-sm text-gray-400 mt-1 max-w-2xl">
            Each row previews how a real Caspira Task maps to a provider work item's canonical status, priority and type. An unmapped
            provider value is always shown as <span className="text-amber-300 font-medium">{MAPPING_REVIEW_REQUIRED}</span> — never silently
            defaulted.
          </p>
          {!owner && orgLabel && <p className="text-xs text-gray-500 mt-1">Organization: <span className="text-gray-300">{orgLabel}</span></p>}
        </div>
        {owner && (
          <select value={selectedOrgId} onChange={(e) => setSelectedOrgId(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" aria-label="Organization">
            <option value="">All organizations</option>
            {organizations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filters">
        <div>
          <label htmlFor="task-status-filter" className="sr-only">Canonical status</label>
          <select id="task-status-filter" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white">
            <option value="">All statuses</option>
            {statusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="task-priority-filter" className="sr-only">Canonical priority</label>
          <select id="task-priority-filter" value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white">
            <option value="">All priorities</option>
            {priorityOptions.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
      </div>

      {loading && <div className="text-center text-gray-400 py-8 text-sm">Loading…</div>}
      {error && <p className="text-sm text-red-400">{error}</p>}

      {!loading && canViewExternalTasks(role) && (
        <div className="overflow-x-auto bg-gray-900/40 border border-gray-800 rounded-xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs uppercase border-b border-gray-800">
                <th className="px-4 py-3">Provider</th>
                <th className="px-4 py-3">External ID</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Priority</th>
                <th className="px-4 py-3">Sync State</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-500 text-xs">No work items match the current filters.</td></tr>
              ) : filtered.map((w) => (
                <tr key={w.id} className="border-b border-gray-800/60 last:border-0">
                  <td className="px-4 py-3 text-gray-300">{findProvider(w.providerKey)?.name || w.providerKey}</td>
                  <td className="px-4 py-3 text-gray-300">{w.externalId}</td>
                  <td className="px-4 py-3 text-gray-300">{w.type}</td>
                  <td className="px-4 py-3">
                    <span className={w.canonicalStatus === MAPPING_REVIEW_REQUIRED ? "text-amber-300 flex items-center gap-1" : "text-gray-300"}>
                      {w.canonicalStatus === MAPPING_REVIEW_REQUIRED && <AlertTriangle size={12} />} {w.canonicalStatus}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={w.canonicalPriority === MAPPING_REVIEW_REQUIRED ? "text-amber-300 flex items-center gap-1" : "text-gray-300"}>
                      {w.canonicalPriority === MAPPING_REVIEW_REQUIRED && <AlertTriangle size={12} />} {w.canonicalPriority}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={w.syncState === "Conflict" ? "text-amber-300 text-[11px]" : "text-emerald-400 text-[11px]"}>{w.syncState}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {canManageExternalTasksPreview(role) && (
                      <button onClick={() => retry(w.id)} title="Retry preview synchronization" className="text-gray-400 hover:text-white">
                        <RefreshCw size={15} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { fetchProjectMappings, fetchProjectSyncConflicts, resolveProjectSyncConflict, selectIntegrations } from "../../redux/admin/integrationsSlice";
import { canViewProjectMappings, canResolveProjectConflicts } from "./projectsDevelopmentConfig";
import { findProvider } from "../../Helpers/mockIntegrationsData";
import { MAPPING_REVIEW_REQUIRED, SyncConflictResolution } from "../../Helpers/mockProjectsDevelopmentData";
import ActionPreviewModal from "./ActionPreviewModal";

const TABLE_TABS = [
  { key: "projectStatus", label: "Project Status" },
  { key: "taskStatus", label: "Task Status" },
  { key: "priority", label: "Priority" },
  { key: "workItemType", label: "Work Item Type" },
  { key: "users", label: "Users" },
  { key: "teams", label: "Teams" },
  { key: "conflicts", label: "Sync Conflicts" },
];

export default function ProjectMappingsConfig() {
  const dispatch = useDispatch();
  const role = useSelector((s) => s.auth.role);
  const { projectMappings, projectSyncConflicts, loading, error } = useSelector(selectIntegrations);
  const [activeTab, setActiveTab] = useState("projectStatus");
  const [resolvingConflict, setResolvingConflict] = useState(null);
  const [resolution, setResolution] = useState("");

  useEffect(() => {
    dispatch(fetchProjectMappings({}));
    dispatch(fetchProjectSyncConflicts({}));
  }, [dispatch]);

  const confirmResolve = async () => {
    if (!resolvingConflict || !resolution) return;
    await dispatch(resolveProjectSyncConflict({ conflictId: resolvingConflict.id, resolution }));
    setResolvingConflict(null);
    setResolution("");
  };

  const rows = projectMappings?.[activeTab] || [];

  return (
    <div className="p-4 md:p-6 space-y-5 text-white">
      <div className="text-xs text-gray-500 flex items-center gap-1">
        <span>Administration</span> <span>/</span>{" "}
        <Link to="/admin/integrations/projects-development" className="hover:text-gray-300">Projects & Development</Link>{" "}
        <span>/</span> <span className="text-gray-300">Mappings</span>
      </div>

      <div>
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-2xl font-bold text-white">Field & Status Mappings</h1>
          <span className="px-2 py-0.5 rounded-full text-[11px] border bg-blue-500/15 text-blue-300 border-blue-500/30">Frontend Preview</span>
        </div>
        <p className="text-sm text-gray-400 mt-1 max-w-2xl">
          Every provider status, priority, work-item type, user and team is mapped to Caspira's own canonical vocabulary here. An unmapped
          provider value never falls back to a default silently — it is always flagged as{" "}
          <span className="text-amber-300 font-medium">{MAPPING_REVIEW_REQUIRED}</span>.
        </p>
      </div>

      {loading && <div className="text-center text-gray-400 py-8 text-sm">Loading…</div>}
      {error && <p className="text-sm text-red-400">{error}</p>}

      {!loading && canViewProjectMappings(role) && (
        <>
          <div className="flex flex-wrap items-center gap-1 border-b border-gray-800">
            {TABLE_TABS.map((t) => (
              <button key={t.key} onClick={() => setActiveTab(t.key)}
                className={`px-3 py-2 text-sm ${activeTab === t.key ? "text-white border-b-2 border-blue-500" : "text-gray-400"}`}>
                {t.label}
              </button>
            ))}
          </div>

          {activeTab === "conflicts" ? (
            <div className="overflow-x-auto bg-gray-900/40 border border-gray-800 rounded-xl">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 text-xs uppercase border-b border-gray-800">
                    <th className="px-4 py-3">Conflict Type</th>
                    <th className="px-4 py-3">Provider</th>
                    <th className="px-4 py-3">State</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {projectSyncConflicts.length === 0 ? (
                    <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-500 text-xs">No synchronization conflicts to review.</td></tr>
                  ) : projectSyncConflicts.map((c) => (
                    <tr key={c.id} className="border-b border-gray-800/60 last:border-0">
                      <td className="px-4 py-3 text-gray-300">{c.conflictType}</td>
                      <td className="px-4 py-3 text-gray-300">{findProvider(c.providerKey)?.name || c.providerKey}</td>
                      <td className="px-4 py-3">
                        <span className={c.resolutionState === "Open" ? "text-amber-300 text-[11px] flex items-center gap-1" : "text-emerald-400 text-[11px] flex items-center gap-1"}>
                          {c.resolutionState === "Open" ? <AlertTriangle size={12} /> : <CheckCircle2 size={12} />} {c.resolutionState}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {c.resolutionState === "Open" && canResolveProjectConflicts(role) && (
                          <button onClick={() => setResolvingConflict(c)} className="text-sm text-white bg-gray-800 hover:bg-gray-700 rounded-lg px-3 py-1.5">
                            Resolve
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="overflow-x-auto bg-gray-900/40 border border-gray-800 rounded-xl">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 text-xs uppercase border-b border-gray-800">
                    {(activeTab === "users" || activeTab === "teams") ? (
                      <>
                        <th className="px-4 py-3">Provider</th>
                        <th className="px-4 py-3">Provider {activeTab === "users" ? "User" : "Team"}</th>
                        <th className="px-4 py-3">CRM Match</th>
                      </>
                    ) : (
                      <>
                        <th className="px-4 py-3">Provider</th>
                        <th className="px-4 py-3">Provider Value</th>
                        <th className="px-4 py-3">Canonical Value</th>
                        <th className="px-4 py-3">Ownership</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-500 text-xs">No mapping rows yet.</td></tr>
                  ) : rows.map((r) => (
                    <tr key={r.id} className="border-b border-gray-800/60 last:border-0">
                      {(activeTab === "users" || activeTab === "teams") ? (
                        <>
                          <td className="px-4 py-3 text-gray-300">{findProvider(r.providerKey)?.name || r.providerKey}</td>
                          <td className="px-4 py-3 text-gray-300">{r.providerUserName || r.providerTeamName}</td>
                          <td className="px-4 py-3">
                            {activeTab === "users" ? (
                              <span className={r.state === "Matched" ? "text-emerald-400 text-[11px]" : "text-amber-300 text-[11px]"}>{r.state}</span>
                            ) : (
                              <span className={r.crmTeamId ? "text-emerald-400 text-[11px]" : "text-amber-300 text-[11px]"}>{r.crmTeamId ? "Matched" : "Unmatched"}</span>
                            )}
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="px-4 py-3 text-gray-300">{findProvider(r.providerKey)?.name || r.providerKey}</td>
                          <td className="px-4 py-3 text-gray-300">{r.providerValue}</td>
                          <td className="px-4 py-3">
                            <span className={r.canonicalValue === MAPPING_REVIEW_REQUIRED ? "text-amber-300 flex items-center gap-1" : "text-gray-300"}>
                              {r.canonicalValue === MAPPING_REVIEW_REQUIRED && <AlertTriangle size={12} />} {r.canonicalValue}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-500">{r.ownership}</td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {resolvingConflict && (
        <ActionPreviewModal
          title="Resolve Synchronization Conflict"
          actionLabel={resolvingConflict.conflictType}
          details={[
            { label: "Provider", value: findProvider(resolvingConflict.providerKey)?.name || resolvingConflict.providerKey },
            { label: "Description", value: resolvingConflict.description },
          ]}
          confirmLabel="Resolve"
          confirmDisabled={!resolution}
          onConfirm={confirmResolve}
          onCancel={() => { setResolvingConflict(null); setResolution(""); }}
          previewNotice="Resolving updates preview state only. No provider is contacted and no external record changes."
        >
          <div className="mb-3">
            <label htmlFor="resolution-select" className="block text-[11px] text-gray-500 uppercase mb-1">Resolution</label>
            <select id="resolution-select" value={resolution} onChange={(e) => setResolution(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white">
              <option value="">Select a resolution…</option>
              {SyncConflictResolution.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
        </ActionPreviewModal>
      )}
    </div>
  );
}

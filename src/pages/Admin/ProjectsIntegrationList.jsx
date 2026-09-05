import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link, useSearchParams } from "react-router-dom";
import { Rocket, RefreshCw, Pause, Play, Unlink, Undo2, CheckCircle2, XCircle } from "lucide-react";
import {
  fetchOrganizations, fetchWonDealsReadyForProject, fetchExternalProjectLinks,
  previewCreateProjectFromWonDeal, createProjectFromWonDeal, undoWonDealProject,
  unlinkExternalProject, pauseExternalProjectLink, previewProjectSyncRun,
  selectIntegrations,
} from "../../redux/admin/integrationsSlice";
import { isSystemOwner, canViewExternalProjects, canCreateExternalProjectPreview, canUnlinkExternalProjects } from "./projectsDevelopmentConfig";
import { findProvider, FRONTEND_CONNECTION_PREVIEW_LABEL } from "../../Helpers/mockIntegrationsData";
import { PROJECT_TEMPLATES } from "../../Helpers/mockProjectsDevelopmentData";
import { CRM_TEAM } from "../../Helpers/mockUsersData";
import { TEAMS } from "../../Helpers/mockAccessData";
import ActionPreviewModal from "./ActionPreviewModal";

export default function ProjectsIntegrationList() {
  const dispatch = useDispatch();
  const [searchParams] = useSearchParams();
  const role = useSelector((s) => s.auth.role);
  const {
    organizations, wonDealsReadyForProject, externalProjectLinks,
    currentProjectFromWonDealPreview, lastWonDealProjectUndo, loading, error,
  } = useSelector(selectIntegrations);
  const owner = isSystemOwner(role);

  const [selectedOrgId, setSelectedOrgId] = useState("");
  const [activeTab, setActiveTab] = useState(searchParams.get("tab") === "won-deals" ? "won-deals" : "links");

  const [dealForm, setDealForm] = useState({ dealId: null, templateId: "", teamId: "", deliveryOwnerId: "" });
  const [unlinkTarget, setUnlinkTarget] = useState(null);
  const [unlinkReason, setUnlinkReason] = useState("");

  useEffect(() => { dispatch(fetchOrganizations()); }, [dispatch]);

  useEffect(() => {
    const filters = owner ? (selectedOrgId ? { organizationId: selectedOrgId } : {}) : {};
    dispatch(fetchWonDealsReadyForProject());
    dispatch(fetchExternalProjectLinks(filters));
  }, [dispatch, owner, selectedOrgId]);

  const orgLabel = useMemo(() => (owner ? null : organizations[0]?.name || "Your organization"), [owner, organizations]);

  const startDealPreview = (dealId) => {
    setDealForm({ dealId, templateId: "", teamId: "", deliveryOwnerId: "" });
  };

  const runPreview = () => {
    if (!dealForm.dealId) return;
    dispatch(previewCreateProjectFromWonDeal(dealForm));
  };

  const confirmCreate = async () => {
    await dispatch(createProjectFromWonDeal(dealForm));
    setDealForm({ dealId: null, templateId: "", teamId: "", deliveryOwnerId: "" });
    dispatch(fetchWonDealsReadyForProject());
    const filters = owner ? (selectedOrgId ? { organizationId: selectedOrgId } : {}) : {};
    dispatch(fetchExternalProjectLinks(filters));
  };

  const cancelDealPreview = () => setDealForm({ dealId: null, templateId: "", teamId: "", deliveryOwnerId: "" });

  const doUndo = () => dispatch(undoWonDealProject());

  const confirmUnlink = async () => {
    if (!unlinkTarget) return;
    await dispatch(unlinkExternalProject({ linkId: unlinkTarget.id, reason: unlinkReason }));
    setUnlinkTarget(null);
    setUnlinkReason("");
  };

  const togglePause = (link) => dispatch(pauseExternalProjectLink({ linkId: link.id, paused: !link.paused }));
  const runSync = (link) => dispatch(previewProjectSyncRun(link.id));

  const previewDetails = currentProjectFromWonDealPreview
    ? [
        { label: "Source Deal", value: currentProjectFromWonDealPreview.sourceDeal?.name },
        { label: "Company", value: currentProjectFromWonDealPreview.company?.name },
        { label: "Products / Services", value: currentProjectFromWonDealPreview.products?.join(", ") || "—" },
        { label: "Order / Contract", value: currentProjectFromWonDealPreview.orderOrContract?.name || currentProjectFromWonDealPreview.orderOrContract?.id || "None linked" },
        { label: "Template", value: currentProjectFromWonDealPreview.template?.name || "None selected" },
        { label: "Proposed Name", value: currentProjectFromWonDealPreview.proposedName },
        { label: "Proposed Target Date", value: currentProjectFromWonDealPreview.proposedTargetDate ? new Date(currentProjectFromWonDealPreview.proposedTargetDate).toLocaleDateString() : "—" },
        { label: "Proposed Manager", value: currentProjectFromWonDealPreview.proposedManager || "Unassigned" },
        { label: "Proposed Team", value: currentProjectFromWonDealPreview.proposedTeam || "Unassigned" },
        { label: "Proposed Milestones", value: currentProjectFromWonDealPreview.proposedMilestones?.join(", ") },
        { label: "Proposed Destination Provider", value: currentProjectFromWonDealPreview.proposedProvider ? findProvider(currentProjectFromWonDealPreview.proposedProvider)?.name : "None" },
        { label: "Required Permission", value: currentProjectFromWonDealPreview.requiredPermission },
        { label: "Required Approver", value: currentProjectFromWonDealPreview.requiredApprover },
        ...(currentProjectFromWonDealPreview.duplicateWarning ? [{ label: "Warning", value: currentProjectFromWonDealPreview.duplicateWarning }] : []),
      ]
    : [];

  return (
    <div className="p-4 md:p-6 space-y-5 text-white">
      <div className="text-xs text-gray-500 flex items-center gap-1">
        <span>Administration</span> <span>/</span>{" "}
        <Link to="/admin/integrations/projects-development" className="hover:text-gray-300">Projects & Development</Link>{" "}
        <span>/</span> <span className="text-gray-300">Projects</span>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold text-white">Linked Projects</h1>
            <span className="px-2 py-0.5 rounded-full text-[11px] border bg-blue-500/15 text-blue-300 border-blue-500/30">Frontend Preview</span>
          </div>
          <p className="text-sm text-gray-400 mt-1 max-w-2xl">
            Every entry here links a real Caspira Project to a {FRONTEND_CONNECTION_PREVIEW_LABEL.toLowerCase()} external project — no
            independent duplicate Project is ever created.
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

      <div className="flex items-center gap-2 border-b border-gray-800">
        <button onClick={() => setActiveTab("links")}
          className={`px-3 py-2 text-sm ${activeTab === "links" ? "text-white border-b-2 border-blue-500" : "text-gray-400"}`}>
          Linked Projects ({externalProjectLinks.length})
        </button>
        <button onClick={() => setActiveTab("won-deals")}
          className={`px-3 py-2 text-sm ${activeTab === "won-deals" ? "text-white border-b-2 border-blue-500" : "text-gray-400"}`}>
          Won Deals Ready for a Project ({wonDealsReadyForProject.length})
        </button>
      </div>

      {loading && <div className="text-center text-gray-400 py-8 text-sm">Loading…</div>}
      {error && <p className="text-sm text-red-400">{error}</p>}

      {!loading && activeTab === "links" && canViewExternalProjects(role) && (
        <div className="overflow-x-auto bg-gray-900/40 border border-gray-800 rounded-xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs uppercase border-b border-gray-800">
                <th className="px-4 py-3">Provider</th>
                <th className="px-4 py-3">External Project</th>
                <th className="px-4 py-3">Sync State</th>
                <th className="px-4 py-3">Last Preview Sync</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {externalProjectLinks.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-500 text-xs">No Projects are linked to an external provider yet.</td></tr>
              ) : externalProjectLinks.map((l) => (
                <tr key={l.id} className="border-b border-gray-800/60 last:border-0">
                  <td className="px-4 py-3 text-gray-300">{findProvider(l.providerKey)?.name || l.providerKey}</td>
                  <td className="px-4 py-3 text-gray-300">{l.externalProjectName}<span className="block text-[11px] text-gray-500">{l.externalProjectId}</span></td>
                  <td className="px-4 py-3">
                    <span className={`text-[11px] ${l.paused ? "text-gray-500" : l.syncState === "Conflict" ? "text-amber-300" : "text-emerald-400"}`}>
                      {l.paused ? "Paused" : l.syncState}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">{l.lastPreviewSyncAt ? new Date(l.lastPreviewSyncAt).toLocaleString() : "Never"}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => runSync(l)} title="Run preview synchronization" className="text-gray-400 hover:text-white"><RefreshCw size={15} /></button>
                      <button onClick={() => togglePause(l)} title={l.paused ? "Resume preview" : "Pause preview"} className="text-gray-400 hover:text-white">
                        {l.paused ? <Play size={15} /> : <Pause size={15} />}
                      </button>
                      {canUnlinkExternalProjects(role) && (
                        <button onClick={() => setUnlinkTarget(l)} title="Unlink external Project" className="text-gray-400 hover:text-red-400"><Unlink size={15} /></button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && activeTab === "won-deals" && (
        <div className="space-y-3">
          {lastWonDealProjectUndo && (
            <div className="flex items-center justify-between bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-4 py-3">
              <p className="text-sm text-emerald-300">A Project preview was just created from a Won Deal.</p>
              <button onClick={doUndo} className="flex items-center gap-1.5 text-sm text-white bg-gray-800 hover:bg-gray-700 rounded-lg px-3 py-1.5">
                <Undo2 size={14} /> Undo
              </button>
            </div>
          )}
          {wonDealsReadyForProject.length === 0 ? (
            <p className="text-sm text-gray-500 bg-gray-900/40 border border-gray-800 rounded-xl p-4">No Won Deals are waiting on a Project preview.</p>
          ) : wonDealsReadyForProject.map((d) => (
            <div key={d._id} className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <p className="text-sm font-medium text-white flex items-center gap-1.5"><Rocket size={14} className="text-emerald-400" /> {d.name}</p>
                  <p className="text-xs text-gray-500 mt-0.5">Deal value: {d.value != null ? `$${Number(d.value).toLocaleString()}` : "—"}</p>
                </div>
                {canCreateExternalProjectPreview(role) && dealForm.dealId !== d._id && (
                  <button onClick={() => startDealPreview(d._id)} className="text-sm text-white bg-blue-600 hover:bg-blue-500 rounded-lg px-3 py-1.5">
                    Create Project Preview
                  </button>
                )}
              </div>

              {dealForm.dealId === d._id && (
                <div className="mt-3 pt-3 border-t border-gray-800 space-y-3">
                  <div className="grid sm:grid-cols-3 gap-2">
                    <div>
                      <label htmlFor={`tmpl-${d._id}`} className="block text-[11px] text-gray-500 uppercase mb-1">Project Template</label>
                      <select id={`tmpl-${d._id}`} value={dealForm.templateId} onChange={(e) => setDealForm((f) => ({ ...f, templateId: e.target.value }))}
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white">
                        <option value="">Select a template…</option>
                        {PROJECT_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label htmlFor={`team-${d._id}`} className="block text-[11px] text-gray-500 uppercase mb-1">Delivery Team</label>
                      <select id={`team-${d._id}`} value={dealForm.teamId} onChange={(e) => setDealForm((f) => ({ ...f, teamId: e.target.value }))}
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white">
                        <option value="">Select a team…</option>
                        {TEAMS.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label htmlFor={`owner-${d._id}`} className="block text-[11px] text-gray-500 uppercase mb-1">Delivery Owner</label>
                      <select id={`owner-${d._id}`} value={dealForm.deliveryOwnerId} onChange={(e) => setDealForm((f) => ({ ...f, deliveryOwnerId: e.target.value }))}
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white">
                        <option value="">Select an owner…</option>
                        {CRM_TEAM.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={runPreview} className="text-sm text-white bg-gray-800 hover:bg-gray-700 rounded-lg px-3 py-1.5">Validate & Preview</button>
                    <button onClick={cancelDealPreview} className="text-sm text-gray-400 hover:text-white px-3 py-1.5">Cancel</button>
                  </div>
                  {currentProjectFromWonDealPreview && currentProjectFromWonDealPreview.sourceDeal?.id === d._id && (
                    <div className="bg-gray-800/40 rounded-lg p-3">
                      <p className="text-xs text-gray-400 mb-2">Validation checks</p>
                      <ul className="space-y-1">
                        {currentProjectFromWonDealPreview.checks.map((c) => (
                          <li key={c.label} className="flex items-center gap-1.5 text-xs">
                            {c.passed ? <CheckCircle2 size={13} className="text-emerald-400" /> : <XCircle size={13} className="text-red-400" />}
                            <span className={c.passed ? "text-gray-300" : "text-red-300"}>{c.label}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {currentProjectFromWonDealPreview && dealForm.dealId && (
        <ActionPreviewModal
          title="Create Project Preview from Won Deal"
          actionLabel="Create a real Caspira Project (with starter Tasks) linked to this Deal"
          details={previewDetails}
          confirmLabel="Create Project"
          confirmDisabled={!currentProjectFromWonDealPreview.valid}
          onConfirm={confirmCreate}
          onCancel={cancelDealPreview}
          previewNotice="This creates a real internal Project and Tasks for delivery tracking. No external Project or issue is created in Jira, Asana, ClickUp, Trello or Monday.com."
        />
      )}

      {unlinkTarget && (
        <ActionPreviewModal
          title="Unlink External Project"
          actionLabel={`Unlink ${unlinkTarget.externalProjectName}`}
          details={[
            { label: "Provider", value: findProvider(unlinkTarget.providerKey)?.name || unlinkTarget.providerKey },
            { label: "External Project", value: unlinkTarget.externalProjectName },
          ]}
          requiresReason
          reason={unlinkReason}
          onReasonChange={setUnlinkReason}
          confirmLabel="Unlink"
          onConfirm={confirmUnlink}
          onCancel={() => { setUnlinkTarget(null); setUnlinkReason(""); }}
          previewNotice="Unlinking removes the preview link only. The real Caspira Project is never deleted, and no external provider is contacted."
        />
      )}
    </div>
  );
}

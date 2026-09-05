import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import {
  FolderKanban, GitPullRequest, AlertTriangle, XCircle, Clock, PlugZap,
  ListTodo, Ban, Milestone, ShieldAlert, RefreshCw, Rocket,
} from "lucide-react";
import {
  fetchOrganizations, fetchConnections, fetchProjectsDevelopmentOverviewMetrics,
  fetchWonDealsReadyForProject, fetchExternalProjectLinks, fetchProjectSyncConflicts,
  selectIntegrations,
} from "../../redux/admin/integrationsSlice";
import { isSystemOwner, canViewExternalProjects, canViewProjectSync } from "./projectsDevelopmentConfig";
import { findProvider, FRONTEND_CONNECTION_PREVIEW_LABEL } from "../../Helpers/mockIntegrationsData";
import { PHASE4_PROVIDERS } from "../../Helpers/mockProjectsDevelopmentData";

export default function ProjectsDevelopmentOverview() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const role = useSelector((s) => s.auth.role);
  const {
    organizations, connections, projectsDevelopmentOverviewMetrics,
    wonDealsReadyForProject, externalProjectLinks, projectSyncConflicts, loading, error,
  } = useSelector(selectIntegrations);
  const owner = isSystemOwner(role);

  const [selectedOrgId, setSelectedOrgId] = useState("");

  useEffect(() => {
    dispatch(fetchOrganizations());
  }, [dispatch]);

  useEffect(() => {
    const filters = owner ? (selectedOrgId ? { organizationId: selectedOrgId } : {}) : {};
    dispatch(fetchProjectsDevelopmentOverviewMetrics(filters));
    dispatch(fetchConnections(filters));
    dispatch(fetchWonDealsReadyForProject());
    dispatch(fetchExternalProjectLinks(filters));
    dispatch(fetchProjectSyncConflicts({}));
  }, [dispatch, owner, selectedOrgId]);

  const orgLabel = useMemo(() => {
    if (owner) return null;
    return organizations[0]?.name || "Your organization";
  }, [owner, organizations]);

  const providerKeys = useMemo(() => new Set(PHASE4_PROVIDERS.map((p) => p.key)), []);
  const projectDevConnections = useMemo(() => connections.filter((c) => providerKeys.has(c.providerKey)), [connections, providerKeys]);
  const healthCounts = useMemo(() => {
    const counts = {};
    projectDevConnections.forEach((c) => {
      const status = c.health?.status;
      if (!status) return;
      counts[status] = (counts[status] || 0) + 1;
    });
    return counts;
  }, [projectDevConnections]);

  const linksByProvider = useMemo(() => {
    const counts = {};
    externalProjectLinks.forEach((l) => { counts[l.providerKey] = (counts[l.providerKey] || 0) + 1; });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [externalProjectLinks]);

  const pausedLinks = useMemo(() => externalProjectLinks.filter((l) => l.paused), [externalProjectLinks]);
  const conflictLinks = useMemo(() => externalProjectLinks.filter((l) => l.syncState === "Conflict"), [externalProjectLinks]);
  const openConflicts = useMemo(() => projectSyncConflicts.filter((c) => c.resolutionState === "Open"), [projectSyncConflicts]);

  const m = projectsDevelopmentOverviewMetrics;
  const metrics = [
    { label: "Preview-Connected Providers", value: m?.previewConnectedProviders, icon: <PlugZap size={14} className="text-blue-400" />, onClick: () => navigate("/admin/integrations/marketplace") },
    { label: "Linked Projects", value: m?.linkedProjects, icon: <FolderKanban size={14} className="text-blue-400" />, onClick: () => navigate("/admin/integrations/projects-development/projects") },
    { label: "Won Deals Ready for a Project", value: m?.unlinkedExternalProjects, icon: <Rocket size={14} className="text-emerald-400" />, onClick: () => navigate("/admin/integrations/projects-development/projects?tab=won-deals") },
    { label: "Active Work Items", value: m?.activeWorkItems, icon: <ListTodo size={14} className="text-blue-400" />, onClick: () => navigate("/admin/integrations/projects-development/tasks") },
    { label: "Overdue Tasks", value: m?.overdueTasks, icon: <Clock size={14} className="text-amber-400" />, onClick: () => navigate("/admin/integrations/projects-development/tasks?filter=overdue") },
    { label: "Blocked Tasks", value: m?.blockedTasks, icon: <Ban size={14} className="text-red-400" />, onClick: () => navigate("/admin/integrations/projects-development/tasks?filter=blocked") },
    { label: "Milestones at Risk", value: m?.milestonesAtRisk, icon: <Milestone size={14} className="text-amber-400" />, onClick: () => navigate("/admin/integrations/projects-development/projects") },
    { label: "Open Critical Issues", value: m?.openCriticalIssues, icon: <AlertTriangle size={14} className="text-red-400" />, onClick: () => navigate("/admin/integrations/projects-development/development?tab=issues") },
    { label: "Pull/Merge Requests Awaiting Review", value: m?.pullRequestsAwaitingReview, icon: <GitPullRequest size={14} className="text-blue-400" />, onClick: () => navigate("/admin/integrations/projects-development/development?tab=code-reviews") },
    { label: "Failed Builds", value: m?.failedBuilds, icon: <XCircle size={14} className="text-red-400" />, onClick: () => navigate("/admin/integrations/projects-development/development?tab=pipelines") },
    { label: "Failed Deployments", value: m?.failedDeployments, icon: <XCircle size={14} className="text-red-400" />, onClick: () => navigate("/admin/integrations/projects-development/development?tab=deployments") },
    { label: "Synchronization Conflicts", value: m?.synchronizationConflicts, icon: <RefreshCw size={14} className="text-amber-400" />, onClick: () => navigate("/admin/integrations/projects-development/mappings?tab=conflicts") },
  ];

  return (
    <div className="p-4 md:p-6 space-y-5 text-white">
      <div className="text-xs text-gray-500 flex items-center gap-1">
        <span>Administration</span> <span>/</span> <span>Integrations</span> <span>/</span> <span className="text-gray-300">Projects & Development</span>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold text-white">Projects and Development Integrations</h1>
            <span className="px-2 py-0.5 rounded-full text-[11px] border bg-blue-500/15 text-blue-300 border-blue-500/30">Frontend Preview</span>
          </div>
          <p className="text-sm text-gray-400 mt-1 max-w-2xl">
            Preview external project and development-tool integrations for Jira, Asana, ClickUp, Trello, Monday.com, GitHub, GitLab and
            Bitbucket, layered on top of Caspira's own Projects, Tasks, Deals and Support records. Every connection here is a{" "}
            <span className="text-gray-300 font-medium">{FRONTEND_CONNECTION_PREVIEW_LABEL}</span> — no external project, issue, repository,
            pull request, build or deployment is ever created or triggered from this phase.
          </p>
          {!owner && orgLabel && <p className="text-xs text-gray-500 mt-1">Organization: <span className="text-gray-300">{orgLabel}</span></p>}
        </div>
        {owner && (
          <div>
            <label htmlFor="proj-dev-org" className="sr-only">Organization</label>
            <select id="proj-dev-org" value={selectedOrgId} onChange={(e) => setSelectedOrgId(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
              <option value="">All organizations</option>
              {organizations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
        )}
      </div>

      {loading && <div className="text-center text-gray-400 py-8 text-sm">Loading Projects & Development Integrations…</div>}
      {error && <p className="text-sm text-red-400">{error}</p>}

      {!loading && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {metrics.map((mtr) => (
              <MetricCard key={mtr.label} label={mtr.label} value={mtr.value ?? "—"} icon={mtr.icon} onClick={mtr.onClick} />
            ))}
          </div>

          <section className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
            <h2 className="text-sm font-semibold text-white mb-3 flex items-center gap-1.5"><ShieldAlert size={14} className="text-blue-400" /> Provider Health</h2>
            {projectDevConnections.length === 0 ? (
              <p className="text-xs text-gray-500">No project or development providers are connected yet.</p>
            ) : (
              <div className="flex flex-wrap gap-4">
                {Object.entries(healthCounts).map(([status, count]) => (
                  <div key={status} className="flex items-center gap-1.5 text-sm text-gray-300">
                    {count} {status}
                  </div>
                ))}
              </div>
            )}
          </section>

          <div className="grid md:grid-cols-2 gap-4">
            <section className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
              <h2 className="text-sm font-semibold text-white mb-3">Linked Projects by Provider</h2>
              {linksByProvider.length === 0 ? (
                <p className="text-xs text-gray-500">No Projects are linked to an external provider yet.</p>
              ) : (
                <ul className="space-y-2">
                  {linksByProvider.map(([key, count]) => (
                    <li key={key} className="flex items-center justify-between text-sm text-gray-300">
                      <span>{findProvider(key)?.name || key}</span>
                      <span className="text-xs text-gray-500">{count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
              <h2 className="text-sm font-semibold text-white mb-3 flex items-center gap-1.5"><Rocket size={14} className="text-emerald-400" /> Won Deals Ready for a Project</h2>
              <p className="text-sm text-gray-300">{wonDealsReadyForProject.length} Won Deal{wonDealsReadyForProject.length === 1 ? "" : "s"} have no linked Project yet.</p>
              <p className="text-xs text-gray-500 mt-1">Review and preview each on the Projects route — no Project is ever created without explicit confirmation.</p>
            </section>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <section className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
              <h2 className="text-sm font-semibold text-white mb-3">Paused or Conflicted Links</h2>
              {pausedLinks.length === 0 && conflictLinks.length === 0 ? (
                <p className="text-xs text-gray-500">No linked Project is paused or in conflict.</p>
              ) : (
                <ul className="space-y-2">
                  {pausedLinks.map((l) => (
                    <li key={l.id} className="flex items-center justify-between text-sm text-gray-300">
                      <span>{l.externalProjectName}</span>
                      <span className="text-[11px] text-gray-500">Paused</span>
                    </li>
                  ))}
                  {conflictLinks.map((l) => (
                    <li key={l.id} className="flex items-center justify-between text-sm text-gray-300">
                      <span>{l.externalProjectName}</span>
                      <span className="text-[11px] text-amber-300">Conflict</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {canViewProjectSync(role) && (
              <section className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
                <h2 className="text-sm font-semibold text-white mb-3 flex items-center gap-1.5"><RefreshCw size={14} className="text-red-400" /> Synchronization Conflicts</h2>
                {openConflicts.length === 0 ? (
                  <p className="text-xs text-gray-500">No open synchronization conflicts.</p>
                ) : (
                  <ul className="space-y-2">
                    {openConflicts.map((c) => (
                      <li key={c.id} className="flex items-center justify-between text-sm text-gray-300">
                        <span>{c.conflictType}</span>
                        <span className="text-[11px] text-amber-300">{c.resolutionState}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
          </div>

          {canViewExternalProjects(role) && (
            <section className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
              <h2 className="text-sm font-semibold text-white mb-3">Linked Projects</h2>
              {externalProjectLinks.length === 0 ? (
                <p className="text-xs text-gray-500">No Projects are linked yet.</p>
              ) : (
                <ul className="grid sm:grid-cols-2 gap-2">
                  {externalProjectLinks.map((l) => (
                    <li key={l.id} className="flex items-center justify-between text-sm text-gray-300 bg-gray-800/40 rounded-lg px-3 py-2">
                      <span>{findProvider(l.providerKey)?.name || l.providerKey} — {l.externalProjectName}</span>
                      <span className="text-[11px] text-gray-500">{l.paused ? "Paused" : l.syncState}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}

function MetricCard({ label, value, icon, onClick }) {
  return (
    <button onClick={onClick} className="text-left bg-gray-900/40 border border-gray-800 rounded-xl p-3 hover:border-gray-700 transition">
      <div className="flex items-center gap-1.5 text-[11px] text-gray-500 uppercase">{icon}{label}</div>
      <div className="text-xl font-bold text-white mt-1">{value}</div>
    </button>
  );
}

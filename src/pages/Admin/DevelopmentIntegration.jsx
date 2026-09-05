import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link, useSearchParams } from "react-router-dom";
import { GitBranch, Bug, GitPullRequest, PlayCircle, Rocket, Tag, Lock, Globe } from "lucide-react";
import {
  fetchOrganizations, fetchRepositories, fetchDevelopmentIssues, createDevelopmentIssueFromTicket,
  fetchCodeReviews, fetchPipelineRuns, fetchDeployments, fetchReleases, selectIntegrations,
} from "../../redux/admin/integrationsSlice";
import { isSystemOwner, canViewDevelopmentIntegrations, canCreateDevelopmentIssuePreview } from "./projectsDevelopmentConfig";
import { findProvider } from "../../Helpers/mockIntegrationsData";
import { PHASE4_PROVIDERS, MAPPING_REVIEW_REQUIRED } from "../../Helpers/mockProjectsDevelopmentData";
import { tickets } from "../../Helpers/mockSupportData";
import ActionPreviewModal from "./ActionPreviewModal";

const DEV_PROVIDER_KEYS = ["github", "gitlab", "bitbucket"];
const TABS = [
  { key: "repositories", label: "Repositories" },
  { key: "issues", label: "Issues" },
  { key: "code-reviews", label: "Code Reviews" },
  { key: "pipelines", label: "Pipelines" },
  { key: "deployments", label: "Deployments" },
  { key: "releases", label: "Releases" },
];

function formatDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function DevelopmentIntegration() {
  const dispatch = useDispatch();
  const [searchParams] = useSearchParams();
  const role = useSelector((s) => s.auth.role);
  const {
    organizations, repositories, developmentIssues, codeReviews, pipelineRuns, deployments, releases, loading, error,
  } = useSelector(selectIntegrations);
  const owner = isSystemOwner(role);

  const [selectedOrgId, setSelectedOrgId] = useState("");
  const initialTab = TABS.some((t) => t.key === searchParams.get("tab")) ? searchParams.get("tab") : "repositories";
  const [activeTab, setActiveTab] = useState(initialTab);

  const [issueForm, setIssueForm] = useState(null);

  useEffect(() => { dispatch(fetchOrganizations()); }, [dispatch]);

  useEffect(() => {
    const filters = owner ? (selectedOrgId ? { organizationId: selectedOrgId } : {}) : {};
    dispatch(fetchRepositories(filters));
    dispatch(fetchDevelopmentIssues(filters));
    dispatch(fetchCodeReviews(filters));
    dispatch(fetchPipelineRuns(filters));
    dispatch(fetchDeployments(filters));
    dispatch(fetchReleases(filters));
  }, [dispatch, owner, selectedOrgId]);

  const orgLabel = useMemo(() => (owner ? null : organizations[0]?.name || "Your organization"), [owner, organizations]);
  const repoById = useMemo(() => Object.fromEntries(repositories.map((r) => [r.id, r])), [repositories]);
  const openTickets = useMemo(() => tickets.filter((t) => t.status !== "Closed").slice(0, 10), []);

  const startIssueForm = () => setIssueForm({ ticketId: "", providerKey: "github", repositoryId: repositories[0]?.id || "", type: "Bug", priority: "Normal" });
  const cancelIssueForm = () => setIssueForm(null);
  const confirmIssueForm = async () => {
    if (!issueForm?.ticketId || !issueForm.repositoryId) return;
    await dispatch(createDevelopmentIssueFromTicket(issueForm));
    setIssueForm(null);
    const filters = owner ? (selectedOrgId ? { organizationId: selectedOrgId } : {}) : {};
    dispatch(fetchDevelopmentIssues(filters));
  };
  const selectedTicket = issueForm ? tickets.find((t) => t._id === issueForm.ticketId) : null;

  return (
    <div className="p-4 md:p-6 space-y-5 text-white">
      <div className="text-xs text-gray-500 flex items-center gap-1">
        <span>Administration</span> <span>/</span>{" "}
        <Link to="/admin/integrations/projects-development" className="hover:text-gray-300">Projects & Development</Link>{" "}
        <span>/</span> <span className="text-gray-300">Development</span>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold text-white">Development Integrations</h1>
            <span className="px-2 py-0.5 rounded-full text-[11px] border bg-blue-500/15 text-blue-300 border-blue-500/30">Frontend Preview</span>
          </div>
          <p className="text-sm text-gray-400 mt-1 max-w-2xl">
            Preview repository, issue, code review, pipeline, deployment and release metadata from{" "}
            {PHASE4_PROVIDERS.filter((p) => DEV_PROVIDER_KEYS.includes(p.key)).map((p) => p.name).join(", ")}. Source code, diffs and
            credentials are never retrieved or displayed here.
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

      <div className="flex flex-wrap items-center gap-1 border-b border-gray-800">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setActiveTab(t.key)}
            className={`px-3 py-2 text-sm ${activeTab === t.key ? "text-white border-b-2 border-blue-500" : "text-gray-400"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {loading && <div className="text-center text-gray-400 py-8 text-sm">Loading…</div>}
      {error && <p className="text-sm text-red-400">{error}</p>}

      {!loading && canViewDevelopmentIntegrations(role) && (
        <>
          {activeTab === "repositories" && (
            <div className="overflow-x-auto bg-gray-900/40 border border-gray-800 rounded-xl">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 text-xs uppercase border-b border-gray-800">
                    <th className="px-4 py-3"><GitBranch size={12} className="inline mr-1" />Repository</th>
                    <th className="px-4 py-3">Provider</th>
                    <th className="px-4 py-3">Visibility</th>
                    <th className="px-4 py-3">Open Issues</th>
                    <th className="px-4 py-3">Open Reviews</th>
                    <th className="px-4 py-3">Last Activity</th>
                  </tr>
                </thead>
                <tbody>
                  {repositories.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-500 text-xs">No repositories are linked yet.</td></tr>
                  ) : repositories.map((r) => (
                    <tr key={r.id} className="border-b border-gray-800/60 last:border-0">
                      <td className="px-4 py-3 text-gray-300">{r.name}</td>
                      <td className="px-4 py-3 text-gray-300">{findProvider(r.providerKey)?.name || r.providerKey}</td>
                      <td className="px-4 py-3 text-xs text-gray-400 flex items-center gap-1">
                        {r.visibility === "Private" ? <Lock size={12} /> : <Globe size={12} />} {r.visibility}
                      </td>
                      <td className="px-4 py-3 text-gray-300">{r.openIssueCount}</td>
                      <td className="px-4 py-3 text-gray-300">{r.openReviewCount}</td>
                      <td className="px-4 py-3 text-xs text-gray-500">{formatDateTime(r.lastActivityAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {activeTab === "issues" && (
            <div className="space-y-3">
              {canCreateDevelopmentIssuePreview(role) && (
                <div className="flex justify-end">
                  <button onClick={startIssueForm} className="text-sm text-white bg-blue-600 hover:bg-blue-500 rounded-lg px-3 py-1.5">
                    Create Development Issue Preview from Support Ticket
                  </button>
                </div>
              )}
              <div className="overflow-x-auto bg-gray-900/40 border border-gray-800 rounded-xl">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 text-xs uppercase border-b border-gray-800">
                      <th className="px-4 py-3"><Bug size={12} className="inline mr-1" />Title</th>
                      <th className="px-4 py-3">Repository</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Priority</th>
                      <th className="px-4 py-3">Assignee</th>
                    </tr>
                  </thead>
                  <tbody>
                    {developmentIssues.length === 0 ? (
                      <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-500 text-xs">No development issues to preview yet.</td></tr>
                    ) : developmentIssues.map((i) => (
                      <tr key={i.id} className="border-b border-gray-800/60 last:border-0">
                        <td className="px-4 py-3 text-gray-300">{i.title}{i.sourceTicketSummary && <span className="block text-[11px] text-gray-500">From Support Ticket</span>}</td>
                        <td className="px-4 py-3 text-gray-300">{repoById[i.repositoryId]?.name || "—"}</td>
                        <td className="px-4 py-3">
                          <span className={i.canonicalStatus === MAPPING_REVIEW_REQUIRED ? "text-amber-300" : "text-gray-300"}>{i.canonicalStatus}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={i.canonicalPriority === MAPPING_REVIEW_REQUIRED ? "text-amber-300" : "text-gray-300"}>{i.canonicalPriority}</span>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-400">{i.assignee || "Unassigned"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === "code-reviews" && (
            <div className="overflow-x-auto bg-gray-900/40 border border-gray-800 rounded-xl">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 text-xs uppercase border-b border-gray-800">
                    <th className="px-4 py-3"><GitPullRequest size={12} className="inline mr-1" />PR / MR</th>
                    <th className="px-4 py-3">Repository</th>
                    <th className="px-4 py-3">Author</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Checks</th>
                  </tr>
                </thead>
                <tbody>
                  {codeReviews.length === 0 ? (
                    <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-500 text-xs">No pull or merge requests to preview yet.</td></tr>
                  ) : codeReviews.map((r) => (
                    <tr key={r.id} className="border-b border-gray-800/60 last:border-0">
                      <td className="px-4 py-3 text-gray-300">{r.externalId} <span className="text-[11px] text-gray-500">({r.kind})</span></td>
                      <td className="px-4 py-3 text-gray-300">{repoById[r.repositoryId]?.name || "—"}</td>
                      <td className="px-4 py-3 text-gray-300">{r.author}</td>
                      <td className="px-4 py-3 text-[11px] text-gray-300">{r.status}</td>
                      <td className="px-4 py-3 text-[11px] text-gray-400">{r.checksStatus}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {activeTab === "pipelines" && (
            <div className="overflow-x-auto bg-gray-900/40 border border-gray-800 rounded-xl">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 text-xs uppercase border-b border-gray-800">
                    <th className="px-4 py-3"><PlayCircle size={12} className="inline mr-1" />Pipeline</th>
                    <th className="px-4 py-3">Branch</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Started</th>
                  </tr>
                </thead>
                <tbody>
                  {pipelineRuns.length === 0 ? (
                    <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-500 text-xs">No pipeline runs to preview yet.</td></tr>
                  ) : pipelineRuns.map((p) => (
                    <tr key={p.id} className="border-b border-gray-800/60 last:border-0">
                      <td className="px-4 py-3 text-gray-300">{p.name}</td>
                      <td className="px-4 py-3 text-gray-300">{p.branch}</td>
                      <td className="px-4 py-3">
                        <span className={p.status === "Failed" ? "text-red-400 text-[11px]" : p.status === "Passed" ? "text-emerald-400 text-[11px]" : "text-gray-300 text-[11px]"}>
                          {p.status}{p.failureStage ? ` (${p.failureStage})` : ""}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">{formatDateTime(p.startedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {activeTab === "deployments" && (
            <div className="overflow-x-auto bg-gray-900/40 border border-gray-800 rounded-xl">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 text-xs uppercase border-b border-gray-800">
                    <th className="px-4 py-3"><Rocket size={12} className="inline mr-1" />Environment</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Approval</th>
                    <th className="px-4 py-3">Started</th>
                  </tr>
                </thead>
                <tbody>
                  {deployments.length === 0 ? (
                    <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-500 text-xs">No deployments to preview yet.</td></tr>
                  ) : deployments.map((d) => (
                    <tr key={d.id} className="border-b border-gray-800/60 last:border-0">
                      <td className="px-4 py-3 text-gray-300">{d.environment}</td>
                      <td className="px-4 py-3">
                        <span className={d.status === "Failed" ? "text-red-400 text-[11px]" : d.status === "Successful" ? "text-emerald-400 text-[11px]" : "text-amber-300 text-[11px]"}>
                          {d.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-400">{d.approvalStatus}</td>
                      <td className="px-4 py-3 text-xs text-gray-500">{formatDateTime(d.startedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {activeTab === "releases" && (
            <div className="overflow-x-auto bg-gray-900/40 border border-gray-800 rounded-xl">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 text-xs uppercase border-b border-gray-800">
                    <th className="px-4 py-3"><Tag size={12} className="inline mr-1" />Release</th>
                    <th className="px-4 py-3">Version</th>
                    <th className="px-4 py-3">Linked Project</th>
                    <th className="px-4 py-3">Published</th>
                  </tr>
                </thead>
                <tbody>
                  {releases.length === 0 ? (
                    <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-500 text-xs">No releases to preview yet.</td></tr>
                  ) : releases.map((r) => (
                    <tr key={r.id} className="border-b border-gray-800/60 last:border-0">
                      <td className="px-4 py-3 text-gray-300">{r.name}</td>
                      <td className="px-4 py-3 text-gray-300">{r.version}</td>
                      <td className="px-4 py-3 text-xs text-gray-400">{r.crmProjectId ? "Linked" : <span className="text-amber-300">Unlinked</span>}</td>
                      <td className="px-4 py-3 text-xs text-gray-500">{formatDateTime(r.publishedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {issueForm && (
        <ActionPreviewModal
          title="Create Development Issue Preview"
          actionLabel={selectedTicket ? `From Support Ticket: ${selectedTicket.subject}` : "Select a Support Ticket"}
          details={[
            { label: "Provider", value: findProvider(issueForm.providerKey)?.name },
            { label: "Repository", value: repoById[issueForm.repositoryId]?.name || "—" },
            { label: "Type", value: issueForm.type },
            { label: "Priority", value: issueForm.priority },
          ]}
          confirmLabel="Create Issue Preview"
          confirmDisabled={!issueForm.ticketId || !issueForm.repositoryId}
          onConfirm={confirmIssueForm}
          onCancel={cancelIssueForm}
          previewNotice="This creates a frontend preview record only. No issue is created in GitHub, GitLab or Bitbucket."
        >
          <div className="grid sm:grid-cols-2 gap-2 mb-3">
            <div>
              <label htmlFor="issue-ticket" className="block text-[11px] text-gray-500 uppercase mb-1">Support Ticket</label>
              <select id="issue-ticket" value={issueForm.ticketId} onChange={(e) => setIssueForm((f) => ({ ...f, ticketId: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white">
                <option value="">Select a ticket…</option>
                {openTickets.map((t) => <option key={t._id} value={t._id}>{t.subject}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="issue-repo" className="block text-[11px] text-gray-500 uppercase mb-1">Repository</label>
              <select id="issue-repo" value={issueForm.repositoryId} onChange={(e) => setIssueForm((f) => ({ ...f, repositoryId: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white">
                {repositories.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="issue-provider" className="block text-[11px] text-gray-500 uppercase mb-1">Provider</label>
              <select id="issue-provider" value={issueForm.providerKey} onChange={(e) => setIssueForm((f) => ({ ...f, providerKey: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white">
                {DEV_PROVIDER_KEYS.map((k) => <option key={k} value={k}>{findProvider(k)?.name}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="issue-priority" className="block text-[11px] text-gray-500 uppercase mb-1">Priority</label>
              <select id="issue-priority" value={issueForm.priority} onChange={(e) => setIssueForm((f) => ({ ...f, priority: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white">
                {["Urgent", "High", "Normal", "Low"].map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>
        </ActionPreviewModal>
      )}
    </div>
  );
}

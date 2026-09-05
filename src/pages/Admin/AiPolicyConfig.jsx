import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link } from "react-router-dom";
import { fetchOrganizations, fetchAiUseCases, fetchAiPolicies, updateAiPolicyPreview, selectIntegrations } from "../../redux/admin/integrationsSlice";
import { isSystemOwner, canManageAiPolicies } from "./aiProvidersConfig";
import { AI_TOOLS, evaluateAiActionApproval } from "../../Helpers/mockAiProvidersData";
import { CRM_TEAM } from "../../Helpers/mockUsersData";
import ActionPreviewModal from "./ActionPreviewModal";

const TABS = [
  { id: "useCases", label: "Use Cases" },
  { id: "dataAccess", label: "Data Access" },
  { id: "fieldHandling", label: "Field Handling" },
  { id: "humanApproval", label: "Human Approval" },
  { id: "toolPermission", label: "Tool Permissions" },
  { id: "retention", label: "Retention" },
  { id: "providerRestriction", label: "Provider Restrictions" },
  { id: "budget", label: "Budget Limits" },
];

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default function AiPolicyConfig() {
  const dispatch = useDispatch();
  const role = useSelector((s) => s.auth.role);
  const { organizations, aiUseCases, aiPolicies, loading, error } = useSelector(selectIntegrations);
  const owner = isSystemOwner(role);
  const [selectedOrgId, setSelectedOrgId] = useState("");
  const [activeTab, setActiveTab] = useState("useCases");
  const [reviewTarget, setReviewTarget] = useState(null);
  const [approvalTool, setApprovalTool] = useState(null);
  const [requesterId, setRequesterId] = useState("");
  const [approverId, setApproverId] = useState("");

  useEffect(() => { dispatch(fetchOrganizations()); }, [dispatch]);
  useEffect(() => {
    const filters = owner ? (selectedOrgId ? { organizationId: selectedOrgId } : {}) : {};
    dispatch(fetchAiUseCases(filters));
    dispatch(fetchAiPolicies(filters));
  }, [dispatch, owner, selectedOrgId]);

  const orgLabel = useMemo(() => (owner ? null : organizations[0]?.name || "Your organization"), [owner, organizations]);
  const policiesByKind = useMemo(() => {
    const map = {};
    aiPolicies.forEach((p) => { (map[p.kind] ||= []).push(p); });
    return map;
  }, [aiPolicies]);

  const startReview = (policy) => setReviewTarget(policy);
  const confirmReview = async () => {
    if (!reviewTarget) return;
    await dispatch(updateAiPolicyPreview({ policyId: reviewTarget.id, changes: { status: "Active", reviewDate: null } }));
    setReviewTarget(null);
  };

  const startApprovalCheck = (tool) => { setApprovalTool(tool); setRequesterId(""); setApproverId(""); };
  const requesterName = CRM_TEAM.find((m) => m.id === requesterId)?.name;
  const approverName = CRM_TEAM.find((m) => m.id === approverId)?.name;
  const approvalResult = approvalTool && requesterName && approverName
    ? evaluateAiActionApproval({ action: approvalTool.id, requester: requesterName, requiredApprover: "The record owner or their manager", approverName })
    : null;

  function PolicyTable({ kind }) {
    const rows = policiesByKind[kind] || [];
    return (
      <div className="overflow-x-auto bg-gray-900/40 border border-gray-800 rounded-xl">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 text-xs uppercase border-b border-gray-800">
              <th className="px-4 py-3">Policy</th>
              <th className="px-4 py-3">Scope</th>
              <th className="px-4 py-3">Owner</th>
              <th className="px-4 py-3">Version</th>
              <th className="px-4 py-3">Review Date</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-500 text-xs">No policies configured for this category yet.</td></tr>
            ) : rows.map((p) => (
              <tr key={p.id} className="border-b border-gray-800/60 last:border-0">
                <td className="px-4 py-3 text-gray-200">{p.name}</td>
                <td className="px-4 py-3 text-xs text-gray-400">{p.scope}</td>
                <td className="px-4 py-3 text-xs text-gray-400">{p.owner}</td>
                <td className="px-4 py-3 text-xs text-gray-500">v{p.version}</td>
                <td className="px-4 py-3 text-xs text-gray-500">{formatDate(p.reviewDate)}</td>
                <td className="px-4 py-3 text-[11px] text-gray-300">{p.status}</td>
                <td className="px-4 py-3 text-right">
                  {canManageAiPolicies(role) && p.reviewDate && (
                    <button onClick={() => startReview(p)} className="text-xs text-gray-300 hover:text-white">Mark Reviewed</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-5 text-white">
      <div className="text-xs text-gray-500 flex items-center gap-1">
        <span>Administration</span> <span>/</span>{" "}
        <Link to="/admin/integrations/ai-providers" className="hover:text-gray-300">AI Providers</Link>{" "}
        <span>/</span> <span className="text-gray-300">Policies</span>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold text-white">AI Policies</h1>
            <span className="px-2 py-0.5 rounded-full text-[11px] border bg-blue-500/15 text-blue-300 border-blue-500/30">Frontend Preview</span>
          </div>
          <p className="text-sm text-gray-400 mt-1 max-w-2xl">
            Governs which use cases are enabled, what data an AI request may access, which tools it may call, and what
            human approval a sensitive action still requires. Every AI-suggested sensitive action still requires human
            approval — nothing here removes that requirement.
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

      <div className="flex flex-wrap gap-2" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={activeTab === t.id} onClick={() => setActiveTab(t.id)}
            className={`px-3 py-1.5 text-xs rounded-lg border ${activeTab === t.id ? "bg-gray-700 border-gray-600 text-white" : "border-gray-700 text-gray-400"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {loading && <div className="text-center text-gray-400 py-8 text-sm">Loading policies…</div>}
      {error && <p className="text-sm text-red-400">{error}</p>}

      {!loading && activeTab === "useCases" && (
        <div className="overflow-x-auto bg-gray-900/40 border border-gray-800 rounded-xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs uppercase border-b border-gray-800">
                <th className="px-4 py-3">Use Case</th>
                <th className="px-4 py-3">Module</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {aiUseCases.map((u) => (
                <tr key={u.id} className="border-b border-gray-800/60 last:border-0">
                  <td className="px-4 py-3 text-gray-200">{u.label}</td>
                  <td className="px-4 py-3 text-xs text-gray-400">{u.module}</td>
                  <td className="px-4 py-3 text-[11px]">
                    <span className={u.status === "Active" ? "text-emerald-400" : "text-gray-500"}>{u.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && activeTab === "humanApproval" && (
        <div className="overflow-x-auto bg-gray-900/40 border border-gray-800 rounded-xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs uppercase border-b border-gray-800">
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3">Requires Approval</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {AI_TOOLS.filter((t) => t.requiresApproval).map((t) => (
                <tr key={t.id} className="border-b border-gray-800/60 last:border-0">
                  <td className="px-4 py-3 text-gray-200">{t.label}</td>
                  <td className="px-4 py-3 text-[11px] text-amber-300">Required</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => startApprovalCheck(t)} className="text-xs text-gray-300 hover:text-white">Preview Approval Check</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && activeTab === "toolPermission" && (
        <div className="overflow-x-auto bg-gray-900/40 border border-gray-800 rounded-xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs uppercase border-b border-gray-800">
                <th className="px-4 py-3">Tool</th>
                <th className="px-4 py-3">Allowed by Default</th>
                <th className="px-4 py-3">Requires Approval</th>
              </tr>
            </thead>
            <tbody>
              {AI_TOOLS.map((t) => (
                <tr key={t.id} className="border-b border-gray-800/60 last:border-0">
                  <td className="px-4 py-3 text-gray-200">{t.label}</td>
                  <td className="px-4 py-3 text-[11px]">
                    <span className={t.allowedByDefault ? "text-emerald-400" : "text-red-400"}>{t.allowedByDefault ? "Allowed" : "Disallowed"}</span>
                  </td>
                  <td className="px-4 py-3 text-[11px] text-gray-400">{t.requiresApproval ? "Required" : "Not required"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && !["useCases", "humanApproval", "toolPermission"].includes(activeTab) && <PolicyTable kind={activeTab} />}

      {reviewTarget && (
        <ActionPreviewModal
          title="Mark Policy Reviewed"
          actionLabel={`Mark "${reviewTarget.name}" as reviewed`}
          details={[{ label: "Current Version", value: `v${reviewTarget.version}` }]}
          confirmLabel="Mark Reviewed"
          onConfirm={confirmReview}
          onCancel={() => setReviewTarget(null)}
          previewNotice="This updates the frontend policy preview only."
        />
      )}

      {approvalTool && (
        <ActionPreviewModal
          title="Preview Approval Check"
          actionLabel={`Check separation-of-duties for: ${approvalTool.label}`}
          details={approvalResult ? [{ label: "Result", value: approvalResult.eligible ? "Eligible" : "Blocked" }, { label: "Reason", value: approvalResult.reason }] : []}
          confirmLabel="Close"
          onConfirm={() => setApprovalTool(null)}
          onCancel={() => setApprovalTool(null)}
          previewNotice="This is a preview of the approval check only — no real approval is requested or recorded."
        >
          <div className="grid sm:grid-cols-2 gap-2 mb-3">
            <div>
              <label htmlFor="approval-requester" className="block text-[11px] text-gray-500 uppercase mb-1">Requester</label>
              <select id="approval-requester" value={requesterId} onChange={(e) => setRequesterId(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white">
                <option value="">Select…</option>
                {CRM_TEAM.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="approval-approver" className="block text-[11px] text-gray-500 uppercase mb-1">Approver</label>
              <select id="approval-approver" value={approverId} onChange={(e) => setApproverId(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white">
                <option value="">Select…</option>
                {CRM_TEAM.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
          </div>
        </ActionPreviewModal>
      )}
    </div>
  );
}

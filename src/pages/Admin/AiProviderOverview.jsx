import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import {
  Sparkles, PlugZap, GitBranch, ShieldCheck, CheckCircle2, Coins,
  ScrollText, HeartPulse, AlertTriangle,
} from "lucide-react";
import {
  fetchOrganizations, fetchAiProviderOverviewMetrics, fetchAiProviderConnections,
  selectIntegrations,
} from "../../redux/admin/integrationsSlice";
import { isSystemOwner } from "./aiProvidersConfig";

export default function AiProviderOverview() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const role = useSelector((s) => s.auth.role);
  const { organizations, aiProviderConnections, aiProviderOverviewMetrics, loading, error } = useSelector(selectIntegrations);
  const owner = isSystemOwner(role);

  const [selectedOrgId, setSelectedOrgId] = useState("");

  useEffect(() => { dispatch(fetchOrganizations()); }, [dispatch]);

  useEffect(() => {
    const filters = owner ? (selectedOrgId ? { organizationId: selectedOrgId } : {}) : {};
    dispatch(fetchAiProviderOverviewMetrics(filters));
    dispatch(fetchAiProviderConnections(filters));
  }, [dispatch, owner, selectedOrgId]);

  const orgLabel = useMemo(() => (owner ? null : organizations[0]?.name || "Your organization"), [owner, organizations]);
  const m = aiProviderOverviewMetrics;

  const stateCounts = useMemo(() => {
    const counts = {};
    aiProviderConnections.forEach((c) => { counts[c.state] = (counts[c.state] || 0) + 1; });
    return counts;
  }, [aiProviderConnections]);

  const metrics = [
    { label: "Available Provider Previews", value: m?.availableProviderPreviews ?? "—", icon: <PlugZap size={14} className="text-blue-400" />, onClick: () => navigate("/admin/integrations/ai-providers/providers") },
    { label: "Preview-Configured Providers", value: m?.previewConfiguredProviders ?? "—", icon: <ShieldCheck size={14} className="text-emerald-400" />, onClick: () => navigate("/admin/integrations/ai-providers/providers") },
    { label: "Active Routing Policies", value: m?.activeRoutingPolicies ?? "—", icon: <GitBranch size={14} className="text-blue-400" />, onClick: () => navigate("/admin/integrations/ai-providers/routing") },
    { label: "Use Cases Without a Provider", value: m?.useCasesWithoutProvider ?? "—", icon: <AlertTriangle size={14} className="text-amber-400" />, onClick: () => navigate("/admin/integrations/ai-providers/routing") },
    { label: "Use Cases Requiring Approval", value: m?.useCasesRequiringApproval ?? "—", icon: <ShieldCheck size={14} className="text-amber-400" />, onClick: () => navigate("/admin/integrations/ai-providers/policies") },
    { label: "Restricted Data Policies", value: m?.restrictedDataPolicies ?? "—", icon: <ShieldCheck size={14} className="text-red-400" />, onClick: () => navigate("/admin/integrations/ai-providers/privacy") },
    { label: "Evaluation Scenarios", value: m?.evaluationScenarios ?? "—", icon: <CheckCircle2 size={14} className="text-blue-400" />, onClick: () => navigate("/admin/integrations/ai-providers/evaluations") },
    { label: "Failed Evaluation Checks", value: m?.failedEvaluationChecks ?? "—", icon: <AlertTriangle size={14} className="text-red-400" />, onClick: () => navigate("/admin/integrations/ai-providers/evaluations") },
    { label: "Estimated Requests (Preview)", value: m?.estimatedRequests ?? "—", icon: <Coins size={14} className="text-blue-400" />, onClick: () => navigate("/admin/integrations/ai-providers/usage") },
    { label: "Estimated Usage Units", value: m ? `${m.estimatedUsage.inputUnits + m.estimatedUsage.outputUnits}` : "—", icon: <Coins size={14} className="text-blue-400" />, onClick: () => navigate("/admin/integrations/ai-providers/usage") },
    { label: "Provider Health Warnings", value: m?.providerHealthWarnings ?? "—", icon: <HeartPulse size={14} className="text-red-400" />, onClick: () => navigate("/admin/integrations/ai-providers/providers") },
    { label: "Audit Findings", value: m?.auditFindings ?? "—", icon: <ScrollText size={14} className="text-red-400" />, onClick: () => navigate("/admin/integrations/ai-providers/audit") },
  ];

  return (
    <div className="p-4 md:p-6 space-y-5 text-white">
      <div className="text-xs text-gray-500 flex items-center gap-1">
        <span>Administration</span> <span>/</span> <span>Integrations</span> <span>/</span> <span className="text-gray-300">AI Providers</span>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold text-white">AI Provider and Intelligence Integrations</h1>
            <span className="px-2 py-0.5 rounded-full text-[11px] border bg-blue-500/15 text-blue-300 border-blue-500/30">Frontend Preview</span>
          </div>
          <p className="text-sm text-gray-400 mt-1 max-w-2xl">
            Preview Anthropic Claude, OpenAI, Google Gemini, Azure OpenAI and Ollama provider configuration, model
            routing, privacy policy, usage and evaluation controls. No provider is ever contacted, no credential is
            ever stored, and no CRM information is ever sent to an external model from this preview. The existing{" "}
            <span className="text-gray-300 font-medium">AI Overview</span> analysis engine is reused as-is and is
            never replaced by anything here.
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

      {loading && <div className="text-center text-gray-400 py-8 text-sm">Loading AI Provider Integrations…</div>}
      {error && <p className="text-sm text-red-400">{error}</p>}

      {!loading && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {metrics.map((mtr) => (
              <MetricCard key={mtr.label} label={mtr.label} value={mtr.value} icon={mtr.icon} onClick={mtr.onClick} />
            ))}
          </div>

          <section className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
            <h2 className="text-sm font-semibold text-white mb-3 flex items-center gap-1.5"><HeartPulse size={14} className="text-blue-400" /> Provider Health</h2>
            {aiProviderConnections.length === 0 ? (
              <p className="text-xs text-gray-500">No AI provider connection previews exist yet.</p>
            ) : (
              <div className="flex flex-wrap gap-4">
                {Object.entries(stateCounts).map(([state, count]) => (
                  <div key={state} className="flex items-center gap-1.5 text-sm text-gray-300">{count} {state}</div>
                ))}
              </div>
            )}
          </section>

          <div className="grid md:grid-cols-2 gap-4">
            <section className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
              <h2 className="text-sm font-semibold text-white mb-2 flex items-center gap-1.5"><GitBranch size={14} className="text-blue-400" /> Routing and Fallback Readiness</h2>
              <p className="text-sm text-gray-300">{m?.useCasesWithoutProvider ?? 0} use case{m?.useCasesWithoutProvider === 1 ? "" : "s"} without a routed provider, {m?.useCasesRequiringApproval ?? 0} routing polic{m?.useCasesRequiringApproval === 1 ? "y" : "ies"} requiring human approval.</p>
            </section>
            <section className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
              <h2 className="text-sm font-semibold text-white mb-2 flex items-center gap-1.5"><ShieldCheck size={14} className="text-red-400" /> Privacy and Data Protection</h2>
              <p className="text-sm text-gray-300">{m?.restrictedDataPolicies ?? 0} data classification{m?.restrictedDataPolicies === 1 ? "" : "s"} always excluded from any AI request, including Credentials and Secrets.</p>
            </section>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <section className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
              <h2 className="text-sm font-semibold text-white mb-2 flex items-center gap-1.5"><CheckCircle2 size={14} className="text-blue-400" /> Evaluation Summary</h2>
              <p className="text-sm text-gray-300">{m?.evaluationScenarios ?? 0} fixture-based evaluation scenario{m?.evaluationScenarios === 1 ? "" : "s"}, {m?.failedEvaluationChecks ?? 0} failed check{m?.failedEvaluationChecks === 1 ? "" : "s"}.</p>
            </section>
            <section className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
              <h2 className="text-sm font-semibold text-white mb-2 flex items-center gap-1.5"><Coins size={14} className="text-blue-400" /> Usage and Budget Snapshot</h2>
              <p className="text-sm text-gray-300">{m?.estimatedRequests ?? 0} estimated request{m?.estimatedRequests === 1 ? "" : "s"}. These are frontend usage estimates, not provider billing records.</p>
            </section>
          </div>

          <section className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
            <h2 className="text-sm font-semibold text-white mb-2 flex items-center gap-1.5"><ScrollText size={14} className="text-red-400" /> Audit and Findings</h2>
            <p className="text-sm text-gray-300">{m?.auditFindings ?? 0} audit finding{m?.auditFindings === 1 ? "" : "s"} recorded. Full detail is available on the Audit route.</p>
          </section>

          <section className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
            <h2 className="text-sm font-semibold text-white mb-2 flex items-center gap-1.5"><Sparkles size={14} className="text-blue-400" /> Set Up a Provider Preview</h2>
            <p className="text-sm text-gray-300 mb-3">Configure a provider connection preview. No provider account is ever contacted and no credential is ever stored.</p>
            <button onClick={() => navigate("/admin/integrations/ai-providers/providers")} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-500/15 text-blue-300 border border-blue-500/30 hover:bg-blue-500/25 transition">
              Preview Provider Setup
            </button>
          </section>
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

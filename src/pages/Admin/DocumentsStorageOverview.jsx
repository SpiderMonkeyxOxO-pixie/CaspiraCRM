import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import {
  FileText, Link2, Unlink, RefreshCw, ShieldAlert, PlugZap, Clock,
  FileSignature, Users, Archive, Activity, HeartPulse,
} from "lucide-react";
import {
  fetchOrganizations, fetchConnections, fetchDocumentsStorageOverviewMetrics,
  selectIntegrations,
} from "../../redux/admin/integrationsSlice";
import { isSystemOwner } from "./documentsStorageConfig";
import { FRONTEND_CONNECTION_PREVIEW_LABEL } from "../../Helpers/mockIntegrationsData";
import { PHASE6_PROVIDERS } from "../../Helpers/mockDocumentsStorageData";

export default function DocumentsStorageOverview() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const role = useSelector((s) => s.auth.role);
  const { organizations, connections, documentsStorageOverviewMetrics, loading, error } = useSelector(selectIntegrations);
  const owner = isSystemOwner(role);

  const [selectedOrgId, setSelectedOrgId] = useState("");

  useEffect(() => { dispatch(fetchOrganizations()); }, [dispatch]);

  useEffect(() => {
    const filters = owner ? (selectedOrgId ? { organizationId: selectedOrgId } : {}) : {};
    dispatch(fetchDocumentsStorageOverviewMetrics(filters));
    dispatch(fetchConnections(filters));
  }, [dispatch, owner, selectedOrgId]);

  const orgLabel = useMemo(() => (owner ? null : organizations[0]?.name || "Your organization"), [owner, organizations]);
  const m = documentsStorageOverviewMetrics;

  const providerKeys = useMemo(() => new Set(PHASE6_PROVIDERS.map((p) => p.key)), []);
  const docProviderConnections = useMemo(() => connections.filter((c) => providerKeys.has(c.providerKey)), [connections, providerKeys]);
  const healthCounts = useMemo(() => {
    const counts = {};
    docProviderConnections.forEach((c) => {
      const status = c.health?.status;
      if (!status) return;
      counts[status] = (counts[status] || 0) + 1;
    });
    return counts;
  }, [docProviderConnections]);

  const metrics = [
    { label: "Preview-Connected Providers", value: m?.previewConnectedProviders ?? "—", icon: <PlugZap size={14} className="text-blue-400" />, onClick: () => navigate("/admin/integrations/marketplace") },
    { label: "Linked Files", value: m?.linkedFiles ?? "—", icon: <Link2 size={14} className="text-emerald-400" />, onClick: () => navigate("/admin/integrations/documents-storage/files?state=Linked") },
    { label: "Unlinked Files", value: m?.unlinkedFiles ?? "—", icon: <Unlink size={14} className="text-amber-400" />, onClick: () => navigate("/admin/integrations/documents-storage/files?state=Unlinked") },
    { label: "Files with New Versions", value: m?.filesWithNewVersions ?? "—", icon: <RefreshCw size={14} className="text-blue-400" />, onClick: () => navigate("/admin/integrations/documents-storage/files?state=New Version Available") },
    { label: "Restricted Files", value: m?.restrictedFiles ?? "—", icon: <ShieldAlert size={14} className="text-red-400" />, onClick: () => navigate("/admin/integrations/documents-storage/files?state=Restricted") },
    { label: "External Sharing Risks", value: m?.externalSharingRisks ?? "—", icon: <ShieldAlert size={14} className="text-red-400" />, onClick: () => navigate("/admin/integrations/documents-storage/access-review") },
    { label: "Signature Workflows Awaiting Approval", value: m?.workflowsAwaitingApproval ?? "—", icon: <FileSignature size={14} className="text-amber-400" />, onClick: () => navigate("/admin/integrations/documents-storage/signatures?status=Approval Required") },
    { label: "Signature Workflows Awaiting Recipients", value: m?.workflowsAwaitingRecipients ?? "—", icon: <Users size={14} className="text-amber-400" />, onClick: () => navigate("/admin/integrations/documents-storage/signatures?status=Sent Preview") },
    { label: "Expiring Signature Workflows", value: m?.expiringWorkflows ?? "—", icon: <Clock size={14} className="text-amber-400" />, onClick: () => navigate("/admin/integrations/documents-storage/signatures") },
    { label: "Retention Actions Due", value: m?.retentionActionsDue ?? "—", icon: <Archive size={14} className="text-amber-400" />, onClick: () => navigate("/admin/integrations/documents-storage/retention") },
    { label: "Synchronization Conflicts", value: m?.synchronizationConflicts ?? "—", icon: <RefreshCw size={14} className="text-red-400" />, onClick: () => navigate("/admin/integrations/documents-storage/mappings?tab=conflict-rules") },
    { label: "Provider Errors", value: m?.providerErrors ?? "—", icon: <Activity size={14} className="text-red-400" />, onClick: () => navigate("/admin/integrations/marketplace") },
  ];

  return (
    <div className="p-4 md:p-6 space-y-5 text-white">
      <div className="text-xs text-gray-500 flex items-center gap-1">
        <span>Administration</span> <span>/</span> <span>Integrations</span> <span>/</span> <span className="text-gray-300">Documents & Storage</span>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold text-white">Documents, Storage and Electronic Signatures</h1>
            <span className="px-2 py-0.5 rounded-full text-[11px] border bg-blue-500/15 text-blue-300 border-blue-500/30">Frontend Preview</span>
          </div>
          <p className="text-sm text-gray-400 mt-1 max-w-2xl">
            Preview external file references, folder mappings and electronic-signature workflows for Dropbox, Box, Dropbox Sign and Adobe
            Acrobat Sign — alongside extended Google Drive, OneDrive and DocuSign previews. Every connection is a{" "}
            <span className="text-gray-300 font-medium">{FRONTEND_CONNECTION_PREVIEW_LABEL}</span>. The CRM stores secure provider
            references and metadata only — never a copy of the file binary.
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

      {loading && <div className="text-center text-gray-400 py-8 text-sm">Loading Documents & Storage Integrations…</div>}
      {error && <p className="text-sm text-red-400">{error}</p>}

      {!loading && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {metrics.map((mtr) => (
              <MetricCard key={mtr.label} label={mtr.label} value={mtr.value} icon={mtr.icon} onClick={mtr.onClick} />
            ))}
          </div>

          <section className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
            <h2 className="text-sm font-semibold text-white mb-3 flex items-center gap-1.5"><HeartPulse size={14} className="text-blue-400" /> Storage Health / Provider Health</h2>
            {docProviderConnections.length === 0 ? (
              <p className="text-xs text-gray-500">No storage or signature providers are connected yet.</p>
            ) : (
              <div className="flex flex-wrap gap-4">
                {Object.entries(healthCounts).map(([status, count]) => (
                  <div key={status} className="flex items-center gap-1.5 text-sm text-gray-300">{count} {status}</div>
                ))}
              </div>
            )}
          </section>

          <div className="grid md:grid-cols-2 gap-4">
            <section className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
              <h2 className="text-sm font-semibold text-white mb-2">Signature Workflow Status</h2>
              <p className="text-sm text-gray-300">{m?.workflowsAwaitingApproval ?? 0} awaiting approval, {m?.workflowsAwaitingRecipients ?? 0} awaiting recipients, {m?.expiringWorkflows ?? 0} expiring soon.</p>
              <p className="text-xs text-gray-500 mt-1">No signature is ever applied and no request is ever sent from this preview.</p>
            </section>
            <section className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
              <h2 className="text-sm font-semibold text-white mb-2 flex items-center gap-1.5"><ShieldAlert size={14} className="text-red-400" /> Access Risks</h2>
              <p className="text-sm text-gray-300">{m?.externalSharingRisks ?? 0} external sharing risk{m?.externalSharingRisks === 1 ? "" : "s"} detected.</p>
              <p className="text-xs text-gray-500 mt-1">Full explanations are available on the Access Review route.</p>
            </section>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <section className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
              <h2 className="text-sm font-semibold text-white mb-2">Version Conflicts</h2>
              <p className="text-sm text-gray-300">{m?.filesWithNewVersions ?? 0} file{m?.filesWithNewVersions === 1 ? "" : "s"} have a newer provider version available.</p>
            </section>
            <section className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
              <h2 className="text-sm font-semibold text-white mb-2 flex items-center gap-1.5"><Archive size={14} className="text-amber-400" /> Retention Actions</h2>
              <p className="text-sm text-gray-300">{m?.retentionActionsDue ?? 0} retention review/archive action{m?.retentionActionsDue === 1 ? "" : "s"} due.</p>
            </section>
          </div>

          <section className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
            <h2 className="text-sm font-semibold text-white mb-2">Recently Linked Files / Recent Preview Activity</h2>
            <p className="text-xs text-gray-500">Detailed file and audit history is available on the Files and Signatures routes.</p>
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

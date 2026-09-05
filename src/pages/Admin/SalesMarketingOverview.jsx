import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import {
  Inbox, CheckCircle2, Ban, MailWarning, FileWarning, TrendingUp, PlugZap,
} from "lucide-react";
import {
  fetchOrganizations, fetchSalesMarketingOverviewMetrics, fetchConnections,
  selectIntegrations,
} from "../../redux/admin/integrationsSlice";
import { isSystemOwner } from "./salesMarketingConfig";
import { FRONTEND_CONNECTION_PREVIEW_LABEL } from "../../Helpers/mockIntegrationsData";

function MetricCard({ label, value, icon, onClick }) {
  return (
    <button onClick={onClick} className="text-left bg-gray-900/40 border border-gray-800 rounded-xl p-3 hover:border-gray-700 transition">
      <div className="flex items-center gap-1.5 text-[11px] text-gray-500 uppercase">{icon}{label}</div>
      <div className="text-xl font-bold text-white mt-1">{value}</div>
    </button>
  );
}

export default function SalesMarketingOverview() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const role = useSelector((s) => s.auth.role);
  const { organizations, connections, salesMarketingOverviewMetrics, loading, error } = useSelector(selectIntegrations);
  const owner = isSystemOwner(role);

  const [selectedOrgId, setSelectedOrgId] = useState("");

  useEffect(() => {
    dispatch(fetchOrganizations());
  }, [dispatch]);

  useEffect(() => {
    const filters = owner ? (selectedOrgId ? { organizationId: selectedOrgId } : {}) : {};
    dispatch(fetchSalesMarketingOverviewMetrics(filters));
    dispatch(fetchConnections(filters));
  }, [dispatch, owner, selectedOrgId]);

  const orgLabel = useMemo(() => (owner ? null : (organizations[0]?.name || "Your organization")), [owner, organizations]);

  const metrics = [
    { label: "Preview-Connected Providers", value: salesMarketingOverviewMetrics?.previewConnectedMarketingProviders, icon: <PlugZap size={14} className="text-blue-400" />, onClick: () => navigate("/admin/integrations/marketplace") },
    { label: "Leads Needing Review", value: salesMarketingOverviewMetrics?.leadsNeedingReview, icon: <Inbox size={14} className="text-amber-400" />, onClick: () => navigate("/admin/integrations/sales-marketing/lead-capture?status=Needs Review") },
    { label: "Leads Ready to Create", value: salesMarketingOverviewMetrics?.leadsReadyToCreate, icon: <CheckCircle2 size={14} className="text-emerald-400" />, onClick: () => navigate("/admin/integrations/sales-marketing/lead-capture?status=Ready to Create") },
    { label: "Active Suppressions", value: salesMarketingOverviewMetrics?.activeSuppressions, icon: <Ban size={14} className="text-gray-400" />, onClick: () => navigate("/admin/integrations/sales-marketing/suppression") },
    { label: "Failed / Bounced Deliveries", value: salesMarketingOverviewMetrics?.failedOrBouncedDeliveries, icon: <MailWarning size={14} className="text-red-400" />, onClick: () => navigate("/admin/integrations/sales-marketing/email-delivery?status=Failed") },
    { label: "Forms Requiring Mapping", value: salesMarketingOverviewMetrics?.formsRequiringMapping, icon: <FileWarning size={14} className="text-amber-400" />, onClick: () => navigate("/admin/integrations/sales-marketing/forms") },
    { label: "Attributed Pipeline Value", value: salesMarketingOverviewMetrics?.attributedPipelineValue !== undefined ? `$${(salesMarketingOverviewMetrics.attributedPipelineValue || 0).toLocaleString()}` : undefined, icon: <TrendingUp size={14} className="text-blue-400" />, onClick: () => navigate("/admin/integrations/sales-marketing/attribution") },
  ];

  return (
    <div className="p-4 md:p-6 space-y-5 text-white">
      <div className="text-xs text-gray-500 flex items-center gap-1">
        <span>Administration</span> <span>/</span> <span>Integrations</span> <span>/</span> <span className="text-gray-300">Sales & Marketing</span>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold text-white">Sales and Marketing Integrations</h1>
            <span className="px-2 py-0.5 rounded-full text-[11px] border bg-blue-500/15 text-blue-300 border-blue-500/30">Frontend Preview</span>
          </div>
          <p className="text-sm text-gray-400 mt-1 max-w-2xl">
            Preview lead capture, audience synchronization, suppression, email delivery, attribution and form mapping across connected
            marketing providers. Every connection here is a <span className="text-gray-300 font-medium">{FRONTEND_CONNECTION_PREVIEW_LABEL}</span> —
            no real email, ad conversion or form submission is ever sent or received in this phase.
          </p>
          {!owner && orgLabel && <p className="text-xs text-gray-500 mt-1">Organization: <span className="text-gray-300">{orgLabel}</span></p>}
        </div>
        {owner && (
          <div>
            <label htmlFor="sales-mkt-org" className="sr-only">Organization</label>
            <select id="sales-mkt-org" value={selectedOrgId} onChange={(e) => setSelectedOrgId(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
              <option value="">All organizations</option>
              {organizations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
        )}
      </div>

      {loading && <div className="text-center text-gray-400 py-8 text-sm">Loading Sales & Marketing Integrations…</div>}
      {error && <p className="text-sm text-red-400">{error}</p>}

      {!loading && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {metrics.map((m) => (
              <MetricCard key={m.label} label={m.label} value={m.value ?? "—"} icon={m.icon} onClick={m.onClick} />
            ))}
          </div>

          <nav className="flex flex-wrap gap-2" aria-label="Sales & Marketing sections">
            {[
              { to: "/admin/integrations/sales-marketing/lead-capture", label: "Lead Capture" },
              { to: "/admin/integrations/sales-marketing/audiences", label: "Audience Sync" },
              { to: "/admin/integrations/sales-marketing/suppression", label: "Suppression" },
              { to: "/admin/integrations/sales-marketing/email-delivery", label: "Email Delivery" },
              { to: "/admin/integrations/sales-marketing/attribution", label: "Attribution" },
              { to: "/admin/integrations/sales-marketing/forms", label: "Forms" },
            ].map((s) => (
              <button key={s.to} onClick={() => navigate(s.to)} className="text-sm px-3 py-2 rounded-lg border border-gray-700 text-gray-300 hover:bg-gray-800">{s.label}</button>
            ))}
          </nav>

          <section className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
            <h2 className="text-sm font-semibold text-white mb-3">Connected Marketing Providers</h2>
            {connections.length === 0 ? (
              <p className="text-xs text-gray-500">No marketing providers are connected yet — connect one from the Marketplace.</p>
            ) : (
              <p className="text-sm text-gray-300">{salesMarketingOverviewMetrics?.previewConnectedMarketingProviders ?? 0} preview-connected across email marketing, transactional email, advertising, analytics and forms.</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}

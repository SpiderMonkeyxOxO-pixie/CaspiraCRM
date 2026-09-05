import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import {
  ShoppingCart, CreditCard, RefreshCw, Landmark, Repeat, AlertTriangle,
  PlugZap, Receipt, TrendingUp, TrendingDown, Undo2, Banknote,
} from "lucide-react";
import {
  fetchOrganizations, fetchConnections, fetchCommerceFinanceOverviewMetrics,
  selectIntegrations,
} from "../../redux/admin/integrationsSlice";
import { isSystemOwner, canViewReconciliation, canViewSubscriptions } from "./commerceFinanceConfig";
import { FRONTEND_CONNECTION_PREVIEW_LABEL } from "../../Helpers/mockIntegrationsData";

function formatCurrencyGroup(group) {
  const entries = Object.entries(group || {});
  if (entries.length === 0) return "—";
  return entries.map(([currency, minor]) => `${(minor / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`).join(", ");
}

export default function CommerceFinanceOverview() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const role = useSelector((s) => s.auth.role);
  const { organizations, commerceFinanceOverviewMetrics, loading, error } = useSelector(selectIntegrations);
  const owner = isSystemOwner(role);

  const [selectedOrgId, setSelectedOrgId] = useState("");

  useEffect(() => { dispatch(fetchOrganizations()); }, [dispatch]);

  useEffect(() => {
    const filters = owner ? (selectedOrgId ? { organizationId: selectedOrgId } : {}) : {};
    dispatch(fetchCommerceFinanceOverviewMetrics(filters));
    dispatch(fetchConnections(filters));
  }, [dispatch, owner, selectedOrgId]);

  const orgLabel = useMemo(() => (owner ? null : organizations[0]?.name || "Your organization"), [owner, organizations]);
  const m = commerceFinanceOverviewMetrics;

  const metrics = [
    { label: "Preview-Connected Providers", value: m?.previewConnectedProviders ?? "—", icon: <PlugZap size={14} className="text-blue-400" />, onClick: () => navigate("/admin/integrations/marketplace") },
    { label: "Synchronized Order Previews", value: m?.synchronizedOrderPreviews ?? "—", icon: <ShoppingCart size={14} className="text-blue-400" />, onClick: () => navigate("/admin/integrations/commerce-finance/commerce?tab=orders") },
    { label: "Gross Sales", value: formatCurrencyGroup(m?.grossSales), icon: <TrendingUp size={14} className="text-emerald-400" />, onClick: () => navigate("/admin/integrations/commerce-finance/commerce?tab=orders") },
    { label: "Net Sales", value: formatCurrencyGroup(m?.netSales), icon: <TrendingUp size={14} className="text-emerald-400" />, onClick: () => navigate("/admin/integrations/commerce-finance/commerce?tab=orders") },
    { label: "Payments Received", value: formatCurrencyGroup(m?.paymentsReceived), icon: <CreditCard size={14} className="text-blue-400" />, onClick: () => navigate("/admin/integrations/commerce-finance/payments") },
    { label: "Refunds", value: formatCurrencyGroup(m?.refunds), icon: <Undo2 size={14} className="text-amber-400" />, onClick: () => navigate("/admin/integrations/commerce-finance/payments?tab=refunds") },
    { label: "Provider Fees", value: formatCurrencyGroup(m?.providerFees), icon: <Receipt size={14} className="text-amber-400" />, onClick: () => navigate("/admin/integrations/commerce-finance/payments?tab=fees") },
    { label: "Outstanding Invoices", value: formatCurrencyGroup(m?.outstandingInvoices), icon: <Receipt size={14} className="text-amber-400" />, onClick: () => navigate("/admin/integrations/commerce-finance/accounting?tab=invoice") },
    { label: "Overdue Invoices", value: formatCurrencyGroup(m?.overdueInvoices), icon: <TrendingDown size={14} className="text-red-400" />, onClick: () => navigate("/admin/integrations/commerce-finance/accounting?tab=invoice") },
    { label: "Active Subscriptions", value: m?.activeSubscriptions ?? "—", icon: <Repeat size={14} className="text-blue-400" />, onClick: () => navigate("/admin/integrations/commerce-finance/subscriptions") },
    { label: "Monthly Recurring Revenue", value: formatCurrencyGroup(m?.monthlyRecurringRevenue), icon: <TrendingUp size={14} className="text-emerald-400" />, onClick: () => navigate("/admin/integrations/commerce-finance/subscriptions") },
    { label: "Unmatched Transactions", value: m?.unmatchedTransactions ?? "—", icon: <Landmark size={14} className="text-amber-400" />, onClick: () => navigate("/admin/integrations/commerce-finance/reconciliation") },
    { label: "Financial Sync Conflicts", value: m?.financialSyncConflicts ?? "—", icon: <RefreshCw size={14} className="text-red-400" />, onClick: () => navigate("/admin/integrations/commerce-finance/accounting?tab=conflicts") },
  ];

  return (
    <div className="p-4 md:p-6 space-y-5 text-white">
      <div className="text-xs text-gray-500 flex items-center gap-1">
        <span>Administration</span> <span>/</span> <span>Integrations</span> <span>/</span> <span className="text-gray-300">Commerce & Finance</span>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold text-white">Commerce and Finance Integrations</h1>
            <span className="px-2 py-0.5 rounded-full text-[11px] border bg-blue-500/15 text-blue-300 border-blue-500/30">Frontend Preview</span>
          </div>
          <p className="text-sm text-gray-400 mt-1 max-w-2xl">
            Preview storefront, payment, accounting, subscription and banking integrations for Shopify, WooCommerce, PayPal, Razorpay, Square,
            Wise Business, Plaid, Chargebee and Paddle — alongside extended Stripe, QuickBooks Online and Xero previews. Every connection is a{" "}
            <span className="text-gray-300 font-medium">{FRONTEND_CONNECTION_PREVIEW_LABEL}</span>. No payment is ever captured, refunded or
            paid out, and no accounting entry is ever posted in this phase.
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

      {loading && <div className="text-center text-gray-400 py-8 text-sm">Loading Commerce & Finance Integrations…</div>}
      {error && <p className="text-sm text-red-400">{error}</p>}

      {!loading && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {metrics.map((mtr) => (
              <MetricCard key={mtr.label} label={mtr.label} value={mtr.value} icon={mtr.icon} onClick={mtr.onClick} />
            ))}
          </div>

          <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
            <h2 className="text-sm font-semibold text-white mb-2 flex items-center gap-1.5"><AlertTriangle size={14} className="text-amber-400" /> Multi-Currency Handling</h2>
            <p className="text-xs text-gray-500">
              Every monetary figure above is grouped by currency — amounts are never summed across currencies unless a documented fixture
              exchange rate exists. Where a metric shows more than one currency, each is listed separately.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            {canViewSubscriptions(role) && (
              <section className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
                <h2 className="text-sm font-semibold text-white mb-2 flex items-center gap-1.5"><Repeat size={14} className="text-blue-400" /> Subscriptions</h2>
                <p className="text-sm text-gray-300">{m?.activeSubscriptions ?? 0} active subscription preview{m?.activeSubscriptions === 1 ? "" : "s"}.</p>
                <p className="text-xs text-gray-500 mt-1">MRR/ARR and churn detail is available on the Subscriptions route.</p>
              </section>
            )}
            {canViewReconciliation(role) && (
              <section className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
                <h2 className="text-sm font-semibold text-white mb-2 flex items-center gap-1.5"><Banknote size={14} className="text-amber-400" /> Reconciliation</h2>
                <p className="text-sm text-gray-300">{m?.unmatchedTransactions ?? 0} bank transaction{m?.unmatchedTransactions === 1 ? "" : "s"} unmatched.</p>
                <p className="text-xs text-gray-500 mt-1">Every suggested match explains its own evidence — review on the Reconciliation route.</p>
              </section>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function MetricCard({ label, value, icon, onClick }) {
  return (
    <button onClick={onClick} className="text-left bg-gray-900/40 border border-gray-800 rounded-xl p-3 hover:border-gray-700 transition">
      <div className="flex items-center gap-1.5 text-[11px] text-gray-500 uppercase">{icon}{label}</div>
      <div className="text-lg font-bold text-white mt-1 truncate" title={String(value)}>{value}</div>
    </button>
  );
}

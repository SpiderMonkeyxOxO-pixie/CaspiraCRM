import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate, useSearchParams } from "react-router-dom";
import { RefreshCw, Mail, RotateCcw } from "lucide-react";
import { fetchOrganizations, fetchEmailDeliveryEvents, retryEmailDelivery, selectIntegrations } from "../../redux/admin/integrationsSlice";
import { isSystemOwner, canViewEmailDelivery, canRetryEmailDelivery } from "./salesMarketingConfig";
import { findProvider } from "../../Helpers/mockIntegrationsData";
import { EMAIL_DELIVERY_STATUSES, computeEmailDeliveryMetrics } from "../../Helpers/mockSalesMarketingData";

function formatDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

const RETRYABLE = ["Failed", "Deferred", "Bounced"];
const STATUS_COLORS = { Delivered: "text-emerald-400", Opened: "text-emerald-400", Clicked: "text-emerald-400", Bounced: "text-red-400", Failed: "text-red-400", Suppressed: "text-amber-400", Blocked: "text-red-400", Complained: "text-red-400" };

export default function SalesEmailDelivery() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const role = useSelector((s) => s.auth.role);
  const { organizations, emailDeliveryEvents, loading, error } = useSelector(selectIntegrations);
  const owner = isSystemOwner(role);
  // Pure client-side aggregate off the events already in state — the API
  // response includes a computed `metrics` object too, but only `events`
  // is persisted to redux, so recompute locally with the same real
  // selector rather than adding a second, possibly-stale copy of it.
  const emailMetrics = useMemo(() => computeEmailDeliveryMetrics(emailDeliveryEvents), [emailDeliveryEvents]);

  const [selectedOrgId, setSelectedOrgId] = useState("");
  const [purposeTab, setPurposeTab] = useState("");
  const [statusFilter, setStatusFilter] = useState(searchParams.get("status") || "");

  useEffect(() => {
    dispatch(fetchOrganizations());
  }, [dispatch]);

  const refresh = () => {
    const filters = owner ? (selectedOrgId ? { organizationId: selectedOrgId } : {}) : {};
    if (purposeTab) filters.purpose = purposeTab;
    if (statusFilter) filters.status = statusFilter;
    dispatch(fetchEmailDeliveryEvents(filters));
  };

  useEffect(refresh, [dispatch, owner, selectedOrgId, purposeTab, statusFilter]);

  const canView = canViewEmailDelivery(role);

  const handleRetry = async (event) => {
    await dispatch(retryEmailDelivery(event.id));
    refresh();
  };

  if (!canView) {
    return <div className="p-4 md:p-6"><p className="text-sm text-red-400">You do not have permission to view Email Delivery.</p></div>;
  }

  return (
    <div className="p-4 md:p-6 space-y-4 text-white">
      <div className="text-xs text-gray-500 flex items-center gap-1">
        <button onClick={() => navigate("/admin/integrations/sales-marketing")} className="hover:text-gray-300">Administration</button>
        <span>/</span>
        <button onClick={() => navigate("/admin/integrations/sales-marketing")} className="hover:text-gray-300">Sales &amp; Marketing</button>
        <span>/</span>
        <span className="text-gray-300">Email Delivery</span>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold">Email Delivery</h1>
          <span className="px-2 py-0.5 rounded-full text-[11px] border bg-blue-500/15 text-blue-300 border-blue-500/30">Frontend Preview</span>
        </div>
        <div className="flex items-center gap-2">
          {owner && (
            <select value={selectedOrgId} onChange={(e) => setSelectedOrgId(e.target.value)} className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
              <option value="">All organizations</option>
              {organizations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          )}
          <button onClick={refresh} className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border border-gray-700 text-gray-300 hover:bg-gray-800"><RefreshCw size={14} /> Refresh</button>
        </div>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {loading && emailDeliveryEvents.length === 0 && <div className="text-center text-gray-400 py-8 text-sm">Loading email delivery events…</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-3"><p className="text-[11px] text-gray-500 uppercase">Delivery Rate</p><p className="text-xl font-bold text-emerald-400">{emailMetrics.deliveryRate}%</p></div>
        <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-3"><p className="text-[11px] text-gray-500 uppercase">Bounce Rate</p><p className="text-xl font-bold text-red-400">{emailMetrics.bounceRate}%</p></div>
        <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-3"><p className="text-[11px] text-gray-500 uppercase">Transactional</p><p className="text-xl font-bold text-white">{emailMetrics.transactional}</p></div>
        <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-3"><p className="text-[11px] text-gray-500 uppercase">Marketing</p><p className="text-xl font-bold text-white">{emailMetrics.marketing}</p></div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center border border-gray-700 rounded-lg overflow-hidden">
          <button onClick={() => setPurposeTab("")} className={`px-3 py-1.5 text-xs ${purposeTab === "" ? "bg-blue-500/20 text-blue-300" : "text-gray-400"}`}>All</button>
          <button onClick={() => setPurposeTab("transactional")} className={`px-3 py-1.5 text-xs ${purposeTab === "transactional" ? "bg-blue-500/20 text-blue-300" : "text-gray-400"}`}>Transactional</button>
          <button onClick={() => setPurposeTab("marketing")} className={`px-3 py-1.5 text-xs ${purposeTab === "marketing" ? "bg-blue-500/20 text-blue-300" : "text-gray-400"}`}>Marketing</button>
        </div>
        <label htmlFor="ed-status" className="sr-only">Status</label>
        <select id="ed-status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-2 text-sm text-white">
          <option value="">All statuses</option>
          {EMAIL_DELIVERY_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <section className="bg-gray-900/40 border border-gray-800 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] text-gray-500 uppercase border-b border-gray-800">
              <th className="p-3">Provider</th>
              <th className="p-3">Purpose</th>
              <th className="p-3">Type</th>
              <th className="p-3">Status</th>
              <th className="p-3">Occurred At</th>
              <th className="p-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {emailDeliveryEvents.length === 0 ? (
              <tr><td colSpan={6} className="p-6 text-center text-xs text-gray-500">No email delivery events match the current filters.</td></tr>
            ) : (
              emailDeliveryEvents.map((e) => (
                <tr key={e.id} className="border-b border-gray-800/60 hover:bg-gray-800/30">
                  <td className="p-3 text-gray-200 flex items-center gap-1.5"><Mail size={13} className="text-gray-500" /> {findProvider(e.providerKey)?.name || e.providerKey}</td>
                  <td className="p-3 text-gray-400 capitalize">{e.purpose}</td>
                  <td className="p-3 text-gray-400">{e.emailType}</td>
                  <td className={`p-3 font-medium ${STATUS_COLORS[e.status] || "text-gray-300"}`}>{e.status}</td>
                  <td className="p-3 text-gray-500 text-[11px]">{formatDateTime(e.occurredAt)}</td>
                  <td className="p-3">
                    {RETRYABLE.includes(e.status) && canRetryEmailDelivery(role) && (
                      <button onClick={() => handleRetry(e)} className="flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-gray-700 text-gray-300 hover:bg-gray-800"><RotateCcw size={12} /> Retry</button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}

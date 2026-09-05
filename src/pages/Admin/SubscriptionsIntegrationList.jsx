import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link } from "react-router-dom";
import { Repeat, TrendingUp, TrendingDown, AlertTriangle } from "lucide-react";
import {
  fetchOrganizations, fetchSubscriptions, pauseSubscriptionPreview,
  cancelSubscriptionPreview, linkSubscriptionContract, selectIntegrations,
} from "../../redux/admin/integrationsSlice";
import { isSystemOwner, canManageSubscriptionsPreview } from "./commerceFinanceConfig";
import { findProvider } from "../../Helpers/mockIntegrationsData";
import { computeMRR, computeARR, computeChurnedRecurringRevenue } from "../../Helpers/mockCommerceFinanceData";
import { contracts } from "../../Helpers/mockContractData";
import { CRM_TEAM } from "../../Helpers/mockUsersData";
import ActionPreviewModal from "./ActionPreviewModal";

function formatMoney(minor, currency) {
  if (minor == null) return "—";
  return `${(minor / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}
function formatCurrencyGroup(group) {
  const entries = Object.entries(group || {});
  if (entries.length === 0) return "—";
  return entries.map(([currency, minor]) => formatMoney(minor, currency)).join(", ");
}
function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default function SubscriptionsIntegrationList() {
  const dispatch = useDispatch();
  const role = useSelector((s) => s.auth.role);
  const { organizations, subscriptions, loading, error } = useSelector(selectIntegrations);
  const owner = isSystemOwner(role);

  const [selectedOrgId, setSelectedOrgId] = useState("");
  const [cancelTarget, setCancelTarget] = useState(null);
  const [requesterId, setRequesterId] = useState("");
  const [approverId, setApproverId] = useState("");
  const [linkTarget, setLinkTarget] = useState(null);
  const [contractId, setContractId] = useState("");

  useEffect(() => { dispatch(fetchOrganizations()); }, [dispatch]);

  useEffect(() => {
    const filters = owner ? (selectedOrgId ? { organizationId: selectedOrgId } : {}) : {};
    dispatch(fetchSubscriptions(filters));
  }, [dispatch, owner, selectedOrgId]);

  const orgLabel = useMemo(() => (owner ? null : organizations[0]?.name || "Your organization"), [owner, organizations]);
  const scopeOrgId = owner ? (selectedOrgId || undefined) : undefined;
  const mrr = useMemo(() => computeMRR(scopeOrgId), [subscriptions, scopeOrgId]);
  const arr = useMemo(() => computeARR(scopeOrgId), [subscriptions, scopeOrgId]);
  const churn = useMemo(() => computeChurnedRecurringRevenue(scopeOrgId), [subscriptions, scopeOrgId]);

  const togglePause = (sub) => dispatch(pauseSubscriptionPreview(sub.id));
  const startCancel = (sub) => { setCancelTarget(sub); setRequesterId(""); setApproverId(""); };
  const confirmCancel = async () => {
    if (!cancelTarget || !requesterId || !approverId) return;
    const requesterName = CRM_TEAM.find((m) => m.id === requesterId)?.name;
    const approverName = CRM_TEAM.find((m) => m.id === approverId)?.name;
    await dispatch(cancelSubscriptionPreview({ subscriptionId: cancelTarget.id, requesterName, approverName }));
    setCancelTarget(null);
  };
  const cancelSelfBlocked = requesterId && approverId && requesterId === approverId;

  const startLink = (sub) => { setLinkTarget(sub); setContractId(sub.contractId || ""); };
  const confirmLink = async () => {
    if (!linkTarget || !contractId) return;
    await dispatch(linkSubscriptionContract({ subscriptionId: linkTarget.id, contractId }));
    setLinkTarget(null);
  };

  return (
    <div className="p-4 md:p-6 space-y-5 text-white">
      <div className="text-xs text-gray-500 flex items-center gap-1">
        <span>Administration</span> <span>/</span>{" "}
        <Link to="/admin/integrations/commerce-finance" className="hover:text-gray-300">Commerce & Finance</Link>{" "}
        <span>/</span> <span className="text-gray-300">Subscriptions</span>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold text-white">Subscription Integrations</h1>
            <span className="px-2 py-0.5 rounded-full text-[11px] border bg-blue-500/15 text-blue-300 border-blue-500/30">Frontend Preview</span>
          </div>
          <p className="text-sm text-gray-400 mt-1 max-w-2xl">
            Preview billing lifecycle and recurring-revenue calculations for Chargebee and Paddle. Recurring amounts are normalized to a
            monthly figure by billing cycle; one-time payments are never included in MRR or ARR.
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

      {loading && <div className="text-center text-gray-400 py-8 text-sm">Loading…</div>}
      {error && <p className="text-sm text-red-400">{error}</p>}

      {!loading && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-3">
              <div className="flex items-center gap-1.5 text-[11px] text-gray-500 uppercase"><TrendingUp size={14} className="text-emerald-400" /> Monthly Recurring Revenue</div>
              <div className="text-lg font-bold text-white mt-1">{formatCurrencyGroup(mrr)}</div>
            </div>
            <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-3">
              <div className="flex items-center gap-1.5 text-[11px] text-gray-500 uppercase"><TrendingUp size={14} className="text-emerald-400" /> Annual Recurring Revenue</div>
              <div className="text-lg font-bold text-white mt-1">{formatCurrencyGroup(arr)}</div>
            </div>
            <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-3">
              <div className="flex items-center gap-1.5 text-[11px] text-gray-500 uppercase"><TrendingDown size={14} className="text-red-400" /> Churned Recurring Revenue</div>
              <div className="text-lg font-bold text-white mt-1">{formatCurrencyGroup(churn)}</div>
            </div>
          </div>

          <div className="overflow-x-auto bg-gray-900/40 border border-gray-800 rounded-xl">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 text-xs uppercase border-b border-gray-800">
                  <th className="px-4 py-3">Provider</th>
                  <th className="px-4 py-3">Plan</th>
                  <th className="px-4 py-3">Recurring Amount</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Renewal</th>
                  <th className="px-4 py-3">Dunning</th>
                  <th className="px-4 py-3">Contract</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {subscriptions.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-6 text-center text-gray-500 text-xs">No subscriptions to preview yet.</td></tr>
                ) : subscriptions.map((s) => (
                  <tr key={s.id} className="border-b border-gray-800/60 last:border-0">
                    <td className="px-4 py-3 text-gray-300">{findProvider(s.providerKey)?.name || s.providerKey}</td>
                    <td className="px-4 py-3 text-gray-300">{s.planName}</td>
                    <td className="px-4 py-3 text-gray-300">{formatMoney(s.recurringAmountMinor, s.currency)} / {s.billingCycle}</td>
                    <td className="px-4 py-3">
                      <span className={s.status === "Past Due" ? "text-amber-300 text-[11px] flex items-center gap-1" : s.status === "Cancelled" ? "text-gray-500 text-[11px]" : "text-emerald-400 text-[11px]"}>
                        {s.status === "Past Due" && <AlertTriangle size={12} />} {s.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">{formatDate(s.renewalDate)}</td>
                    <td className="px-4 py-3 text-xs text-gray-400">{s.dunningState}</td>
                    <td className="px-4 py-3 text-xs text-gray-400">{s.contractId ? "Linked" : "Unlinked"}</td>
                    <td className="px-4 py-3 text-right">
                      {canManageSubscriptionsPreview(role) && (
                        <div className="flex items-center justify-end gap-2">
                          {!s.contractId && (
                            <button onClick={() => startLink(s)} className="text-[11px] text-blue-400 hover:underline">Link Contract</button>
                          )}
                          {s.status !== "Cancelled" && (
                            <>
                              <button onClick={() => togglePause(s)} className="text-[11px] text-gray-400 hover:text-white">Pause</button>
                              <button onClick={() => startCancel(s)} className="text-[11px] text-red-400 hover:text-red-300">Cancel</button>
                            </>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {cancelTarget && (
        <ActionPreviewModal
          title="Cancel Subscription Preview"
          actionLabel={`Cancel ${cancelTarget.planName}`}
          details={[
            { label: "Provider", value: findProvider(cancelTarget.providerKey)?.name },
            { label: "Current Status", value: cancelTarget.status },
          ]}
          confirmLabel="Cancel Subscription"
          confirmDisabled={!requesterId || !approverId || cancelSelfBlocked}
          onConfirm={confirmCancel}
          onCancel={() => setCancelTarget(null)}
          previewNotice="This cancels a frontend preview only. No real subscription is modified in Chargebee or Paddle."
        >
          <div className="grid sm:grid-cols-2 gap-2 mb-3">
            <div>
              <label htmlFor="cancel-requester" className="block text-[11px] text-gray-500 uppercase mb-1">Requester</label>
              <select id="cancel-requester" value={requesterId} onChange={(e) => setRequesterId(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white">
                <option value="">Select…</option>
                {CRM_TEAM.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="cancel-approver" className="block text-[11px] text-gray-500 uppercase mb-1">Approver</label>
              <select id="cancel-approver" value={approverId} onChange={(e) => setApproverId(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white">
                <option value="">Select…</option>
                {CRM_TEAM.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
          </div>
          {cancelSelfBlocked && <p className="text-xs text-red-400">The requester cannot also be the approver — organization policy requires separation of duties.</p>}
        </ActionPreviewModal>
      )}

      {linkTarget && (
        <ActionPreviewModal
          title="Link Contract"
          actionLabel={`Link a Contract to ${linkTarget.planName}`}
          details={[]}
          confirmLabel="Link Contract"
          confirmDisabled={!contractId}
          onConfirm={confirmLink}
          onCancel={() => setLinkTarget(null)}
          previewNotice="This links to a real, existing Contract. No new Contract is created."
        >
          <div className="mb-3">
            <label htmlFor="contract-select" className="block text-[11px] text-gray-500 uppercase mb-1">Contract</label>
            <select id="contract-select" value={contractId} onChange={(e) => setContractId(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white">
              <option value="">Select a Contract…</option>
              {contracts.slice(0, 15).map((c) => <option key={c._id} value={c._id}>{c.contractNumber}</option>)}
            </select>
          </div>
        </ActionPreviewModal>
      )}
    </div>
  );
}

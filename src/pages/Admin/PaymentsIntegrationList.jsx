import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link, useSearchParams } from "react-router-dom";
import { ShieldAlert, CheckCircle2 } from "lucide-react";
import {
  fetchOrganizations, fetchPaymentTransactions, fetchRefundPreviews, approveRefundPreview,
  fetchDisputePreviews, fetchPayoutReferences, selectIntegrations,
} from "../../redux/admin/integrationsSlice";
import { isSystemOwner, canApproveRefundPreview } from "./commerceFinanceConfig";
import { findProvider } from "../../Helpers/mockIntegrationsData";
import { CRM_TEAM } from "../../Helpers/mockUsersData";
import ActionPreviewModal from "./ActionPreviewModal";

const TABS = ["Transactions", "Refunds", "Disputes", "Fees", "Payouts"];

function formatMoney(minor, currency) {
  if (minor == null) return "—";
  return `${(minor / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}
function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default function PaymentsIntegrationList() {
  const dispatch = useDispatch();
  const [searchParams] = useSearchParams();
  const role = useSelector((s) => s.auth.role);
  const { organizations, paymentTransactions, refundPreviews, disputePreviews, payoutReferences, loading, error } = useSelector(selectIntegrations);
  const owner = isSystemOwner(role);

  const [selectedOrgId, setSelectedOrgId] = useState("");
  const initialTab = TABS.map((t) => t.toLowerCase()).includes(searchParams.get("tab")) ? searchParams.get("tab") : "transactions";
  const [activeTab, setActiveTab] = useState(initialTab);
  const [approvalTarget, setApprovalTarget] = useState(null);
  const [approverId, setApproverId] = useState("");

  useEffect(() => { dispatch(fetchOrganizations()); }, [dispatch]);

  useEffect(() => {
    const filters = owner ? (selectedOrgId ? { organizationId: selectedOrgId } : {}) : {};
    dispatch(fetchPaymentTransactions(filters));
    dispatch(fetchRefundPreviews(filters));
    dispatch(fetchDisputePreviews(filters));
    dispatch(fetchPayoutReferences(filters));
  }, [dispatch, owner, selectedOrgId]);

  const orgLabel = useMemo(() => (owner ? null : organizations[0]?.name || "Your organization"), [owner, organizations]);
  const txById = useMemo(() => Object.fromEntries(paymentTransactions.map((t) => [t.id, t])), [paymentTransactions]);

  const startApproval = (refund) => { setApprovalTarget(refund); setApproverId(""); };
  const cancelApproval = () => { setApprovalTarget(null); setApproverId(""); };
  const confirmApproval = async () => {
    if (!approvalTarget || !approverId) return;
    const approverName = CRM_TEAM.find((m) => m.id === approverId)?.name;
    await dispatch(approveRefundPreview({ refundId: approvalTarget.id, approverName }));
    setApprovalTarget(null);
    setApproverId("");
    const filters = owner ? (selectedOrgId ? { organizationId: selectedOrgId } : {}) : {};
    dispatch(fetchRefundPreviews(filters));
  };
  const selfApprovalBlocked = approvalTarget && approverId && CRM_TEAM.find((m) => m.id === approverId)?.name === approvalTarget.requestedBy;

  return (
    <div className="p-4 md:p-6 space-y-5 text-white">
      <div className="text-xs text-gray-500 flex items-center gap-1">
        <span>Administration</span> <span>/</span>{" "}
        <Link to="/admin/integrations/commerce-finance" className="hover:text-gray-300">Commerce & Finance</Link>{" "}
        <span>/</span> <span className="text-gray-300">Payments</span>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold text-white">Payment Integrations</h1>
            <span className="px-2 py-0.5 rounded-full text-[11px] border bg-blue-500/15 text-blue-300 border-blue-500/30">Frontend Preview</span>
          </div>
          <p className="text-sm text-gray-400 mt-1 max-w-2xl">
            Payment method summaries are always shown safely masked (e.g. "Card ending in 4242") — full card numbers, CVVs, full bank account
            numbers and unmasked tokens are never stored or displayed anywhere in this preview.
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
          <button key={t} onClick={() => setActiveTab(t.toLowerCase())}
            className={`px-3 py-2 text-sm ${activeTab === t.toLowerCase() ? "text-white border-b-2 border-blue-500" : "text-gray-400"}`}>
            {t}
          </button>
        ))}
      </div>

      {loading && <div className="text-center text-gray-400 py-8 text-sm">Loading…</div>}
      {error && <p className="text-sm text-red-400">{error}</p>}

      {!loading && activeTab === "transactions" && (
        <div className="overflow-x-auto bg-gray-900/40 border border-gray-800 rounded-xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs uppercase border-b border-gray-800">
                <th className="px-4 py-3">Provider</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Method</th>
                <th className="px-4 py-3">Settlement</th>
                <th className="px-4 py-3">Date</th>
              </tr>
            </thead>
            <tbody>
              {paymentTransactions.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-500 text-xs">No payment transactions to preview yet.</td></tr>
              ) : paymentTransactions.map((t) => (
                <tr key={t.id} className="border-b border-gray-800/60 last:border-0">
                  <td className="px-4 py-3 text-gray-300">{findProvider(t.providerKey)?.name || t.providerKey}</td>
                  <td className="px-4 py-3 text-gray-300">{formatMoney(t.amountMinor, t.currency)}</td>
                  <td className="px-4 py-3 text-[11px] text-gray-300">{t.status}</td>
                  <td className="px-4 py-3 text-xs text-gray-400">{t.paymentMethodSummary}</td>
                  <td className="px-4 py-3 text-xs text-gray-400">{t.settlementStatus}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{formatDate(t.transactionDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && activeTab === "refunds" && (
        <div className="overflow-x-auto bg-gray-900/40 border border-gray-800 rounded-xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs uppercase border-b border-gray-800">
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Reason</th>
                <th className="px-4 py-3">Requested By</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {refundPreviews.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-500 text-xs">No refund previews yet.</td></tr>
              ) : refundPreviews.map((r) => (
                <tr key={r.id} className="border-b border-gray-800/60 last:border-0">
                  <td className="px-4 py-3 text-gray-300">{formatMoney(r.amountMinor, r.currency)}</td>
                  <td className="px-4 py-3 text-xs text-gray-400">{r.reason}</td>
                  <td className="px-4 py-3 text-xs text-gray-400">{r.requestedBy}</td>
                  <td className="px-4 py-3">
                    <span className={r.status === "Approved" ? "text-emerald-400 text-[11px]" : "text-amber-300 text-[11px]"}>{r.status}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {r.status === "Pending Approval" && canApproveRefundPreview(role) && (
                      <button onClick={() => startApproval(r)} className="text-sm text-white bg-gray-800 hover:bg-gray-700 rounded-lg px-3 py-1.5">
                        Approve
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && activeTab === "disputes" && (
        <div className="overflow-x-auto bg-gray-900/40 border border-gray-800 rounded-xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs uppercase border-b border-gray-800">
                <th className="px-4 py-3">Provider</th>
                <th className="px-4 py-3">Disputed Amount</th>
                <th className="px-4 py-3">Reason</th>
                <th className="px-4 py-3">Evidence Due</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Owner</th>
              </tr>
            </thead>
            <tbody>
              {disputePreviews.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-500 text-xs">No disputes to preview yet.</td></tr>
              ) : disputePreviews.map((d) => (
                <tr key={d.id} className="border-b border-gray-800/60 last:border-0">
                  <td className="px-4 py-3 text-gray-300">{findProvider(d.providerKey)?.name || d.providerKey}</td>
                  <td className="px-4 py-3 text-gray-300">{formatMoney(d.disputedAmountMinor, d.currency)}</td>
                  <td className="px-4 py-3 text-xs text-gray-400">{d.reasonCategory}</td>
                  <td className="px-4 py-3 text-xs text-amber-300">{formatDate(d.evidenceDueDate)}</td>
                  <td className="px-4 py-3 text-[11px] text-gray-300">{d.status}</td>
                  <td className="px-4 py-3 text-xs text-gray-400">{d.assignedOwner || "Unassigned"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && activeTab === "fees" && (
        <div className="overflow-x-auto bg-gray-900/40 border border-gray-800 rounded-xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs uppercase border-b border-gray-800">
                <th className="px-4 py-3">Provider</th>
                <th className="px-4 py-3">Gross Amount</th>
                <th className="px-4 py-3">Fee</th>
                <th className="px-4 py-3">Net Amount</th>
              </tr>
            </thead>
            <tbody>
              {paymentTransactions.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-500 text-xs">No fee data to preview yet.</td></tr>
              ) : paymentTransactions.map((t) => (
                <tr key={t.id} className="border-b border-gray-800/60 last:border-0">
                  <td className="px-4 py-3 text-gray-300">{findProvider(t.providerKey)?.name || t.providerKey}</td>
                  <td className="px-4 py-3 text-gray-300">{formatMoney(t.amountMinor, t.currency)}</td>
                  <td className="px-4 py-3 text-amber-300">{formatMoney(t.feeMinor, t.currency)}</td>
                  <td className="px-4 py-3 text-emerald-400">{formatMoney(t.netAmountMinor, t.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && activeTab === "payouts" && (
        <div className="overflow-x-auto bg-gray-900/40 border border-gray-800 rounded-xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs uppercase border-b border-gray-800">
                <th className="px-4 py-3">Provider</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Settlement Reference</th>
                <th className="px-4 py-3">Date</th>
              </tr>
            </thead>
            <tbody>
              {payoutReferences.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-500 text-xs">No payouts to preview yet.</td></tr>
              ) : payoutReferences.map((p) => (
                <tr key={p.id} className="border-b border-gray-800/60 last:border-0">
                  <td className="px-4 py-3 text-gray-300">{findProvider(p.providerKey)?.name || p.providerKey}</td>
                  <td className="px-4 py-3 text-gray-300">{formatMoney(p.amountMinor, p.currency)}</td>
                  <td className="px-4 py-3 text-[11px] text-gray-300">{p.status}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{p.settlementReference}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{formatDate(p.payoutDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {approvalTarget && (
        <ActionPreviewModal
          title="Approve Refund Preview"
          actionLabel={`Approve refund of ${formatMoney(approvalTarget.amountMinor, approvalTarget.currency)}`}
          details={[
            { label: "Original Payment", value: txById[approvalTarget.paymentTransactionId]?.paymentMethodSummary || approvalTarget.paymentTransactionId },
            { label: "Reason", value: approvalTarget.reason },
            { label: "Refundable Remaining", value: formatMoney(approvalTarget.refundableRemainingMinor, approvalTarget.currency) },
            { label: "Requested By", value: approvalTarget.requestedBy },
            { label: "Required Approver", value: approvalTarget.requiredApprover },
          ]}
          confirmLabel="Approve"
          confirmDisabled={!approverId || selfApprovalBlocked}
          onConfirm={confirmApproval}
          onCancel={cancelApproval}
          previewNotice="This approves a frontend preview only. No real refund is issued to any payment provider."
        >
          <div className="mb-3">
            <label htmlFor="approver-select" className="block text-[11px] text-gray-500 uppercase mb-1">Approving As</label>
            <select id="approver-select" value={approverId} onChange={(e) => setApproverId(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white">
              <option value="">Select an approver…</option>
              {CRM_TEAM.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            {selfApprovalBlocked && (
              <p className="text-xs text-red-400 mt-2 flex items-center gap-1">
                <ShieldAlert size={12} /> The requester cannot approve their own refund preview — organization policy requires separation of duties.
              </p>
            )}
            {approverId && !selfApprovalBlocked && (
              <p className="text-xs text-emerald-400 mt-2 flex items-center gap-1">
                <CheckCircle2 size={12} /> Approver is different from the requester.
              </p>
            )}
          </div>
        </ActionPreviewModal>
      )}
    </div>
  );
}

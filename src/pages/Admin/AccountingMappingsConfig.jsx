import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import {
  fetchAccountingMappings, overrideLedgerMapping, approveCreditNotePreview,
  fetchFinancialSyncConflicts, resolveFinancialSyncConflict, selectIntegrations,
} from "../../redux/admin/integrationsSlice";
import { canViewAccountingIntegrations, canOverrideReconciliation, canResolveFinancialConflicts } from "./commerceFinanceConfig";
import { findProvider } from "../../Helpers/mockIntegrationsData";
import { LedgerAccounts, FinancialSyncConflictResolution } from "../../Helpers/mockCommerceFinanceData";
import { CRM_TEAM } from "../../Helpers/mockUsersData";
import ActionPreviewModal from "./ActionPreviewModal";

const TABS = [
  { key: "customer", label: "Customer Mapping" },
  { key: "product", label: "Product Mapping" },
  { key: "invoice", label: "Invoice Mapping" },
  { key: "payment", label: "Payment Mapping" },
  { key: "tax", label: "Tax Mapping" },
  { key: "ledger", label: "Ledger Mapping" },
  { key: "creditNotes", label: "Credit Notes" },
  { key: "conflicts", label: "Sync Conflicts" },
];

function formatMoney(minor, currency) {
  if (minor == null) return "—";
  return `${(minor / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

export default function AccountingMappingsConfig() {
  const dispatch = useDispatch();
  const role = useSelector((s) => s.auth.role);
  const { accountingMappings, financialSyncConflicts, loading, error } = useSelector(selectIntegrations);
  const [activeTab, setActiveTab] = useState("customer");
  const [overrideTarget, setOverrideTarget] = useState(null);
  const [newLedgerAccount, setNewLedgerAccount] = useState("");
  const [requesterId, setRequesterId] = useState("");
  const [approverId, setApproverId] = useState("");
  const [approvingNote, setApprovingNote] = useState(null);
  const [resolvingConflict, setResolvingConflict] = useState(null);
  const [resolution, setResolution] = useState("");

  useEffect(() => {
    dispatch(fetchAccountingMappings({}));
    dispatch(fetchFinancialSyncConflicts({}));
  }, [dispatch]);

  const rows = accountingMappings?.[activeTab] || [];

  const startOverride = (mapping) => { setOverrideTarget(mapping); setNewLedgerAccount(mapping.ledgerAccount); setRequesterId(""); setApproverId(""); };
  const confirmOverride = async () => {
    if (!overrideTarget || !requesterId || !approverId) return;
    const requesterName = CRM_TEAM.find((m) => m.id === requesterId)?.name;
    const approverName = CRM_TEAM.find((m) => m.id === approverId)?.name;
    await dispatch(overrideLedgerMapping({ mappingId: overrideTarget.id, newLedgerAccount, requesterName, approverName }));
    setOverrideTarget(null);
    dispatch(fetchAccountingMappings({}));
  };
  const overrideSelfBlocked = requesterId && approverId && requesterId === approverId;

  const confirmCreditNoteApproval = async () => {
    if (!approvingNote) return;
    await dispatch(approveCreditNotePreview({ creditNoteId: approvingNote.id, approverName: "Finance Manager Preview", requestedBy: "Finance Staff Preview" }));
    setApprovingNote(null);
    dispatch(fetchAccountingMappings({}));
  };

  const confirmResolve = async () => {
    if (!resolvingConflict || !resolution) return;
    await dispatch(resolveFinancialSyncConflict({ conflictId: resolvingConflict.id, resolution }));
    setResolvingConflict(null);
    setResolution("");
    dispatch(fetchFinancialSyncConflicts({}));
  };

  return (
    <div className="p-4 md:p-6 space-y-5 text-white">
      <div className="text-xs text-gray-500 flex items-center gap-1">
        <span>Administration</span> <span>/</span>{" "}
        <Link to="/admin/integrations/commerce-finance" className="hover:text-gray-300">Commerce & Finance</Link>{" "}
        <span>/</span> <span className="text-gray-300">Accounting</span>
      </div>

      <div>
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-2xl font-bold text-white">Accounting Integrations</h1>
          <span className="px-2 py-0.5 rounded-full text-[11px] border bg-blue-500/15 text-blue-300 border-blue-500/30">Frontend Preview</span>
        </div>
        <p className="text-sm text-gray-400 mt-1 max-w-2xl">
          Customer, product, invoice, payment, tax and ledger mappings between Caspira and QuickBooks Online/Xero. No journal entry is ever
          posted and no accounting record is ever created from these previews.
        </p>
      </div>

      {loading && <div className="text-center text-gray-400 py-8 text-sm">Loading…</div>}
      {error && <p className="text-sm text-red-400">{error}</p>}

      {!loading && canViewAccountingIntegrations(role) && (
        <>
          <div className="flex flex-wrap items-center gap-1 border-b border-gray-800">
            {TABS.map((t) => (
              <button key={t.key} onClick={() => setActiveTab(t.key)}
                className={`px-3 py-2 text-sm ${activeTab === t.key ? "text-white border-b-2 border-blue-500" : "text-gray-400"}`}>
                {t.label}
              </button>
            ))}
          </div>

          {activeTab === "conflicts" ? (
            <div className="overflow-x-auto bg-gray-900/40 border border-gray-800 rounded-xl">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 text-xs uppercase border-b border-gray-800">
                    <th className="px-4 py-3">Domain</th>
                    <th className="px-4 py-3">Conflict Type</th>
                    <th className="px-4 py-3">Provider</th>
                    <th className="px-4 py-3">State</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {financialSyncConflicts.length === 0 ? (
                    <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-500 text-xs">No synchronization conflicts to review.</td></tr>
                  ) : financialSyncConflicts.map((c) => (
                    <tr key={c.id} className="border-b border-gray-800/60 last:border-0">
                      <td className="px-4 py-3 text-xs text-gray-400">{c.domain}</td>
                      <td className="px-4 py-3 text-gray-300">{c.conflictType}</td>
                      <td className="px-4 py-3 text-gray-300">{findProvider(c.providerKey)?.name || c.providerKey}</td>
                      <td className="px-4 py-3">
                        <span className={c.resolutionState === "Open" ? "text-amber-300 text-[11px] flex items-center gap-1" : "text-emerald-400 text-[11px] flex items-center gap-1"}>
                          {c.resolutionState === "Open" ? <AlertTriangle size={12} /> : <CheckCircle2 size={12} />} {c.resolutionState}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {c.resolutionState === "Open" && canResolveFinancialConflicts(role) && (
                          <button onClick={() => setResolvingConflict(c)} className="text-sm text-white bg-gray-800 hover:bg-gray-700 rounded-lg px-3 py-1.5">
                            Resolve
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : activeTab === "ledger" ? (
            <div className="overflow-x-auto bg-gray-900/40 border border-gray-800 rounded-xl">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 text-xs uppercase border-b border-gray-800">
                    <th className="px-4 py-3">Provider</th>
                    <th className="px-4 py-3">CRM Category</th>
                    <th className="px-4 py-3">Ledger Account</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-500 text-xs">No ledger mappings yet.</td></tr>
                  ) : rows.map((m) => (
                    <tr key={m.id} className="border-b border-gray-800/60 last:border-0">
                      <td className="px-4 py-3 text-gray-300">{findProvider(m.providerKey)?.name || m.providerKey}</td>
                      <td className="px-4 py-3 text-gray-300">{m.crmCategory}</td>
                      <td className="px-4 py-3 text-gray-300">{m.ledgerAccount}</td>
                      <td className="px-4 py-3 text-right">
                        {canOverrideReconciliation(role) && (
                          <button onClick={() => startOverride(m)} className="text-sm text-white bg-gray-800 hover:bg-gray-700 rounded-lg px-3 py-1.5">
                            Override
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : activeTab === "creditNotes" ? (
            <div className="overflow-x-auto bg-gray-900/40 border border-gray-800 rounded-xl">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 text-xs uppercase border-b border-gray-800">
                    <th className="px-4 py-3">Provider</th>
                    <th className="px-4 py-3">Amount</th>
                    <th className="px-4 py-3">Reason</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-500 text-xs">No credit note previews yet.</td></tr>
                  ) : rows.map((n) => (
                    <tr key={n.id} className="border-b border-gray-800/60 last:border-0">
                      <td className="px-4 py-3 text-gray-300">{findProvider(n.providerKey)?.name || n.providerKey}</td>
                      <td className="px-4 py-3 text-gray-300">{formatMoney(n.amountMinor, n.currency)}</td>
                      <td className="px-4 py-3 text-xs text-gray-400">{n.reason}</td>
                      <td className="px-4 py-3 text-[11px] text-gray-300">{n.status}</td>
                      <td className="px-4 py-3 text-right">
                        {n.status === "Pending Approval" && canOverrideReconciliation(role) && (
                          <button onClick={() => setApprovingNote(n)} className="text-sm text-white bg-gray-800 hover:bg-gray-700 rounded-lg px-3 py-1.5">
                            Approve
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="overflow-x-auto bg-gray-900/40 border border-gray-800 rounded-xl">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 text-xs uppercase border-b border-gray-800">
                    <th className="px-4 py-3">Provider</th>
                    <th className="px-4 py-3">CRM Record</th>
                    <th className="px-4 py-3">Provider Record</th>
                    <th className="px-4 py-3">Source of Truth</th>
                    <th className="px-4 py-3">Mapping State</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-500 text-xs">No mapping rows yet.</td></tr>
                  ) : rows.map((r) => (
                    <tr key={r.id} className="border-b border-gray-800/60 last:border-0">
                      <td className="px-4 py-3 text-gray-300">{findProvider(r.providerKey)?.name || r.providerKey}</td>
                      <td className="px-4 py-3 text-gray-300">{r.crmRecordLabel || "—"}</td>
                      <td className="px-4 py-3 text-xs text-gray-400">{r.providerRecordId}</td>
                      <td className="px-4 py-3 text-xs text-gray-400">{r.sourceOfTruth}</td>
                      <td className="px-4 py-3">
                        <span className={r.mappingState === "Mapped" ? "text-emerald-400 text-[11px]" : "text-amber-300 text-[11px] flex items-center gap-1"}>
                          {r.mappingState !== "Mapped" && <AlertTriangle size={12} />} {r.mappingState}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {overrideTarget && (
        <ActionPreviewModal
          title="Override Ledger Mapping"
          actionLabel={`Change ledger account for ${overrideTarget.crmCategory}`}
          details={[
            { label: "Provider", value: findProvider(overrideTarget.providerKey)?.name || overrideTarget.providerKey },
            { label: "Current Ledger Account", value: overrideTarget.ledgerAccount },
          ]}
          confirmLabel="Override"
          confirmDisabled={!requesterId || !approverId || overrideSelfBlocked || newLedgerAccount === overrideTarget.ledgerAccount}
          onConfirm={confirmOverride}
          onCancel={() => setOverrideTarget(null)}
          previewNotice="This updates a frontend mapping preview only. No journal entry or accounting-platform change occurs."
        >
          <div className="grid sm:grid-cols-3 gap-2 mb-3">
            <div>
              <label htmlFor="new-ledger-account" className="block text-[11px] text-gray-500 uppercase mb-1">New Ledger Account</label>
              <select id="new-ledger-account" value={newLedgerAccount} onChange={(e) => setNewLedgerAccount(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white">
                {LedgerAccounts.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="override-requester" className="block text-[11px] text-gray-500 uppercase mb-1">Requester</label>
              <select id="override-requester" value={requesterId} onChange={(e) => setRequesterId(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white">
                <option value="">Select…</option>
                {CRM_TEAM.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="override-approver" className="block text-[11px] text-gray-500 uppercase mb-1">Approver</label>
              <select id="override-approver" value={approverId} onChange={(e) => setApproverId(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white">
                <option value="">Select…</option>
                {CRM_TEAM.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
          </div>
          {overrideSelfBlocked && (
            <p className="text-xs text-red-400 mb-2">The requester cannot also be the approver — organization policy requires separation of duties.</p>
          )}
        </ActionPreviewModal>
      )}

      {approvingNote && (
        <ActionPreviewModal
          title="Approve Credit Note Preview"
          actionLabel={`Approve credit note of ${formatMoney(approvingNote.amountMinor, approvingNote.currency)}`}
          details={[{ label: "Reason", value: approvingNote.reason }]}
          confirmLabel="Approve"
          onConfirm={confirmCreditNoteApproval}
          onCancel={() => setApprovingNote(null)}
          previewNotice="This approves a frontend preview only. No credit note is created in QuickBooks Online or Xero."
        />
      )}

      {resolvingConflict && (
        <ActionPreviewModal
          title="Resolve Synchronization Conflict"
          actionLabel={resolvingConflict.conflictType}
          details={[
            { label: "Domain", value: resolvingConflict.domain },
            { label: "Provider", value: findProvider(resolvingConflict.providerKey)?.name || resolvingConflict.providerKey },
            { label: "Description", value: resolvingConflict.description },
          ]}
          confirmLabel="Resolve"
          confirmDisabled={!resolution}
          onConfirm={confirmResolve}
          onCancel={() => { setResolvingConflict(null); setResolution(""); }}
          previewNotice="Resolving updates preview state only. No provider is contacted and no external record changes."
        >
          <div className="mb-3">
            <label htmlFor="fsc-resolution-select" className="block text-[11px] text-gray-500 uppercase mb-1">Resolution</label>
            <select id="fsc-resolution-select" value={resolution} onChange={(e) => setResolution(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white">
              <option value="">Select a resolution…</option>
              {FinancialSyncConflictResolution.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
        </ActionPreviewModal>
      )}
    </div>
  );
}

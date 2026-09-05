import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link } from "react-router-dom";
import { Landmark, ShieldCheck } from "lucide-react";
import { fetchOrganizations, fetchBankAccounts, fetchBankTransactions, selectIntegrations } from "../../redux/admin/integrationsSlice";
import { isSystemOwner } from "./commerceFinanceConfig";
import { findProvider } from "../../Helpers/mockIntegrationsData";

function formatMoney(minor, currency) {
  if (minor == null) return "—";
  const sign = minor < 0 ? "-" : "";
  return `${sign}${(Math.abs(minor) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}
function formatDateTime(iso) {
  if (!iso) return "Never";
  return new Date(iso).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function BankingIntegrationList() {
  const dispatch = useDispatch();
  const role = useSelector((s) => s.auth.role);
  const { organizations, bankAccounts, bankTransactions, loading, error } = useSelector(selectIntegrations);
  const owner = isSystemOwner(role);

  const [selectedOrgId, setSelectedOrgId] = useState("");

  useEffect(() => { dispatch(fetchOrganizations()); }, [dispatch]);

  useEffect(() => {
    const filters = owner ? (selectedOrgId ? { organizationId: selectedOrgId } : {}) : {};
    dispatch(fetchBankAccounts(filters));
    dispatch(fetchBankTransactions({}));
  }, [dispatch, owner, selectedOrgId]);

  const orgLabel = useMemo(() => (owner ? null : organizations[0]?.name || "Your organization"), [owner, organizations]);
  const txByAccount = useMemo(() => {
    const map = {};
    bankTransactions.forEach((t) => { (map[t.accountId] ||= []).push(t); });
    return map;
  }, [bankTransactions]);

  return (
    <div className="p-4 md:p-6 space-y-5 text-white">
      <div className="text-xs text-gray-500 flex items-center gap-1">
        <span>Administration</span> <span>/</span>{" "}
        <Link to="/admin/integrations/commerce-finance" className="hover:text-gray-300">Commerce & Finance</Link>{" "}
        <span>/</span> <span className="text-gray-300">Banking</span>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold text-white">Banking Integrations</h1>
            <span className="px-2 py-0.5 rounded-full text-[11px] border bg-blue-500/15 text-blue-300 border-blue-500/30">Frontend Preview</span>
          </div>
          <p className="text-sm text-gray-400 mt-1 max-w-2xl flex items-start gap-1.5">
            <ShieldCheck size={14} className="text-emerald-400 mt-0.5 shrink-0" />
            Read-only preview via Wise Business and Plaid. Full account numbers are never shown, and no transfer is ever initiated from this
            page — bank authorization always uses each provider's own hosted, provider-managed flow.
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
        <div className="space-y-4">
          {bankAccounts.length === 0 ? (
            <p className="text-sm text-gray-500 bg-gray-900/40 border border-gray-800 rounded-xl p-4">No bank connection previews yet.</p>
          ) : bankAccounts.map((account) => (
            <section key={account.id} className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Landmark size={16} className="text-blue-400" />
                  <div>
                    <p className="text-sm font-medium text-white">{account.institution} — {account.accountName}</p>
                    <p className="text-xs text-gray-500">{account.accountType} · {account.maskedAccountNumber} · {account.currency}</p>
                  </div>
                </div>
                <div className="text-right text-xs text-gray-500">
                  <p>{findProvider(account.providerKey)?.name || account.providerKey}</p>
                  <p>Last synced {formatDateTime(account.lastPreviewSyncAt)}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-4 mt-3 text-xs">
                <span className="text-gray-400">Balance: <span className="text-gray-300">{account.balanceAvailability}</span></span>
                <span className="text-gray-400">Consent: <span className="text-emerald-400">{account.consentStatus}</span></span>
                <span className="text-gray-400">Health: <span className="text-emerald-400">{account.health?.status}</span></span>
                <span className="text-gray-400">Transactions: <span className="text-gray-300">{account.transactionCount}</span></span>
              </div>

              {(txByAccount[account.id] || []).length > 0 && (
                <div className="overflow-x-auto mt-3 border-t border-gray-800 pt-3">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-gray-500 text-[10px] uppercase">
                        <th className="pr-4 py-1">Date</th>
                        <th className="pr-4 py-1">Description</th>
                        <th className="pr-4 py-1">Amount</th>
                        <th className="pr-4 py-1">Category</th>
                        <th className="pr-4 py-1">Reconciliation</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(txByAccount[account.id] || []).map((t) => (
                        <tr key={t.id} className="border-t border-gray-800/60">
                          <td className="pr-4 py-2 text-xs text-gray-500">{formatDateTime(t.date)}</td>
                          <td className="pr-4 py-2 text-gray-300">{t.description}</td>
                          <td className={`pr-4 py-2 ${t.direction === "Credit" ? "text-emerald-400" : "text-red-400"}`}>{formatMoney(t.amountMinor, t.currency)}</td>
                          <td className="pr-4 py-2 text-xs text-gray-400">{t.providerCategory}</td>
                          <td className="pr-4 py-2 text-[11px] text-gray-300">{t.reconciliationStatus}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

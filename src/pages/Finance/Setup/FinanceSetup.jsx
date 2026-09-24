// Finance Setup — the one-time groundwork before anything can be posted:
// the chart of accounts, fiscal years and periods, finance controls, and
// the financial accounts payments are recorded against. Each section shows
// only what the signed-in member's role allows.
import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { CheckCircle2, Circle } from "lucide-react";
import * as api from "../../../Helpers/backendFinanceClient";
import { orgId } from "../../../Helpers/crmBackendCommon";
import { useFinanceAccess } from "../../../Helpers/financeAccess";
import { errorText } from "../../../Helpers/financeActions";
import FinanceRolesPanel from "./FinanceRolesPanel";
import { BackendOnly, NoAccess, Panel, PageHeader, StatusBadge, PromptDialog } from "../financeUi";
import { day, inputClass, buttonClass } from "../financeFormat";

const FA_TYPES = ["Bank", "Cash", "Clearing", "Card", "Other"];

function Step({ done, children }) {
  return (
    <li className="flex items-center gap-2 text-sm">
      {done ? <CheckCircle2 size={16} className="text-emerald-400" /> : <Circle size={16} className="text-gray-500" />}
      <span className={done ? "text-gray-300" : "text-white"}>{children}</span>
    </li>
  );
}

export default function FinanceSetup() {
  const access = useFinanceAccess();
  const { can } = access;
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [chartPreview, setChartPreview] = useState(null);
  const [yearStart, setYearStart] = useState(`${new Date().getFullYear()}-01`);
  const [controls, setControls] = useState(null);
  const [fa, setFa] = useState({ name: "", type: "Bank", currency: "USD", ledgerAccountId: "", lastDigits: "" });
  const [reopen, setReopen] = useState(null);

  const load = useCallback(async () => {
    const o = orgId();
    const safe = (p, fallback) => p.catch(() => fallback);
    const [settings, accounts, years, financial] = await Promise.all([
      safe(api.getFinanceSettings(o).then((r) => r.settings), null),
      safe(api.listAccounts(o).then((r) => r.accounts), []),
      safe(api.listFiscalYears(o).then((r) => r.fiscalYears), []),
      safe(api.listFinancialAccounts(o).then((r) => r.financialAccounts), []),
    ]);
    setState({ settings, accounts, years, financial });
    if (settings) setControls({ separationOfDuties: settings.separationOfDuties, journalApprovalRequired: settings.journalApprovalRequired, invoiceApprovalThreshold: settings.invoiceApprovalThreshold ?? 10000, expensePolicyLimit: settings.expensePolicyLimit ?? "", baseCurrency: settings.baseCurrency, version: settings.version });
  }, []);

  useEffect(() => {
    if (api.BACKEND_FINANCE_MODE_ENABLED) load();
  }, [load]);

  if (!api.BACKEND_FINANCE_MODE_ENABLED) return <BackendOnly what="Finance Setup" />;
  if (!access.loading && !can("finance_configuration", "view") && !can("fiscal_periods", "view") && !can("financial_accounts", "view")) return <NoAccess what="Finance Setup" />;
  if (!state) return <div className="p-6 text-gray-400">Loading…</div>;

  const run = async (fn, success) => {
    setBusy(true);
    try {
      await fn();
      if (success) toast.success(success);
      await load();
      return true;
    } catch (error) {
      toast.error(errorText(error));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const hasChart = state.accounts.length > 0;
  const hasYear = state.years.length > 0;
  const hasDefaults = !!(state.settings?.receivableAccountId && state.settings?.revenueAccountId);
  const hasFinancial = state.financial.length > 0;
  const assetAccounts = state.accounts.filter((a) => a.type === "Asset" && a.postingAllowed && !a.archivedAt);

  return (
    <div className="p-6 text-white max-w-6xl space-y-6">
      <PageHeader title="Finance Setup" subtitle="The groundwork before anything can be posted to the ledger. Finance records transactions — it never moves money." />

      <Panel title="Checklist">
        <ul className="space-y-2">
          <Step done={hasChart}>Chart of accounts created</Step>
          <Step done={hasDefaults}>Default accounts set (receivables, payables, revenue, tax)</Step>
          <Step done={hasYear}>A fiscal year with open periods</Step>
          <Step done={hasFinancial}>At least one financial account to record payments against</Step>
        </ul>
        <p className="text-xs text-gray-500 mt-3">Posting, approving payments and closing periods need the Finance Manager or Accountant role — give them under Finance roles below.</p>
      </Panel>

      <Panel
        title={`Chart of accounts (${state.accounts.length})`}
        subtitle="A starter chart adds only the account codes you don't have yet — running it again adds nothing twice."
        actions={can("finance_configuration", "configure") && (
          <button disabled={busy} className={buttonClass.primary} onClick={() => run(async () => setChartPreview((await api.initializeChart(orgId(), false)).preview))}>
            {hasChart ? "Add missing starter accounts" : "Create starter chart"}
          </button>
        )}
      >
        {state.accounts.length === 0 ? (
          <p className="text-sm text-gray-400">No accounts yet.</p>
        ) : (
          <div className="max-h-72 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="text-gray-400 text-left"><tr><th className="py-1 pr-3 font-medium">Code</th><th className="py-1 pr-3 font-medium">Name</th><th className="py-1 pr-3 font-medium">Type</th><th className="py-1 font-medium">Posting</th></tr></thead>
              <tbody>
                {state.accounts.map((a) => (
                  <tr key={a._id} className="border-t border-gray-800">
                    <td className="py-1 pr-3 font-mono">{a.code}</td>
                    <td className={`py-1 pr-3 ${a.parentId ? "pl-4" : "font-medium"}`}>{a.name}</td>
                    <td className="py-1 pr-3 text-gray-400">{a.type}{a.subtype ? ` · ${a.subtype}` : ""}</td>
                    <td className="py-1 text-gray-400">{a.postingAllowed ? "Yes" : "Header"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel
        title="Fiscal years and periods"
        subtitle="Monthly periods. Soft close and close are done by two different people; a closed period refuses postings until it is reopened with a reason."
        actions={can("fiscal_periods", "configure") && (
          <div className="flex items-center gap-2">
            <input type="month" value={yearStart} onChange={(e) => setYearStart(e.target.value)} className={`${inputClass} w-40`} />
            <button disabled={busy} className={buttonClass.primary} onClick={() => run(() => api.createFiscalYear(orgId(), { startDate: `${yearStart}-01` }), "Fiscal year created")}>Create 12-month year</button>
          </div>
        )}
      >
        {state.years.length === 0 ? (
          <p className="text-sm text-gray-400">No fiscal years yet.</p>
        ) : (
          state.years.map((y) => (
            <div key={y._id} className="mb-4 last:mb-0">
              <h3 className="text-sm font-semibold mb-2">{y.name} <span className="text-gray-400 font-normal">({day(y.startDate)} – {day(y.endDate)})</span></h3>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {y.periods.map((p) => (
                  <div key={p._id} className="flex items-center justify-between gap-2 border border-gray-800 rounded-lg px-3 py-2">
                    <div className="flex items-center gap-2"><span className="text-sm">{p.name}</span><StatusBadge status={p.status} /></div>
                    <div className="flex gap-1">
                      {["Open", "Reopened"].includes(p.status) && can("fiscal_periods", "close") && <button disabled={busy} className={buttonClass.ghost} onClick={() => run(() => api.softClosePeriod(orgId(), p._id), `${p.name} soft-closed`)}>Soft close</button>}
                      {p.status === "Soft Closed" && can("fiscal_periods", "close") && <button disabled={busy} className={buttonClass.ghost} onClick={() => run(() => api.closePeriod(orgId(), p._id), `${p.name} closed`)}>Close</button>}
                      {["Soft Closed", "Closed"].includes(p.status) && can("fiscal_periods", "reopen") && <button disabled={busy} className={buttonClass.ghost} onClick={() => setReopen({ period: p, reason: "" })}>Reopen</button>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </Panel>

      {controls && can("finance_configuration", "view") && (
        <Panel title="Controls" subtitle="Changes here are recorded in the audit log.">
          <div className="grid sm:grid-cols-2 gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={controls.journalApprovalRequired} disabled={!can("finance_configuration", "configure")} onChange={(e) => setControls({ ...controls, journalApprovalRequired: e.target.checked })} /> Manual journals need approval before posting</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={controls.separationOfDuties} disabled={!can("finance_configuration", "configure")} onChange={(e) => setControls({ ...controls, separationOfDuties: e.target.checked })} /> Separation of duties (recommended)</label>
            <div><span className="block text-gray-400 mb-1">Invoice approval threshold — at or above it the creator can't approve</span><input type="number" min="0" value={controls.invoiceApprovalThreshold} disabled={!can("finance_configuration", "configure")} onChange={(e) => setControls({ ...controls, invoiceApprovalThreshold: e.target.value })} className={inputClass} /></div>
            <div><span className="block text-gray-400 mb-1">Expense policy limit (blank = none)</span><input type="number" min="0" value={controls.expensePolicyLimit} disabled={!can("finance_configuration", "configure")} onChange={(e) => setControls({ ...controls, expensePolicyLimit: e.target.value })} className={inputClass} /></div>
            <div><span className="block text-gray-400 mb-1">Base currency (locked once journals are posted)</span><input value={controls.baseCurrency} maxLength={3} disabled={!can("finance_configuration", "configure")} onChange={(e) => setControls({ ...controls, baseCurrency: e.target.value.toUpperCase() })} className={inputClass} /></div>
          </div>
          {can("finance_configuration", "configure") && (
            <div className="mt-4">
              <button disabled={busy} className={buttonClass.primary} onClick={() => run(() => api.updateFinanceSettings(orgId(), {
                separationOfDuties: controls.separationOfDuties, journalApprovalRequired: controls.journalApprovalRequired, baseCurrency: controls.baseCurrency,
                invoiceApprovalThreshold: Number(controls.invoiceApprovalThreshold), expensePolicyLimit: controls.expensePolicyLimit === "" ? null : Number(controls.expensePolicyLimit),
                ...(state.settings?.persisted === false ? {} : { version: controls.version }),
              }), "Controls saved")}>Save controls</button>
            </div>
          )}
        </Panel>
      )}

      {can("financial_accounts", "view") && (
        <Panel title="Financial accounts" subtitle="Where payments are recorded (bank, cash, card). Only the last 4 digits are ever stored — no bank credentials, no full numbers.">
          {state.financial.length > 0 && (
            <table className="w-full text-sm mb-4">
              <thead className="text-gray-400 text-left"><tr><th className="py-1 pr-3 font-medium">Name</th><th className="py-1 pr-3 font-medium">Type</th><th className="py-1 pr-3 font-medium">Currency</th><th className="py-1 font-medium">Reference</th></tr></thead>
              <tbody>{state.financial.map((f) => <tr key={f._id} className="border-t border-gray-800"><td className="py-1 pr-3">{f.name}</td><td className="py-1 pr-3 text-gray-400">{f.type}</td><td className="py-1 pr-3 text-gray-400">{f.currency}</td><td className="py-1 text-gray-400">{f.maskedReference || "—"}</td></tr>)}</tbody>
            </table>
          )}
          {can("financial_accounts", "configure") && (
            assetAccounts.length === 0 ? <p className="text-sm text-gray-400">Create the chart of accounts first.</p> : (
              <form className="grid sm:grid-cols-6 gap-2 items-end" onSubmit={async (e) => {
                e.preventDefault();
                if (await run(() => api.createFinancialAccount(orgId(), { ...fa, lastDigits: fa.lastDigits || undefined }), "Financial account added")) setFa({ ...fa, name: "", lastDigits: "" });
              }}>
                <input required placeholder="Name, e.g. Operating Bank" value={fa.name} onChange={(e) => setFa({ ...fa, name: e.target.value })} className={`${inputClass} sm:col-span-2`} />
                <select value={fa.type} onChange={(e) => setFa({ ...fa, type: e.target.value })} className={inputClass}>{FA_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
                <input required maxLength={3} value={fa.currency} onChange={(e) => setFa({ ...fa, currency: e.target.value.toUpperCase() })} className={inputClass} />
                <select required value={fa.ledgerAccountId} onChange={(e) => setFa({ ...fa, ledgerAccountId: e.target.value })} className={inputClass}>
                  <option value="">Ledger account…</option>
                  {assetAccounts.map((a) => <option key={a._id} value={a._id}>{a.code} {a.name}</option>)}
                </select>
                <input placeholder="Last 4 digits" maxLength={4} value={fa.lastDigits} onChange={(e) => setFa({ ...fa, lastDigits: e.target.value.replace(/\D/g, "") })} className={inputClass} />
                <div className="sm:col-span-6"><button disabled={busy} className={buttonClass.primary}>Add financial account</button></div>
              </form>
            )
          )}
        </Panel>
      )}

      <FinanceRolesPanel />

      {chartPreview && (
        <PromptDialog
          title="Starter chart of accounts"
          description={`${chartPreview.filter((a) => a.willCreate).length} account(s) will be created; existing codes are left alone. Default accounts are set where none is chosen yet.`}
          confirmLabel="Create accounts"
          busy={busy}
          onCancel={() => setChartPreview(null)}
          onConfirm={async () => { if (await run(() => api.initializeChart(orgId(), true), "Chart of accounts created")) setChartPreview(null); }}
        >
          <div className="max-h-64 overflow-y-auto text-sm border border-gray-800 rounded-lg">
            {chartPreview.map((a) => (
              <div key={a.code} className={`flex justify-between px-3 py-1 border-b border-gray-800 last:border-0 ${a.willCreate ? "" : "text-gray-500"}`}>
                <span><span className="font-mono">{a.code}</span> {a.name}</span>
                <span className="text-xs">{a.willCreate ? a.type : "exists"}</span>
              </div>
            ))}
          </div>
        </PromptDialog>
      )}

      {reopen && (
        <PromptDialog
          title={`Reopen ${reopen.period.name}`}
          description="Reopening lets postings into the period again. The reason is recorded."
          confirmLabel="Reopen"
          busy={busy}
          onCancel={() => setReopen(null)}
          onConfirm={async () => {
            if (!reopen.reason.trim()) return toast.error("A reason is required.");
            if (await run(() => api.reopenPeriod(orgId(), reopen.period._id, reopen.reason), `${reopen.period.name} reopened`)) setReopen(null);
            return undefined;
          }}
        >
          <textarea value={reopen.reason} onChange={(e) => setReopen({ ...reopen, reason: e.target.value })} rows={3} placeholder="Reason" className={inputClass} />
        </PromptDialog>
      )}
    </div>
  );
}

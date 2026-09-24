// Finance reports. Statements come from POSTED journals only (base
// currency); document reports keep every currency separate. Each report
// shows its source and definition — none is audited or a compliance claim.
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import * as api from "../../../Helpers/backendFinanceClient";
import { orgId } from "../../../Helpers/crmBackendCommon";
import { useFinanceAccess } from "../../../Helpers/financeAccess";
import { errorText } from "../../../Helpers/financeActions";
import { BackendOnly, NoAccess, Panel, PageHeader } from "../financeUi";
import { inputClass, buttonClass } from "../financeFormat";

const REPORTS = [
  { id: "profit-and-loss", label: "Profit & Loss", params: "range", group: "Statements" },
  { id: "balance-sheet", label: "Balance Sheet", params: "asOf", group: "Statements" },
  { id: "cash-flow", label: "Cash Flow", params: "range", group: "Statements" },
  { id: "trial-balance", label: "Trial Balance", params: "asOf", group: "Statements" },
  { id: "general-ledger", label: "General Ledger", params: "range+account", group: "Statements" },
  { id: "journal-register", label: "Journal Register", params: "range", group: "Statements" },
  { id: "revenue-by-period", label: "Revenue by Period", params: "range", group: "Statements" },
  { id: "tax-summary", label: "Tax Summary (estimate)", params: "range", group: "Statements" },
  { id: "receivables-aging", label: "Receivables Aging", params: "asOf", group: "Documents" },
  { id: "payables-aging", label: "Payables Aging", params: "asOf", group: "Documents" },
  { id: "overdue-invoices", label: "Overdue Invoices", params: "asOf", group: "Documents" },
  { id: "invoice-status", label: "Invoice Status", params: "none", group: "Documents" },
  { id: "bill-status", label: "Bill Status", params: "none", group: "Documents" },
  { id: "recorded-payments", label: "Recorded Payments", params: "range", group: "Documents" },
  { id: "expenses", label: "Expenses Breakdown", params: "range", group: "Documents" },
  { id: "cash-balances", label: "Cash Account Balances", params: "none", group: "Documents" },
  { id: "currency-exposure", label: "Multi-currency Exposure", params: "none", group: "Documents" },
  { id: "reconciliation-differences", label: "Reconciliation Differences", params: "none", group: "Documents" },
  { id: "budget-vs-actual", label: "Budget vs Actual", params: "budget", group: "Planning" },
];

const today = () => new Date().toISOString().slice(0, 10);
const yearStart = () => `${new Date().getFullYear()}-01-01`;
const title = (key) => key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
const cell = (v) => {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) return new Date(v).toLocaleDateString();
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
};

function Table({ rows }) {
  if (!rows.length) return <p className="text-sm text-gray-400">No rows.</p>;
  const cols = Object.keys(rows[0]).filter((c) => !["accountId", "_id", "id"].includes(c));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-gray-400 text-left"><tr>{cols.map((c) => <th key={c} className="py-1.5 pr-4 font-medium whitespace-nowrap">{title(c)}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} className="border-t border-gray-800">{cols.map((c) => <td key={c} className={`py-1.5 pr-4 ${typeof r[c] === "number" ? "text-right tabular-nums" : ""}`}>{cell(r[c])}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

// Renders any report response: arrays as tables, flat objects as figures,
// objects of objects (per-currency buckets) as tables.
function ReportBody({ data }) {
  const entries = Object.entries(data).filter(([k]) => k !== "meta");
  const scalars = entries.filter(([, v]) => v === null || typeof v !== "object");
  return (
    <div className="space-y-5">
      {scalars.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {scalars.map(([k, v]) => <div key={k} className="border border-gray-800 rounded-lg px-4 py-2"><div className="text-xs text-gray-400">{title(k)}</div><div className="text-lg font-semibold">{cell(v)}</div></div>)}
        </div>
      )}
      {entries.filter(([, v]) => v && typeof v === "object").map(([k, v]) => {
        let body;
        if (Array.isArray(v)) body = <Table rows={v} />;
        else if (Object.values(v).every((x) => x === null || typeof x !== "object")) body = <div className="flex flex-wrap gap-3">{Object.entries(v).map(([kk, vv]) => <div key={kk} className="border border-gray-800 rounded-lg px-4 py-2"><div className="text-xs text-gray-400">{title(kk)}</div><div className="text-lg font-semibold">{cell(vv)}</div></div>)}</div>;
        else body = <Table rows={Object.entries(v).map(([kk, vv]) => ({ key: kk, ...vv }))} />;
        return <div key={k}><h3 className="text-sm font-semibold mb-2">{title(k)}</h3>{body}</div>;
      })}
    </div>
  );
}

export default function FinanceReports() {
  const access = useFinanceAccess();
  const [report, setReport] = useState(REPORTS[0].id);
  const [params, setParams] = useState({ from: yearStart(), to: today(), asOf: today(), accountId: "", budgetId: "" });
  const [accounts, setAccounts] = useState([]);
  const [budgets, setBudgets] = useState([]);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const def = REPORTS.find((r) => r.id === report);

  useEffect(() => {
    if (!api.BACKEND_FINANCE_MODE_ENABLED) return;
    api.listAccounts(orgId()).then((r) => setAccounts((r.accounts || []).filter((a) => a.postingAllowed))).catch(() => {});
    api.listBudgets(orgId()).then((r) => setBudgets(r.budgets || [])).catch(() => {});
  }, []);

  if (!api.BACKEND_FINANCE_MODE_ENABLED) return <BackendOnly what="Finance reports" />;
  if (!access.loading && !access.can("finance_reports", "view")) return <NoAccess what="Finance reports" />;

  const run = async () => {
    const q = {};
    if (def.params.startsWith("range")) Object.assign(q, { from: params.from, to: params.to });
    if (def.params === "asOf") q.asOf = params.asOf;
    if (def.params === "range+account") { if (!params.accountId) return toast.error("Choose an account."); q.accountId = params.accountId; }
    if (def.params === "budget") { if (!params.budgetId) return toast.error("Choose a budget."); q.budgetId = params.budgetId; }
    setBusy(true);
    try {
      setData(await api.financeReport(orgId(), report, q));
    } catch (error) {
      toast.error(errorText(error));
      setData(null);
    } finally {
      setBusy(false);
    }
    return undefined;
  };

  return (
    <div className="p-6 text-white max-w-6xl space-y-6">
      <PageHeader title="Finance Reports" subtitle="Statements use posted journals only. Document reports keep each currency separate. Operational reports — not audited." />
      <Panel>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm"><span className="block text-gray-400 mb-1">Report</span>
            <select value={report} onChange={(e) => { setReport(e.target.value); setData(null); }} className={`${inputClass} w-64`}>
              {["Statements", "Documents", "Planning"].map((g) => <optgroup key={g} label={g}>{REPORTS.filter((r) => r.group === g).map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</optgroup>)}
            </select>
          </label>
          {def.params.startsWith("range") && (
            <>
              <label className="text-sm"><span className="block text-gray-400 mb-1">From</span><input type="date" value={params.from} onChange={(e) => setParams({ ...params, from: e.target.value })} className={inputClass} /></label>
              <label className="text-sm"><span className="block text-gray-400 mb-1">To</span><input type="date" value={params.to} onChange={(e) => setParams({ ...params, to: e.target.value })} className={inputClass} /></label>
            </>
          )}
          {def.params === "asOf" && <label className="text-sm"><span className="block text-gray-400 mb-1">As of</span><input type="date" value={params.asOf} onChange={(e) => setParams({ ...params, asOf: e.target.value })} className={inputClass} /></label>}
          {def.params === "range+account" && (
            <label className="text-sm"><span className="block text-gray-400 mb-1">Account</span>
              <select value={params.accountId} onChange={(e) => setParams({ ...params, accountId: e.target.value })} className={`${inputClass} w-64`}>
                <option value="">Choose…</option>{accounts.map((a) => <option key={a._id} value={a._id}>{a.code} {a.name}</option>)}
              </select>
            </label>
          )}
          {def.params === "budget" && (
            <label className="text-sm"><span className="block text-gray-400 mb-1">Budget</span>
              <select value={params.budgetId} onChange={(e) => setParams({ ...params, budgetId: e.target.value })} className={`${inputClass} w-64`}>
                <option value="">Choose…</option>{budgets.map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}
              </select>
            </label>
          )}
          <button onClick={run} disabled={busy} className={buttonClass.primary}>{busy ? "Running…" : "Run report"}</button>
        </div>
      </Panel>

      {data && (
        <Panel title={data.meta?.report} subtitle={[data.meta?.definition, data.meta?.source && `Source: ${data.meta.source}.`, data.meta?.baseCurrency && `Base currency: ${data.meta.baseCurrency}.`, data.meta?.note].filter(Boolean).join(" ")}>
          <ReportBody data={data} />
          <p className="text-xs text-gray-500 mt-4">{data.meta?.disclaimer} Generated {new Date(data.meta?.generatedAt).toLocaleString()}.</p>
        </Panel>
      )}
    </div>
  );
}

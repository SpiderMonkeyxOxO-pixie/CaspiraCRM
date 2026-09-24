import { useState } from "react";
import * as ai from "../../../Helpers/backendAiClient";
import { AiPage, Panel, Badge, ErrorBox, Loading, Table, Modal } from "./aiUi";
import { useAiLoad, useAiAction, fmtDate, fmtCost, fmtInt, btn, btnPrimary, input } from "./aiKit";

// Backend-mode usage, estimated cost, budgets and price tables. Costs are
// estimates from price tables; the provider's invoice is authoritative.
export default function AiUsageBackend() {
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useAiLoad(async () => {
    const [summary, usage, budgets, prices, providers] = await Promise.all([
      ai.usageSummary(), ai.listUsage({ page, pageSize: 20 }),
      ai.listBudgets().catch(() => null), ai.listPriceTables().catch(() => null), ai.listProviders(),
    ]);
    return { summary, usage, budgets, prices, simulatorLabel: providers.simulatorLabel };
  }, [page]);
  const [dialog, setDialog] = useState(null);
  const [run, busy, actionError] = useAiAction();
  const s = data?.summary;

  return (
    <AiPage title="Usage & Budgets" description="Provider-reported usage with estimated cost. Your organization pays its AI provider directly; these figures are estimates, not an invoice." simulatorLabel={data?.simulatorLabel}>
      <ErrorBox error={error || actionError} onRetry={error ? reload : undefined} />
      {loading && !data ? <Loading /> : data && (
        <>
          <Panel title={`This month (${s.periodKey}) — ${s.scope === "Own" ? "your usage" : "organization"}`}>
            <p className="text-xs text-gray-500 mb-2">{s.costLabel}{s.requestsWithUnknownCost ? ` · ${s.requestsWithUnknownCost} request(s) with unknown cost` : ""}{s.providerStorageEnabled ? " · provider-side storage is ON" : " · provider-side storage is off"}</p>
            <div className="grid lg:grid-cols-2 gap-4">
              <Table rows={s.byProvider} rowKey={(r) => `${r.providerKey}:${r.modelId}:${r.mode}`} empty="No AI usage this month." columns={[
                { label: "Provider / model", render: (r) => <span>{r.providerKey} <code className="text-[11px] text-gray-500">{r.modelId}</code>{r.simulatorLabel && <Badge tone="violet">Simulator</Badge>}</span> },
                { label: "Requests", render: (r) => fmtInt(r.requests) },
                { label: "Tokens in / out", render: (r) => `${fmtInt(r.inputTokens)} / ${fmtInt(r.outputTokens)}` },
                { label: "Estimated cost", render: (r) => fmtCost(r.estimatedCost) },
              ]} />
              <Table rows={s.byUseCase} rowKey={(r) => r.useCaseKey} empty="—" columns={[
                { label: "Feature", key: "label" },
                { label: "Requests", render: (r) => fmtInt(r.requests) },
                { label: "Estimated cost", render: (r) => fmtCost(r.estimatedCost) },
              ]} />
            </div>
          </Panel>

          {data.budgets && (
            <Panel title="Budgets" actions={<button type="button" className={btnPrimary} onClick={() => setDialog({ kind: "budget" })}>Add budget</button>}>
              <Table rows={data.budgets.budgets} empty="No budgets. Without one, AI usage isn't capped." columns={[
                { label: "Scope", render: (b) => `${b.scope}${b.scopeRef ? `: ${b.scopeRef}` : ""}` },
                { label: "Period", key: "period" },
                { label: "Soft / hard limit", render: (b) => `${b.softLimit} / ${b.hardLimit} ${b.currency}` },
                { label: "This period", render: (b) => (b.status ? <span className={b.status.exhausted ? "text-red-300" : b.status.warning ? "text-amber-300" : ""}>{fmtCost(b.status.spent, b.currency)} spent, {fmtCost(b.status.held, b.currency)} held</span> : "—") },
                { label: "Status", render: (b) => <Badge tone={b.active ? (b.status?.exhausted ? "red" : "green") : "gray"}>{b.active ? (b.status?.exhausted ? "Hard stop" : "Active") : "Off"}</Badge> },
                { label: "", render: (b) => <span className="flex gap-2"><button type="button" className={btn} onClick={() => setDialog({ kind: "budget", budget: b })}>Edit</button><button type="button" className={btn} disabled={busy} onClick={() => run(() => ai.updateBudget(b._id, { active: !b.active, version: b.version }), reload)}>{b.active ? "Turn off" : "Turn on"}</button></span> },
              ]} />
            </Panel>
          )}

          <Panel title="Usage lines">
            <Table rows={data.usage.usage} empty="No usage recorded." columns={[
              { label: "When", render: (u) => fmtDate(u.createdAt) },
              { label: "Feature", key: "useCaseKey" },
              { label: "Provider / model", render: (u) => `${u.providerKey} ${u.modelId || ""}` },
              { label: "Tokens in / out", render: (u) => `${fmtInt(u.inputTokens)} / ${fmtInt(u.outputTokens)}` },
              { label: "Outcome", render: (u) => <Badge>{u.outcome}</Badge> },
              { label: "Cost", render: (u) => (u.costKnown ? fmtCost(u.estimatedCost, u.currency) : "Cost unknown") },
            ]} />
            <div className="flex items-center gap-2 mt-2 text-sm text-gray-400">
              <button type="button" className={btn} disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
              <span>Page {page} of {Math.max(1, Math.ceil(data.usage.total / 20))}</span>
              <button type="button" className={btn} disabled={page * 20 >= data.usage.total} onClick={() => setPage(page + 1)}>Next</button>
            </div>
          </Panel>

          {data.prices && (
            <Panel title="Price tables (estimates)">
              <p className="text-xs text-gray-500 mb-2">{data.prices.note}</p>
              {data.prices.priceTables.map((t) => (
                <div key={t._id} className="mb-3">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <p className="text-sm text-gray-200">{t.providerKey} · v{t.version} {t.organizationSpecific ? <Badge tone="blue">Your prices</Badge> : <Badge tone="gray">Platform estimate</Badge>}</p>
                    {data.budgets && <button type="button" className={btn} onClick={() => setDialog({ kind: "prices", table: t })}>Set your prices</button>}
                  </div>
                  <p className="text-[11px] text-gray-500 mb-1">{t.sourceNote} · per million tokens, {t.currency}</p>
                  <Table rows={t.entries} rowKey={(e) => e.modelId} columns={[{ label: "Model", key: "modelId" }, { label: "Input", key: "inputPrice" }, { label: "Cached input", render: (e) => e.cachedInputPrice ?? "—" }, { label: "Output", key: "outputPrice" }]} />
                </div>
              ))}
            </Panel>
          )}
        </>
      )}
      {dialog?.kind === "budget" && <BudgetDialog budget={dialog.budget} onClose={() => setDialog(null)} onDone={() => { setDialog(null); reload(); }} />}
      {dialog?.kind === "prices" && <PricesDialog table={dialog.table} onClose={() => setDialog(null)} onDone={() => { setDialog(null); reload(); }} />}
    </AiPage>
  );
}

function BudgetDialog({ budget, onClose, onDone }) {
  const [f, setF] = useState({ scope: budget?.scope || "Organization", scopeRef: budget?.scopeRef || "", period: budget?.period || "Monthly", softLimit: budget?.softLimit ?? 40, hardLimit: budget?.hardLimit ?? 50, currency: budget?.currency || "USD" });
  const [run, busy, error] = useAiAction();
  const save = () => run(() => (budget ? ai.updateBudget(budget._id, { softLimit: Number(f.softLimit), hardLimit: Number(f.hardLimit), version: budget.version }) : ai.createBudget({ ...f, softLimit: Number(f.softLimit), hardLimit: Number(f.hardLimit) })), onDone);
  return (
    <Modal title={budget ? "Edit budget" : "Add budget"} onClose={onClose} footer={<><button type="button" className={btn} onClick={onClose}>Cancel</button><button type="button" className={btnPrimary} disabled={busy} onClick={save}>Save</button></>}>
      {!budget && (
        <div className="grid grid-cols-2 gap-2">
          <div><label htmlFor="b-scope" className="text-xs text-gray-400">Scope</label><select id="b-scope" className={input} value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value })}>{["Organization", "Use Case", "User", "Provider"].map((x) => <option key={x}>{x}</option>)}</select></div>
          <div><label htmlFor="b-ref" className="text-xs text-gray-400">{f.scope === "Use Case" ? "Feature key" : f.scope === "User" ? "Membership ID" : f.scope === "Provider" ? "Provider key" : "—"}</label><input id="b-ref" className={input} disabled={f.scope === "Organization"} value={f.scopeRef} onChange={(e) => setF({ ...f, scopeRef: e.target.value })} placeholder={f.scope === "Use Case" ? "overview.explore" : f.scope === "Provider" ? "openai" : ""} /></div>
          <div><label htmlFor="b-period" className="text-xs text-gray-400">Period</label><select id="b-period" className={input} value={f.period} onChange={(e) => setF({ ...f, period: e.target.value })}><option>Monthly</option><option>Daily</option></select></div>
          <div><label htmlFor="b-cur" className="text-xs text-gray-400">Currency</label><input id="b-cur" className={input} value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })} /></div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <div><label htmlFor="b-soft" className="text-xs text-gray-400">Warning at (soft limit)</label><input id="b-soft" type="number" min={0} step="any" className={input} value={f.softLimit} onChange={(e) => setF({ ...f, softLimit: e.target.value })} /></div>
        <div><label htmlFor="b-hard" className="text-xs text-gray-400">Stop at (hard limit)</label><input id="b-hard" type="number" min={0} step="any" className={input} value={f.hardLimit} onChange={(e) => setF({ ...f, hardLimit: e.target.value })} /></div>
      </div>
      <p className="text-xs text-gray-500">At the hard limit, AI requests in this scope are refused before anything is sent. Limits apply to estimated cost.</p>
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
    </Modal>
  );
}

function PricesDialog({ table, onClose, onDone }) {
  const [rows, setRows] = useState(table.entries.map((e) => ({ ...e })));
  const [note, setNote] = useState("");
  const [run, busy, error] = useAiAction();
  const set = (i, k, v) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <Modal title={`Your ${table.providerKey} prices`} onClose={onClose} footer={<><button type="button" className={btn} onClick={onClose}>Cancel</button><button type="button" className={btnPrimary} disabled={busy || !note.trim()} onClick={() => run(() => ai.putPriceTable(table.providerKey, { currency: table.currency, sourceNote: note, entries: rows }), onDone)}>Save new version</button></>}>
      <p className="text-xs text-gray-400">Per million tokens, {table.currency}. Saving creates a new version; earlier estimates keep the version they used.</p>
      {rows.map((r, i) => (
        <div key={r.modelId} className="grid grid-cols-4 gap-2 items-end">
          <span className="text-xs text-gray-300 col-span-1 truncate" title={r.modelId}>{r.modelId}</span>
          <input aria-label={`${r.modelId} input price`} type="number" min={0} step="any" className={input} value={r.inputPrice} onChange={(e) => set(i, "inputPrice", e.target.value)} />
          <input aria-label={`${r.modelId} cached input price`} type="number" min={0} step="any" className={input} value={r.cachedInputPrice ?? ""} onChange={(e) => set(i, "cachedInputPrice", e.target.value === "" ? null : e.target.value)} />
          <input aria-label={`${r.modelId} output price`} type="number" min={0} step="any" className={input} value={r.outputPrice} onChange={(e) => set(i, "outputPrice", e.target.value)} />
        </div>
      ))}
      <label htmlFor="p-note" className="text-xs text-gray-400">Where these prices come from (required)</label>
      <input id="p-note" className={input} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Provider pricing page, checked 2026-09-25" />
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
    </Modal>
  );
}

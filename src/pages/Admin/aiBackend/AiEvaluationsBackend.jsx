import { useState } from "react";
import * as ai from "../../../Helpers/backendAiClient";
import { AiPage, Panel, Badge, ErrorBox, Loading, Table } from "./aiUi";
import { useAiLoad, useAiAction, fmtDate, fmtCost, btn, btnPrimary, input } from "./aiKit";

// Backend-mode evaluations: run scenarios through the real gateway and see
// which expectations held. Runs use the AI budget; nothing retrains a model.
export default function AiEvaluationsBackend() {
  const { data, error, loading, reload } = useAiLoad(async () => {
    const [s, r, p] = await Promise.all([ai.listScenarios(), ai.listRuns(), ai.listProviders()]);
    return { scenarios: s.scenarios, runs: r.runs, providers: p.providers.filter((x) => x.availability === "Adapter" && x.configured), simulatorLabel: p.simulatorLabel };
  });
  const [selected, setSelected] = useState([]);
  const [providerKey, setProviderKey] = useState("");
  const [openRun, setOpenRun] = useState(null);
  const [run, busy, actionError] = useAiAction();

  const start = () => run(() => ai.startRun({ scenarioIds: selected, providerKey: providerKey || undefined }), (out) => { setSelected([]); reload(); watch(out.run._id); });
  const watch = async (id) => {
    for (let i = 0; i < 60; i += 1) {
      const r = await ai.getRun(id).catch(() => null);
      if (r) setOpenRun(r);
      if (!r || ["Completed", "Failed", "Cancelled"].includes(r.run.status)) break;
      await new Promise((res) => { setTimeout(res, 1500); });
    }
    reload();
  };

  return (
    <AiPage title="Evaluations" description="Check how a provider behaves on known scenarios before relying on it. Runs go through the same policy, redaction and budgets as normal requests." simulatorLabel={data?.simulatorLabel}>
      <ErrorBox error={error || actionError} onRetry={error ? reload : undefined} />
      {loading && !data ? <Loading /> : data && (
        <>
          <Panel title="Scenarios" actions={
            <span className="flex items-center gap-2">
              <label htmlFor="ev-provider" className="sr-only">Provider</label>
              <select id="ev-provider" className={input} value={providerKey} onChange={(e) => setProviderKey(e.target.value)}>
                <option value="">Use routing</option>{data.providers.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
              </select>
              <button type="button" className={btnPrimary} disabled={busy || !selected.length} onClick={start}>Run {selected.length || ""}</button>
            </span>
          }>
            <Table rows={data.scenarios} columns={[
              { label: "", render: (s) => <input type="checkbox" aria-label={`Select ${s.name}`} checked={selected.includes(s._id)} onChange={(e) => setSelected(e.target.checked ? [...selected, s._id] : selected.filter((x) => x !== s._id))} /> },
              { label: "Scenario", render: (s) => <span className="text-gray-200">{s.name}{s.platform && <span className="text-[11px] text-gray-500"> · platform</span>}</span> },
              { label: "Feature", key: "useCaseKey" },
              { label: "Expects", render: (s) => Object.keys(s.expectations || {}).join(", ") },
              { label: "Last result", render: (s) => (s.lastResult ? <Badge>{s.lastResult.outcome}</Badge> : "—") },
            ]} />
          </Panel>
          {openRun && (
            <Panel title={`Run ${fmtDate(openRun.run.createdAt)}`} actions={<Badge>{openRun.run.status}</Badge>}>
              {openRun.run.simulatorLabel && <p className="text-xs text-violet-300 mb-2">{openRun.run.simulatorLabel}</p>}
              <p className="text-sm text-gray-300 mb-2">{openRun.run.passed} passed · {openRun.run.failed} failed · {openRun.run.errored} errors · {fmtCost(openRun.run.estimatedCost)}</p>
              <Table rows={openRun.results} columns={[
                { label: "Scenario", render: (r) => data.scenarios.find((s) => s._id === r.scenarioId)?.name || r.scenarioId },
                { label: "Outcome", render: (r) => <Badge>{r.outcome}</Badge> },
                { label: "Why", render: (r) => (r.reasons?.length ? r.reasons.join(" · ") : "All expectations held.") },
              ]} />
            </Panel>
          )}
          <Panel title="Recent runs">
            <Table rows={data.runs} empty="No runs yet." columns={[
              { label: "When", render: (r) => fmtDate(r.createdAt) },
              { label: "Provider", render: (r) => `${r.providerKey} (${r.mode})` },
              { label: "Result", render: (r) => `${r.passed} pass · ${r.failed} fail · ${r.errored} error` },
              { label: "Status", render: (r) => <Badge>{r.status}</Badge> },
              { label: "", render: (r) => <button type="button" className={btn} onClick={() => ai.getRun(r._id).then(setOpenRun)}>Details</button> },
            ]} />
          </Panel>
        </>
      )}
    </AiPage>
  );
}

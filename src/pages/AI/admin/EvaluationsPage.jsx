// /ai/evaluations — application-owned, provider-neutral evaluation: suites,
// datasets, runs with gates (every figure shows its suite version and
// sample size), human reviews and side-by-side comparisons.
import { useState } from "react";
import * as ai from "../../../Helpers/backendAiClient";
import { Badge, Panel, Table, ErrorBox, Loading, Modal } from "../../Admin/aiBackend/aiUi";
import { btn, btnPrimary, fmtDate, fmtCost, useAiLoad } from "../../Admin/aiBackend/aiKit";
import { AdminPage, Tabs, ReasonDialog, StatusNote } from "./AdminShell";

const RUN_TONE = { Passed: "green", "Passed with warnings": "amber", Failed: "red", Invalid: "red", Cancelled: "gray", Running: "blue", Queued: "blue", "Awaiting human review": "violet" };
const pct = (v) => (v === null || v === undefined ? "—" : `${Math.round(v * 1000) / 10}%`);

export default function EvaluationsPage() {
  const [tab, setTab] = useState("runs");
  return (
    <AdminPage title="AI Evaluations" requires={[["ai_gov_evaluations", "read"]]}
      description="Release gates come from the CRM's own evaluation system: deterministic, schema, authorization, evidence and citation graders decide; human reviewers resolve open cases; an LLM grader only scores quality and never decides authorization.">
      {(access) => (
        <div className="space-y-4">
          <Tabs label="Evaluation sections" value={tab} onChange={setTab} tabs={[["runs", "Runs"], ["comparisons", "Comparisons"], ["suites", "Suites & graders"], ["datasets", "Datasets"]]} />
          {tab === "runs" && <Runs access={access} />}
          {tab === "comparisons" && <Comparisons access={access} />}
          {tab === "suites" && <Suites />}
          {tab === "datasets" && <Datasets />}
        </div>
      )}
    </AdminPage>
  );
}

function Runs({ access }) {
  const { data, error, loading, reload } = useAiLoad(() => ai.listEvalRuns(), []);
  const suites = useAiLoad(() => ai.listEvalSuites(), []);
  const [dialog, setDialog] = useState(false);
  const [open, setOpen] = useState(null);
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const suiteName = (id) => suites.data?.suites.find((s) => s.id === id);
  return (
    <div className="space-y-3">
      <div className="flex gap-2">{access.can("ai_gov_evaluations", "manage") && <button type="button" className={btnPrimary} onClick={() => setDialog(true)}>Start a run</button>}<button type="button" className={btn} onClick={reload}>Refresh</button></div>
      <Table rows={data.runs} empty="No evaluation runs yet." columns={[
        { label: "Run", render: (r) => <button type="button" className="text-blue-300 underline" onClick={() => setOpen(r._id)}>{r._id}</button> },
        { label: "Suite", render: (r) => { const s = suiteName(r.suiteId); return s ? `${s.key} v${s.version}` : "—"; } },
        { label: "Candidate", render: (r) => `${r.candidate?.providerKey}${r.candidate?.modelId ? `:${r.candidate.modelId}` : ""}` }, { label: "Status", render: (r) => <Badge tone={RUN_TONE[r.status]}>{r.status}</Badge> },
        { label: "Result", render: (r) => `${r.passed}/${r.sampleSize} passed${r.zeroToleranceFailures ? ` · ${r.zeroToleranceFailures} zero-tolerance` : ""}` }, { label: "Cost", render: (r) => fmtCost(r.estimatedCost) }, { label: "Trigger", render: (r) => r.trigger }, { label: "Created", render: (r) => fmtDate(r.createdAt) },
      ]} />
      <StatusNote>An incomplete run (cancelled or with errored cases) is never marked as passed. Costs are estimates, not provider invoices.</StatusNote>
      {dialog && (
        <ReasonDialog title="Start an evaluation run" confirmLabel="Queue run" requireReason={false}
          fields={[{ name: "suiteKey", label: "Suite", type: "select", options: [...new Set((suites.data?.suites || []).map((s) => s.key))] }, { name: "providerKey", label: "Candidate provider", defaultValue: "simulator" }, { name: "modelId", label: "Candidate model (pinned id, optional)" }, { name: "promptVersions", label: "Candidate prompt versions (JSON, optional) e.g. {\"copilot.answer\": 2}" }]}
          onSubmit={(v) => ai.startEvalRun({ suiteKey: v.suiteKey || suites.data?.suites[0]?.key, candidate: { providerKey: v.providerKey || "simulator", modelId: v.modelId || null, promptVersions: v.promptVersions ? JSON.parse(v.promptVersions) : {} } }).then(reload)} onClose={() => setDialog(false)} />
      )}
      {open && <RunDetail id={open} access={access} onClose={() => { setOpen(null); reload(); }} />}
    </div>
  );
}

function RunDetail({ id, access, onClose }) {
  const { data, error, loading, reload } = useAiLoad(() => ai.getEvalRun(id), [id]);
  const [review, setReview] = useState(null);
  const r = data?.run;
  return (
    <Modal title={`Evaluation run ${id}`} onClose={onClose}>
      {loading && <Loading />}
      <ErrorBox error={error} />
      {r && (
        <div className="space-y-3 text-sm">
          <p><Badge tone={RUN_TONE[r.status]}>{r.status}</Badge> <span className="text-gray-400">{data.suite.name} (v{data.suite.version}) · {r.completedCases}/{r.sampleSize} cases · {fmtCost(r.estimatedCost)}</span></p>
          {["Queued", "Running"].includes(r.status) && access.can("ai_gov_evaluations", "manage") && <button type="button" className={btn} onClick={() => ai.cancelEvalRun(id).then(reload)}>Cancel run</button>}
          <h3 className="font-semibold">Gates</h3>
          <ul className="space-y-1 text-xs">
            {(r.gateResults || []).map((g) => (
              <li key={g.key}><Badge tone={g.status === "Passed" ? "green" : g.status === "Warning" ? "amber" : "red"}>{g.status}</Badge> <b>{g.key}</b>{g.metric && <> — {g.metric} {typeof g.value === "number" ? (g.metric.includes("ms") || g.metric.includes("usd") ? Math.round(g.value * 1e4) / 1e4 : pct(g.value)) : "—"} ({g.comparator} {g.threshold})</>} · n={g.sampleSize} · {(g.datasetVersions || []).join(", ")}{g.failures?.length ? ` · failed: ${g.failures.join(", ")}` : ""}</li>
            ))}
          </ul>
          <h3 className="font-semibold">Cases</h3>
          <Table rows={data.results} columns={[
            { label: "Case", render: (x) => <span className="text-xs">{x.caseKey}{x.zeroTolerance.length > 0 && <Badge tone="red">zero tolerance</Badge>}</span> },
            { label: "Outcome", render: (x) => <Badge tone={x.outcome === "Pass" ? "green" : x.outcome === "Needs review" ? "violet" : "red"}>{x.outcome}</Badge> },
            { label: "Graders", render: (x) => <span className="text-[11px] text-gray-400">{x.graderVerdicts.filter((v) => v.verdict !== "Skipped").map((v) => `${v.grader}: ${v.verdict}${v.reasons?.length && v.verdict !== "Pass" ? ` (${v.reasons.join("; ").slice(0, 120)})` : ""}`).join(" · ")}{x.disagreement && <span className="text-amber-300"> · graders disagree</span>}</span> },
            { label: "", render: (x) => x.outcome === "Needs review" && access.can("ai_gov_evaluations", "review") && <button type="button" className={btn} onClick={() => setReview(x)}>Review</button> },
          ]} />
        </div>
      )}
      {review && <ReasonDialog title={`Review ${review.caseKey}`} description={review.safeExcerpt} confirmLabel="Record" fields={[{ name: "decision", label: "Decision", type: "select", options: ["Pass", "Fail"] }]} onSubmit={(v) => ai.reviewEvalResult(id, review._id, v.decision || "Pass", v.reason).then(reload)} onClose={() => setReview(null)} />}
    </Modal>
  );
}

function Comparisons({ access }) {
  const { data, error, loading, reload } = useAiLoad(() => ai.listEvalComparisons(), []);
  const [dialog, setDialog] = useState(false);
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  return (
    <div className="space-y-3">
      {access.can("ai_gov_evaluations", "manage") && <button type="button" className={btn} onClick={() => setDialog(true)}>Compare two runs</button>}
      {data.comparisons.map((c) => (
        <Panel key={c.id} title={c.name}>
          <p className="text-xs text-gray-400 mb-2">{c.summary.note}</p>
          <Table rowKey={(r) => r.metric} rows={c.summary.rows} columns={[{ label: "Metric", render: (r) => r.metric }, { label: "Baseline", render: (r) => r.baseline ?? "—" }, { label: "Candidate", render: (r) => r.candidate ?? "—" }, { label: "Δ", render: (r) => (r.delta === null ? "—" : Math.round(r.delta * 1e4) / 1e4) }]} />
          <StatusNote>Baseline {c.summary.baseline.run} (n={c.summary.baseline.sampleSize}) vs candidate {c.summary.candidate.run} (n={c.summary.candidate.sampleSize}); zero-tolerance {c.summary.safety.baselineZeroTolerance} → {c.summary.safety.candidateZeroTolerance}.</StatusNote>
        </Panel>
      ))}
      {!data.comparisons.length && <p className="text-sm text-gray-500">No comparisons yet.</p>}
      {dialog && <ReasonDialog title="Compare runs of the same suite" confirmLabel="Compare" requireReason={false} fields={[{ name: "baselineRunId", label: "Baseline run id" }, { name: "candidateRunId", label: "Candidate run id" }, { name: "dimension", label: "Dimension", type: "select", options: ["provider", "model", "prompt", "tool", "workflow", "retrieval"] }]} onSubmit={(v) => ai.createEvalComparison({ ...v, dimension: v.dimension || "model" }).then(reload)} onClose={() => setDialog(false)} />}
    </div>
  );
}

function Suites() {
  const { data, error, loading } = useAiLoad(() => ai.listEvalSuites(), []);
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  return (
    <div className="space-y-4">
      <Table rows={data.suites} columns={[{ label: "Suite", render: (s) => `${s.name} (${s.key} v${s.version})` }, { label: "Datasets", render: (s) => (s.datasetVersionIds || []).length }, { label: "Graders", render: (s) => (s.graderKeys || []).join(", ") }, { label: "Quality gates", render: (s) => <span className="text-xs text-gray-400">{(s.qualityGates || []).map((g) => `${g.metric} ${g.comparator} ${g.threshold}${g.level === "warn" ? " (warn)" : ""}`).join(" · ") || "—"}</span> }]} />
      <Table rows={data.graders} columns={[{ label: "Grader", render: (g) => g.name }, { label: "Kind", render: (g) => g.kind }, { label: "Decides gates", render: (g) => (g.authoritative ? "Yes" : "No — quality only") }, { label: "Calibration", render: (g) => g.calibration?.status || (g.kind === "llm" ? "Uncalibrated" : "Not needed") }, { label: "Rubric", render: (g) => <span className="text-xs text-gray-400">{g.rubric}</span> }]} />
    </div>
  );
}

function Datasets() {
  const { data, error, loading } = useAiLoad(() => ai.listEvalDatasets(), []);
  const [view, setView] = useState(null);
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  return (
    <>
      <Table rows={data.datasets} columns={[
        { label: "Dataset", render: (d) => d.name }, { label: "Type", render: (d) => d.type }, { label: "Source", render: (d) => <Badge tone={d.source === "Production" ? "amber" : "gray"}>{d.source}</Badge> },
        { label: "Versions", render: (d) => <span className="flex flex-wrap gap-1">{d.versions.map((v) => <button key={v._id} type="button" className="text-xs text-blue-300 underline" onClick={() => setView(v._id)}>v{v.version} ({v.caseCount})</button>)}</span> },
      ]} />
      <StatusNote>Production-derived cases need an authorization by someone else, a purpose, a retention period and redaction; conversations are never copied into datasets automatically.</StatusNote>
      {view && <DatasetView versionId={view} onClose={() => setView(null)} />}
    </>
  );
}

function DatasetView({ versionId, onClose }) {
  const { data, error, loading } = useAiLoad(() => ai.getEvalDatasetVersion(versionId), [versionId]);
  return (
    <Modal title="Dataset version" onClose={onClose}>
      {loading && <Loading />}
      <ErrorBox error={error} />
      {data && <ul className="space-y-2 text-xs">{data.cases.map((c) => <li key={c.id} className="border border-gray-800 rounded p-2"><b>{c.key}</b> <span className="text-gray-500">{c.type} · {c.input.kind}{c.zeroTolerance.length ? ` · zero tolerance: ${c.zeroTolerance.join(", ")}` : ""}</span><pre className="whitespace-pre-wrap text-gray-400 mt-1">{JSON.stringify(c.input, null, 1).slice(0, 400)}</pre></li>)}</ul>}
    </Modal>
  );
}

// One Copilot message (backend mode). Everything shown here comes from the
// server's validated message: statements with record citations, limitations,
// confidence and freshness. Proposals, clarifications and data-access
// confirmations are rendered as explicit choices — nothing runs on its own.
import { Fragment, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ThumbsUp, ThumbsDown, RefreshCw, Square, ShieldAlert, Info, Brain, ExternalLink, HelpCircle, Lock } from "lucide-react";
import * as ai from "../../../Helpers/backendAiClient";
import { Badge } from "../../Admin/aiBackend/aiUi";
import { btn, btnPrimary, fmtDate } from "../../Admin/aiBackend/aiKit";
import { RUNNING } from "./copilotKit";

const STATUS_LABEL = { Queued: "Queued", Classifying: "Understanding the request", Retrieving: "Reading authorized records", Generating: "Preparing the answer", Validating: "Checking sources" };
const CONFIDENCE_TONE = { "High Confidence": "green", "Medium Confidence": "amber", "Low Confidence": "red", "Insufficient Data": "gray" };
const MESSAGE_TONE = { Completed: "green", "Completed with limitations": "amber", Refused: "amber", Failed: "red", Cancelled: "gray", "Awaiting tool": "blue" };

export default function CopilotMessage({ message, progress, readOnly, onCite, onStop, onRegenerate, onChanged, onError }) {
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] bg-blue-600/20 border border-blue-500/30 rounded-2xl rounded-br-sm px-4 py-2 text-sm text-gray-100 whitespace-pre-wrap">{message.content}</div>
      </div>
    );
  }
  const running = RUNNING.includes(message.status);
  const act = async (fn) => {
    setBusy(true);
    try { await fn(); await onChanged?.(); } catch (e) { onError?.(ai.aiErrorMessage(e)); } finally { setBusy(false); }
  };
  const findings = message.parts.filter((p) => p.kind === "finding");
  const other = message.parts.filter((p) => !["finding", "limitation"].includes(p.kind));
  const citationByKey = Object.fromEntries((message.citations || []).map((c) => [c.key, c]));

  return (
    <article aria-label="Copilot answer" className="bg-gray-900/50 border border-gray-800 rounded-2xl rounded-bl-sm px-4 py-3 space-y-3">
      <header className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold text-violet-300">AI Copilot</span>
        {running ? <span role="status" className="text-blue-300 animate-pulse">{progress || STATUS_LABEL[message.status]}…</span> : <Badge tone={MESSAGE_TONE[message.status]}>{message.status}</Badge>}
        {message.confidence && <Badge tone={CONFIDENCE_TONE[message.confidence]}>{message.confidence}</Badge>}
        {message.simulatorLabel && <Badge tone="violet">Simulator</Badge>}
        {message.completedAt && <span className="text-gray-500">{fmtDate(message.completedAt)}</span>}
      </header>

      {message.content && <p className="text-sm text-gray-100 whitespace-pre-wrap">{message.content}</p>}
      {message.status === "Failed" && <p role="alert" className="text-sm text-red-300">{message.safeError || "The Copilot couldn't finish this answer."}</p>}
      {message.status === "Cancelled" && <p className="text-sm text-gray-400">Stopped. Nothing was changed.</p>}

      {findings.length > 0 && (
        <ul className="space-y-1.5">
          {findings.map((f, i) => (
            <li key={i} className="text-sm text-gray-200 flex gap-2">
              <span className="text-gray-500" aria-hidden="true">•</span>
              <span>
                {f.data.text}{" "}
                {(f.data.citations || []).map((k) => (
                  <button key={k} type="button" onClick={() => onCite(citationByKey[k] || { key: k, status: "Removed" })}
                    className="inline-flex items-center text-[11px] px-1.5 py-0.5 ml-0.5 rounded bg-blue-500/15 text-blue-300 border border-blue-500/30 hover:bg-blue-500/25"
                    aria-label={`Source ${k}: ${citationByKey[k]?.label || "unavailable"}`}>
                    {k}
                  </button>
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}

      {other.map((p, i) => <Part key={i} part={p} busy={busy} readOnly={readOnly} act={act} />)}

      {(message.limitations || []).length > 0 && (
        <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg px-3 py-2 text-xs text-amber-200 space-y-1">
          <p className="font-medium flex items-center gap-1"><Info size={12} aria-hidden="true" /> Limitations</p>
          <ul className="list-disc pl-4 space-y-0.5">{message.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul>
        </div>
      )}

      <footer className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
        {message.freshness?.retrievedAt && <span>Records read {fmtDate(message.freshness.retrievedAt)}</span>}
        {message.usage?.estimatedCost !== undefined && message.usage?.estimatedCost !== null && <span title={message.usage.label}>· ≈ {Number(message.usage.estimatedCost).toFixed(4)} USD (estimated)</span>}
        <span className="flex-1" />
        {running && !readOnly && <button type="button" className={btn} onClick={onStop}><Square size={12} className="inline mr-1" aria-hidden="true" />Stop</button>}
        {!running && !readOnly && (
          <>
            <button type="button" className="p-1.5 rounded hover:bg-gray-800" aria-label="Answer again" title="Answer again" onClick={onRegenerate}><RefreshCw size={14} /></button>
            <button type="button" aria-pressed={feedback === "Helpful"} className={`p-1.5 rounded hover:bg-gray-800 ${feedback === "Helpful" ? "text-emerald-300" : ""}`} aria-label="Helpful"
              onClick={() => act(async () => { await ai.copilotFeedback(message._id, "Helpful"); setFeedback("Helpful"); })}><ThumbsUp size={14} /></button>
            <button type="button" aria-pressed={feedback === "Not Helpful"} className={`p-1.5 rounded hover:bg-gray-800 ${feedback === "Not Helpful" ? "text-red-300" : ""}`} aria-label="Not helpful"
              onClick={() => act(async () => { await ai.copilotFeedback(message._id, "Not Helpful"); setFeedback("Not Helpful"); })}><ThumbsDown size={14} /></button>
          </>
        )}
      </footer>
    </article>
  );
}

function Part({ part, busy, readOnly, act }) {
  const d = part.data || {};
  if (part.kind === "proposal") return <ProposalPart d={d} busy={busy} readOnly={readOnly} act={act} />;
  return <OtherPart part={part} busy={busy} readOnly={readOnly} act={act} />;
}

// The part is a snapshot; the proposal's current status is fetched and kept here.
function ProposalPart({ d, busy, readOnly, act }) {
  const [status, setStatus] = useState(d.status);
  const [result, setResult] = useState(null);
  useEffect(() => {
    let live = true;
    ai.getAction(d._id).then((r) => { if (live && r?.action) setStatus(r.action.status); }).catch(() => {});
    return () => { live = false; };
  }, [d._id]);
  const pending = status === "Awaiting Confirmation";
  const run = (fn) => act(async () => { const r = await fn(); if (r?.action) { setStatus(r.action.status); setResult(r.action.result?.summary || null); } });
  return (
      <div className="border border-blue-500/30 bg-blue-500/5 rounded-lg p-3 text-sm space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-white">{d.label}</span>
          <Badge>{status}</Badge>
          {d.approvalRequired && <Badge tone="amber">Needs a second approver</Badge>}
        </div>
        <p className="text-gray-300 text-xs">{d.reason}</p>
        {d.proposedValues && <dl className="text-xs text-gray-400 grid grid-cols-[auto,1fr] gap-x-3">{Object.entries(d.proposedValues).map(([k, v]) => <Fragment key={k}><dt className="text-gray-500">{k}</dt><dd className="text-gray-200">{String(v)}</dd></Fragment>)}</dl>}
        {pending && !readOnly && (
          <div className="flex gap-2">
            <button type="button" disabled={busy} className={btnPrimary} onClick={() => run(() => ai.confirmAction(d._id))}>Confirm</button>
            <button type="button" disabled={busy} className={btn} onClick={() => run(() => ai.cancelAction(d._id))}>Cancel</button>
          </div>
        )}
        {result && <p role="status" className="text-xs text-emerald-300">{result}</p>}
        <p className="text-[11px] text-gray-500">Nothing changes until you confirm. The CRM's own rules apply the change.</p>
      </div>
  );
}

function OtherPart({ part, busy, readOnly, act }) {
  const d = part.data || {};
  if (part.kind === "clarification") {
    return (
      <div className="border border-violet-500/30 bg-violet-500/5 rounded-lg p-3 text-sm space-y-2">
        <p className="flex items-center gap-1 text-violet-200"><HelpCircle size={14} aria-hidden="true" /> {d.question}</p>
        {!readOnly && (d.options || []).length > 0 && (
          <div className="flex flex-wrap gap-2">
            {d.options.map((o) => <button key={o.recordId} type="button" disabled={busy} className={btn} onClick={() => act(() => ai.answerCopilotClarification(d.clarificationId, o.recordId))}>{o.label}</button>)}
          </div>
        )}
      </div>
    );
  }
  if (part.kind === "tool_approval") {
    return (
      <div className="border border-amber-500/30 bg-amber-500/5 rounded-lg p-3 text-sm space-y-2">
        <p className="flex items-center gap-1 text-amber-200"><Lock size={14} aria-hidden="true" /> {d.what} needs your confirmation before it is read.</p>
        {d.reason && <p className="text-xs text-gray-400">Why: {d.reason}</p>}
        {!readOnly && (
          <button type="button" disabled={busy} className={btnPrimary}
            onClick={() => act(() => (d.workflowRunId ? ai.approveCopilotWorkflowRun(d.workflowRunId) : ai.approveCopilotToolCall(d.toolCallId)))}>
            Allow and continue
          </button>
        )}
      </div>
    );
  }
  if (part.kind === "memory_proposal") {
    return (
      <div className="border border-gray-700 rounded-lg p-3 text-sm space-y-2">
        <p className="flex items-center gap-1 text-gray-200"><Brain size={14} aria-hidden="true" /> Remember “{d.value}” as your {String(d.key).replace(/_/g, " ")}?</p>
        {d.reason && <p className="text-xs text-gray-500">{d.reason}</p>}
        {!readOnly && (
          <div className="flex gap-2">
            <button type="button" disabled={busy} className={btnPrimary} onClick={() => act(() => ai.updateCopilotMemory(d.memoryId, { status: "Active" }))}>Remember</button>
            <button type="button" disabled={busy} className={btn} onClick={() => act(() => ai.updateCopilotMemory(d.memoryId, { status: "Rejected" }))}>No thanks</button>
          </div>
        )}
      </div>
    );
  }
  if (part.kind === "restricted_notice") {
    return (
      <p className="text-xs text-gray-300 bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 flex gap-2">
        <ShieldAlert size={14} className="shrink-0 text-amber-300 mt-0.5" aria-hidden="true" />
        <span>{d.text}{d.authorized ? ` ${d.authorized}` : ""}</span>
      </p>
    );
  }
  if (part.kind === "open_records") {
    return (
      <div className="flex flex-wrap gap-2">
        {(d.records || []).filter((r) => r.route).map((r) => <Link key={r.recordId} to={r.route} className="text-xs text-blue-300 underline inline-flex items-center gap-1">{r.label}<ExternalLink size={11} aria-hidden="true" /></Link>)}
      </div>
    );
  }
  return null;
}

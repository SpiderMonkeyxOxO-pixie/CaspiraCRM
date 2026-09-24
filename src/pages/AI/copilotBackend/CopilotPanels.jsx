// Side panels and dialogs for the backend-mode Copilot: evidence drawer,
// record context picker, workflows and memory. All data comes from the API;
// the browser never decides what a user may see.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { X, ExternalLink, Search, Trash2 } from "lucide-react";
import * as ai from "../../../Helpers/backendAiClient";
import useFocusTrap from "../../../hooks/useFocusTrap";
import { Badge, Modal, ErrorBox, Loading, Empty } from "../../Admin/aiBackend/aiUi";
import { btn, btnPrimary, btnDanger, input, fmtDate, useAiLoad, useAiAction } from "../../Admin/aiBackend/aiKit";

const METHOD_LABEL = { exact: "Exact record", structured: "CRM search", semantic: "Text search", deterministic: "Calculated by the CRM" };

export function EvidenceDrawer({ citation, onClose }) {
  const ref = useFocusTrap(!!citation, onClose);
  if (!citation) return null;
  const gone = citation.status === "Removed" || citation.status === "Unavailable";
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      <aside ref={ref} role="dialog" aria-modal="true" aria-label={`Source ${citation.key}`} className="relative w-full max-w-md h-full bg-[#12141c] border-l border-gray-800 p-5 overflow-y-auto space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-white">Source {citation.key}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-200 p-1"><X size={16} /></button>
        </div>
        {gone ? (
          <p className="text-sm text-gray-300">This source is no longer available to you, or it was removed because it didn't support the statement.</p>
        ) : (
          <dl className="text-sm space-y-3">
            <div><dt className="text-xs text-gray-500">Record</dt><dd className="text-white">{citation.label} <span className="text-gray-500">({citation.recordType})</span></dd></div>
            <div className="flex gap-2 flex-wrap"><Badge>{citation.status}</Badge><Badge tone="blue">{METHOD_LABEL[citation.retrievalMethod] || citation.retrievalMethod}</Badge>{citation.masked && <Badge tone="amber">Some values hidden</Badge>}</div>
            {citation.field && <div><dt className="text-xs text-gray-500">Section</dt><dd className="text-gray-200">{citation.field}</dd></div>}
            {citation.value?.excerpt && <div><dt className="text-xs text-gray-500">Excerpt</dt><dd className="text-gray-200 whitespace-pre-wrap bg-gray-900/60 border border-gray-800 rounded-lg p-2">{citation.value.excerpt}</dd></div>}
            <div><dt className="text-xs text-gray-500">Record last updated</dt><dd className="text-gray-200">{fmtDate(citation.recordTimestamp)}</dd></div>
            {citation.status === "Stale" && <p className="text-xs text-amber-300">This record changed after the answer was written. Open it for current values.</p>}
          </dl>
        )}
        {citation.route && !gone && (
          <Link to={citation.route} className={`${btnPrimary} inline-flex items-center gap-1`} onClick={onClose}>Open record <ExternalLink size={13} aria-hidden="true" /></Link>
        )}
      </aside>
    </div>
  );
}

const CONTEXT_TYPES = ["Company", "Contact", "Deal", "Lead", "Contract", "Ticket", "Project"];

export function ContextPicker({ onPick, onClose }) {
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [results, setResults] = useState(null);
  const [run, busy, error] = useAiAction();
  const search = (e) => { e?.preventDefault(); run(() => ai.searchCopilotContext(q, type || undefined), (r) => setResults(r.results)); };
  // Re-search when the type filter changes (typing searches on submit).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { search(); }, [type]);
  return (
    <Modal title="Add a record to the conversation" onClose={onClose}>
      <form onSubmit={search} className="flex gap-2">
        <label className="sr-only" htmlFor="ctx-type">Record type</label>
        <select id="ctx-type" className={`${input} w-36`} value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All types</option>
          {CONTEXT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <label className="sr-only" htmlFor="ctx-q">Search records</label>
        <input id="ctx-q" className={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search records you can open" />
        <button type="submit" className={btn} aria-label="Search"><Search size={14} /></button>
      </form>
      <ErrorBox error={error} />
      {busy && <Loading what="Searching…" />}
      {!busy && results && (results.length ? (
        <ul className="divide-y divide-gray-800 border border-gray-800 rounded-lg">
          {results.map((r) => (
            <li key={`${r.recordType}:${r.recordId}`}>
              <button type="button" className="w-full text-left px-3 py-2 hover:bg-gray-800/60 text-sm flex justify-between gap-2" onClick={() => onPick(r)}>
                <span className="text-white truncate">{r.label}</span><span className="text-xs text-gray-500">{r.recordType}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : <Empty>No records you can open match.</Empty>)}
    </Modal>
  );
}

const NEEDS_COMPANY = ["company_briefing", "meeting_preparation"];

export function WorkflowsDialog({ onStarted, onClose }) {
  const { data, error, loading } = useAiLoad(() => ai.listCopilotWorkflows(), []);
  const [chosen, setChosen] = useState(null);
  const [company, setCompany] = useState(null);
  const [picking, setPicking] = useState(false);
  const [purpose, setPurpose] = useState("");
  const [scope, setScope] = useState("mine");
  const [run, busy, runError] = useAiAction();
  const start = () => run(() => ai.runCopilotWorkflow(chosen.key, {
    ...(company && { companyId: company.recordId, companyName: company.label }),
    ...(chosen.key === "meeting_preparation" && purpose && { purpose }),
    ...(chosen.key === "pipeline_review" && scope === "organization" && { scope: "organization" }),
  }), (out) => onStarted(out));
  const needsCompany = chosen && NEEDS_COMPANY.includes(chosen.key);
  if (picking) return <ContextPicker onClose={() => setPicking(false)} onPick={(r) => { if (r.recordType === "Company") { setCompany(r); setPicking(false); } }} />;
  return (
    <Modal title="Run a Copilot workflow" onClose={onClose} footer={chosen && (
      <>
        <button type="button" className={btn} onClick={() => setChosen(null)}>Back</button>
        <button type="button" className={btnPrimary} disabled={busy || (needsCompany && !company)} onClick={start}>{busy ? "Starting…" : "Run workflow"}</button>
      </>
    )}>
      <ErrorBox error={error || runError} />
      {loading && <Loading />}
      {!chosen && data && (
        <ul className="space-y-2">
          {data.workflows.map((w) => (
            <li key={w.key}>
              <button type="button" className="w-full text-left border border-gray-800 rounded-lg px-3 py-2 hover:bg-gray-800/60" onClick={() => setChosen(w)}>
                <span className="block text-sm text-white">{w.name}</span>
                <span className="block text-xs text-gray-400">{w.description}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {chosen && (
        <div className="space-y-3 text-sm">
          <p className="text-gray-300">{chosen.description}</p>
          <ol className="list-decimal pl-5 text-xs text-gray-400 space-y-0.5">{chosen.steps.map((s, i) => <li key={i}>{s.reason}</li>)}</ol>
          {needsCompany && (
            <div>
              <p className="text-xs text-gray-500 mb-1">Company</p>
              <button type="button" className={btn} onClick={() => setPicking(true)}>{company ? company.label : "Choose a Company"}</button>
            </div>
          )}
          {chosen.key === "meeting_preparation" && (
            <label className="block"><span className="text-xs text-gray-500">Meeting purpose (optional)</span>
              <input className={input} value={purpose} maxLength={200} onChange={(e) => setPurpose(e.target.value)} /></label>
          )}
          {chosen.key === "pipeline_review" && (
            <label className="block"><span className="text-xs text-gray-500">Scope</span>
              <select className={input} value={scope} onChange={(e) => setScope(e.target.value)}>
                <option value="mine">My pipeline</option>
                <option value="organization">Everything I can see (asks for confirmation)</option>
              </select></label>
          )}
          <p className="text-xs text-gray-500">Workflows only read records you can open. Any change is prepared as a proposal for you to confirm.</p>
        </div>
      )}
    </Modal>
  );
}

export function MemoryDialog({ onClose }) {
  const { data, error, loading, reload } = useAiLoad(() => ai.listCopilotMemory(), []);
  const [run, busy, actionError] = useAiAction();
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const def = data?.keys.find((k) => k.key === key);
  return (
    <Modal title="Copilot memory" onClose={onClose}>
      <p className="text-xs text-gray-400">The Copilot remembers only these preferences. Customer details, amounts and personal information are never remembered; they stay on their records.</p>
      <ErrorBox error={error || actionError} onRetry={error ? reload : undefined} />
      {loading && <Loading />}
      {data && (data.memories.length ? (
        <ul className="divide-y divide-gray-800 border border-gray-800 rounded-lg">
          {data.memories.map((m) => (
            <li key={m._id} className="px-3 py-2 text-sm flex flex-wrap items-center gap-2">
              <span className="text-gray-400">{m.label}:</span><span className="text-white">{m.value}</span>
              <Badge tone={m.status === "Active" ? "green" : "blue"}>{m.status}</Badge>
              <span className="text-xs text-gray-500">{m.source === "User" ? "Saved by you" : "Suggested by the Copilot"} · expires {fmtDate(m.expiresAt)}</span>
              <span className="flex-1" />
              {m.status === "Proposed" && <button type="button" disabled={busy} className={btn} onClick={() => run(() => ai.updateCopilotMemory(m._id, { status: "Active" }), reload)}>Accept</button>}
              <button type="button" disabled={busy} className={btnDanger} aria-label={`Forget ${m.label}`} onClick={() => run(() => ai.deleteCopilotMemory(m._id), reload)}><Trash2 size={13} /></button>
            </li>
          ))}
        </ul>
      ) : <Empty>Nothing remembered yet.</Empty>)}
      {data && (
        <form className="flex flex-wrap gap-2 items-end" onSubmit={(e) => { e.preventDefault(); run(() => ai.createCopilotMemory(key, value), () => { setKey(""); setValue(""); reload(); }); }}>
          <label className="flex-1 min-w-[10rem]"><span className="text-xs text-gray-500">Preference</span>
            <select className={input} value={key} onChange={(e) => { setKey(e.target.value); setValue(""); }}>
              <option value="">Choose…</option>
              {data.keys.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
            </select></label>
          <label className="flex-1 min-w-[8rem]"><span className="text-xs text-gray-500">Value</span>
            {def?.values ? (
              <select className={input} value={value} onChange={(e) => setValue(e.target.value)}>
                <option value="">Choose…</option>
                {def.values.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            ) : <input className={input} value={value} onChange={(e) => setValue(e.target.value)} placeholder={key === "currency_display" ? "USD symbol" : ""} />}
          </label>
          <button type="submit" className={btnPrimary} disabled={busy || !key || !value}>Save</button>
        </form>
      )}
    </Modal>
  );
}

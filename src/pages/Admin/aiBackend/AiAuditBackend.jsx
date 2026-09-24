import { useState } from "react";
import * as ai from "../../../Helpers/backendAiClient";
import { AiPage, Badge, ErrorBox, Loading, Table } from "./aiUi";
import { useAiLoad, fmtDate, btn, input } from "./aiKit";

const FILTERS = [["ai.", "All AI events"], ["ai.connection.", "Connections"], ["ai.action.", "Actions"], ["ai.policy.", "Policy"], ["ai.budget.", "Budgets"], ["ai.request.", "Refused / cancelled requests"], ["ai.prompt_injection.", "Prompt-injection detections"], ["ai.evaluation.", "Evaluations"]];

// Backend-mode AI audit log (append-only). Keys, tokens and prompts are
// never recorded here.
export default function AiAuditBackend() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState("ai.");
  const { data, error, loading, reload } = useAiLoad(() => ai.listAudit({ page, pageSize: 25, action }), [page, action]);
  return (
    <AiPage title="Audit" description="Every AI governance event: connections, keys, policy and budget changes, refused requests, prompt-injection detections and AI actions. Keys, tokens and prompts are never recorded.">
      <div className="flex items-center gap-2">
        <label htmlFor="audit-filter" className="text-xs text-gray-400">Show</label>
        <select id="audit-filter" className={`${input} max-w-xs`} value={action} onChange={(e) => { setPage(1); setAction(e.target.value); }}>
          {FILTERS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <Loading /> : data && (
        <>
          <Table rows={data.auditEvents} empty="No AI events." columns={[
            { label: "When", render: (e) => fmtDate(e.createdAt) },
            { label: "Event", render: (e) => <code className="text-xs text-gray-200">{e.action}</code> },
            { label: "Target", render: (e) => <span className="text-xs">{e.targetType} {e.targetId ? <code className="text-gray-500">{String(e.targetId).slice(0, 12)}</code> : ""}</span> },
            { label: "Result", render: (e) => <Badge>{e.result}</Badge> },
            { label: "Details", render: (e) => <span className="text-xs text-gray-400">{e.reason || (e.after ? JSON.stringify(e.after).slice(0, 140) : "")}</span> },
          ]} />
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <button type="button" className={btn} disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
            <span>Page {page} of {Math.max(1, Math.ceil(data.total / 25))}</span>
            <button type="button" className={btn} disabled={page * 25 >= data.total} onClick={() => setPage(page + 1)}>Next</button>
          </div>
        </>
      )}
    </AiPage>
  );
}

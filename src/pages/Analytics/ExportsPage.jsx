// Backend Phase 12 — governed exports: request (with a stated purpose), the
// member's export inbox (including scheduled deliveries), approvals for
// financial exports, authenticated downloads with limits and expiry, revoke.
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import * as api from "../../Helpers/backendAnalyticsClient";
import { pageRequires, useAnalyticsAccess } from "../../Helpers/analyticsAccess";
import { AnalyticsPage, ErrorBox, Loading, Modal, Badge, Table } from "./AnalyticsUi";
import { btn, btnPrimary, btnDanger, input, useLoad, useAction, fmtDateTime, useAllowed } from "./analyticsKit";

const TONE = { Ready: "green", Downloaded: "green", Queued: "blue", Generating: "blue", Scanning: "blue", "Awaiting approval": "amber", Failed: "red", Revoked: "gray", Expired: "gray", Cancelled: "gray" };
const size = (b) => (b === null || b === undefined ? "—" : b < 1024 ? `${b} B` : `${(b / 1024).toFixed(1)} KB`);

function RequestForm({ reports, initialReport, onClose, onDone }) {
  const [f, setF] = useState({ reportId: initialReport || reports[0]?._id || "", format: "csv", purpose: "", downloadLimit: 5 });
  const [run, busy, error] = useAction();
  const submit = (e) => { e.preventDefault(); run(() => api.requestExport({ reportId: f.reportId, format: f.format, purpose: f.purpose, downloadLimit: Number(f.downloadLimit) }), (out) => { onDone(out); onClose(); }); };
  return (
    <Modal title="Request an export" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <label className="block text-xs text-gray-400">Report<select className={`${input} mt-1`} value={f.reportId} onChange={(e) => setF({ ...f, reportId: e.target.value })}>{reports.map((r) => <option key={r._id} value={r._id}>{r.name}</option>)}</select></label>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-gray-400">Format<select className={`${input} mt-1`} value={f.format} onChange={(e) => setF({ ...f, format: e.target.value })}><option value="csv">CSV</option><option value="xlsx">Excel (XLSX)</option><option value="pdf">PDF</option><option value="json">JSON</option></select></label>
          <label className="text-xs text-gray-400">Download limit<input type="number" min="1" max="20" className={`${input} mt-1`} value={f.downloadLimit} onChange={(e) => setF({ ...f, downloadLimit: e.target.value })} /></label>
        </div>
        <label className="block text-xs text-gray-400">Purpose (recorded in the audit trail)<textarea className={`${input} mt-1 min-h-[4rem]`} value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} required minLength={3} /></label>
        <p className="text-[11px] text-gray-500">The file contains only what your access allows when it is generated. Financial exports need approval from someone else. Files are encrypted, expire, and can be downloaded only while signed in.</p>
        <ErrorBox error={error} />
        <div className="flex justify-end gap-2"><button type="button" className={btn} onClick={onClose}>Cancel</button><button type="submit" className={btnPrimary} disabled={busy || !f.reportId}>Request export</button></div>
      </form>
    </Modal>
  );
}

function ReasonModal({ title, confirm, danger, onSubmit, onClose }) {
  const [reason, setReason] = useState("");
  const [run, busy, error] = useAction();
  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); run(() => onSubmit(reason), onClose); }} className="space-y-3">
        <label className="block text-xs text-gray-400">Reason<textarea className={`${input} mt-1 min-h-[4rem]`} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        <ErrorBox error={error} />
        <div className="flex justify-end gap-2"><button type="button" className={btn} onClick={onClose}>Cancel</button><button type="submit" className={danger ? btnDanger : btnPrimary} disabled={busy}>{confirm}</button></div>
      </form>
    </Modal>
  );
}

export default function ExportsPage() {
  const [params] = useSearchParams();
  const access = useAnalyticsAccess();
  const approver = access.can("analytics_exports", "approve");
  const [all, setAll] = useState(false);
  const [requesting, setRequesting] = useState(!!params.get("report"));
  const [dialog, setDialog] = useState(null);
  const [notice, setNotice] = useState(null);
  const allowed = useAllowed(pageRequires("/reports/exports"));
  const list = useLoad(() => api.listExports(all ? { all: "true" } : {}), [all], allowed);
  const reports = useLoad(() => api.listReports().catch(() => ({ reports: [] })), [], allowed);
  const [run, busy, error] = useAction();
  const highlight = params.get("export");
  const me = access.data?.membershipId;
  return (
    <AnalyticsPage section="Reports" title="Exports" description="Your requested and scheduled exports. Downloads are counted, limited, audited and expire." requires={pageRequires("/reports/exports")}
      actions={access.can("analytics_exports", "basic") && <button type="button" className={btnPrimary} onClick={() => setRequesting(true)} disabled={!reports.data?.reports?.length}>Request export</button>}>
      {approver && <label className="text-xs text-gray-400 flex items-center gap-2"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Show everyone's exports (approver view)</label>}
      <ErrorBox error={list.error || error} onRetry={list.reload} />
      {notice && <p role="status" className="text-sm text-emerald-300">{notice}</p>}
      {list.loading && !list.data ? <Loading /> : (
        <Table rows={list.data?.exports || []} empty="No exports yet." columns={[
          { label: "Export", render: (x) => <span className={x._id === highlight ? "text-blue-300 font-semibold" : ""}>{x.purpose}<span className="block text-[11px] text-gray-500">{x.format.toUpperCase()} · {x.metrics.length} metric(s){x.scheduled ? " · scheduled delivery" : ""}</span></span> },
          { label: "Status", render: (x) => <><Badge tone={TONE[x.status]}>{x.status}</Badge>{x.safeError && <span className="block text-[11px] text-gray-500 mt-0.5">{x.safeError}</span>}</> },
          { label: "Classification", render: (x) => <Badge tone={x.classification === "Confidential" ? "violet" : "gray"}>{x.classification}</Badge> },
          { label: "Rows / size", render: (x) => `${x.rowCount ?? "—"} / ${size(x.fileSize)}` },
          { label: "Downloads", render: (x) => `${x.downloads}/${x.downloadLimit}` },
          { label: "Expires", render: (x) => fmtDateTime(x.expiresAt) },
          { label: "Requested", render: (x) => fmtDateTime(x.createdAt) },
          { label: "", render: (x) => (
            <div className="flex gap-1 flex-wrap">
              {["Ready", "Downloaded"].includes(x.status) && x.downloads < x.downloadLimit && x.requestedByMembershipId === me && (
                <button type="button" className={btn} disabled={busy} onClick={() => run(() => api.downloadExport(x._id), (name) => { setNotice(`Downloaded ${name}.`); list.reload(); })}>Download</button>
              )}
              {x.status === "Awaiting approval" && approver && x.requestedByMembershipId !== me && (
                <>
                  <button type="button" className={btnPrimary} disabled={busy} onClick={() => setDialog({ kind: "approve", x })}>Approve</button>
                  <button type="button" className={btn} disabled={busy} onClick={() => setDialog({ kind: "reject", x })}>Reject</button>
                </>
              )}
              {!["Revoked", "Expired", "Cancelled", "Failed"].includes(x.status) && (x.requestedByMembershipId === me || approver) && (
                <button type="button" className={btnDanger} disabled={busy} onClick={() => setDialog({ kind: "revoke", x })}>Revoke</button>
              )}
            </div>
          ) },
        ]} />
      )}
      {requesting && reports.data && <RequestForm reports={reports.data.reports} initialReport={params.get("report")} onClose={() => setRequesting(false)} onDone={(out) => { setNotice(out.status === "Awaiting approval" ? "Export requested — it needs approval because it contains financial data." : "Export requested — it will be ready shortly."); list.reload(); }} />}
      {dialog?.kind === "approve" && <ReasonModal title="Approve export" confirm="Approve" onSubmit={(reason) => api.approveExport(dialog.x._id, reason).then(list.reload)} onClose={() => setDialog(null)} />}
      {dialog?.kind === "reject" && <ReasonModal title="Reject export" confirm="Reject" danger onSubmit={(reason) => api.rejectExport(dialog.x._id, reason).then(list.reload)} onClose={() => setDialog(null)} />}
      {dialog?.kind === "revoke" && <ReasonModal title="Revoke export" confirm="Revoke" danger onSubmit={(reason) => api.revokeExport(dialog.x._id, reason).then(list.reload)} onClose={() => setDialog(null)} />}
    </AnalyticsPage>
  );
}

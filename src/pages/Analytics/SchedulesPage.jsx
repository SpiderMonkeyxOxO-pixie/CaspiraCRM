// Backend Phase 12 — scheduled report delivery. Schedules run in their own
// time zone; each delivery is generated with the recipient's own access and
// arrives in their Exports inbox (optionally with an email sign-in link —
// files are never attached and links are never public).
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import * as api from "../../Helpers/backendAnalyticsClient";
import { pageRequires, useAnalyticsAccess } from "../../Helpers/analyticsAccess";
import { AnalyticsPage, Panel, ErrorBox, Loading, Empty, Modal, Badge, Table } from "./AnalyticsUi";
import { btn, btnPrimary, btnDanger, input, useLoad, useAction, fmtDateTime, useAllowed } from "./analyticsKit";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const RUN_TONE = { Delivered: "green", "Delivered with warnings": "amber", Skipped: "gray", Failed: "red", Running: "blue" };
const browserZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return "UTC"; } };

function describe(s) {
  const at = `${s.runAt} ${s.timeZone}`;
  if (s.frequency === "daily") return `Every day at ${at}`;
  if (s.frequency === "weekly") return `Every ${DAYS[s.dayOfWeek ?? 1]} at ${at}`;
  if (s.frequency === "monthly") return `Monthly on day ${s.dayOfMonth} at ${at}`;
  if (s.frequency === "quarterly") return `Quarterly (Jan/Apr/Jul/Oct) on day ${s.dayOfMonth} at ${at}`;
  return `Once on ${String(s.startDate || "").slice(0, 10)} at ${at}`;
}

function ScheduleForm({ reports, initialReport, membershipId, onClose, onSaved }) {
  const [f, setF] = useState({ reportId: initialReport || reports[0]?._id || "", frequency: "weekly", dayOfWeek: 1, dayOfMonth: 1, runAt: "08:00", timeZone: browserZone(), startDate: "", deliveryMethod: "in_app", format: "csv", stalePolicy: "skip", failurePolicy: "notify_owner", recipientsText: "", includeMe: true });
  const [run, busy, error, setError] = useAction();
  const set = (p) => setF((x) => ({ ...x, ...p }));
  const submit = (e) => {
    e.preventDefault();
    const recipients = [...(f.includeMe && membershipId ? [{ type: "Membership", id: membershipId }] : []),
      ...f.recipientsText.split(/[\s,]+/).filter(Boolean).map((t) => (t.startsWith("role:") ? { type: "Role", id: t.slice(5) } : { type: "Membership", id: t }))];
    if (!recipients.length) { setError("Add at least one recipient."); return; }
    const body = { reportId: f.reportId, frequency: f.frequency, runAt: f.runAt, timeZone: f.timeZone, deliveryMethod: f.deliveryMethod, format: f.format, stalePolicy: f.stalePolicy, failurePolicy: f.failurePolicy, recipients,
      ...(f.frequency === "weekly" ? { dayOfWeek: Number(f.dayOfWeek) } : {}), ...(["monthly", "quarterly"].includes(f.frequency) ? { dayOfMonth: Number(f.dayOfMonth) } : {}), ...(f.startDate ? { startDate: f.startDate } : {}) };
    run(() => api.createSchedule(body), () => { onSaved(); onClose(); });
  };
  return (
    <Modal title="Schedule a report" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <label className="block text-xs text-gray-400">Report<select className={`${input} mt-1`} value={f.reportId} onChange={(e) => set({ reportId: e.target.value })}>{reports.map((r) => <option key={r._id} value={r._id}>{r.name}</option>)}</select></label>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-gray-400">How often<select className={`${input} mt-1`} value={f.frequency} onChange={(e) => set({ frequency: e.target.value })}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="once">Once</option></select></label>
          {f.frequency === "weekly" && <label className="text-xs text-gray-400">Day<select className={`${input} mt-1`} value={f.dayOfWeek} onChange={(e) => set({ dayOfWeek: e.target.value })}>{DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select></label>}
          {["monthly", "quarterly"].includes(f.frequency) && <label className="text-xs text-gray-400">Day of month (1–28)<input type="number" min="1" max="28" className={`${input} mt-1`} value={f.dayOfMonth} onChange={(e) => set({ dayOfMonth: e.target.value })} /></label>}
          {f.frequency === "once" && <label className="text-xs text-gray-400">Date<input type="date" className={`${input} mt-1`} value={f.startDate} onChange={(e) => set({ startDate: e.target.value })} required /></label>}
          <label className="text-xs text-gray-400">Time<input type="time" className={`${input} mt-1`} value={f.runAt} onChange={(e) => set({ runAt: e.target.value })} required /></label>
          <label className="text-xs text-gray-400">Time zone<input className={`${input} mt-1`} value={f.timeZone} onChange={(e) => set({ timeZone: e.target.value })} /></label>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-gray-400">Delivery<select className={`${input} mt-1`} value={f.deliveryMethod} onChange={(e) => set({ deliveryMethod: e.target.value })}><option value="in_app">In-app (Exports inbox)</option><option value="email_link">In-app + email sign-in link</option></select></label>
          <label className="text-xs text-gray-400">Format<select className={`${input} mt-1`} value={f.format} onChange={(e) => set({ format: e.target.value })}><option value="csv">CSV</option><option value="xlsx">Excel (XLSX)</option><option value="pdf">PDF</option><option value="json">JSON</option></select></label>
          <label className="text-xs text-gray-400">If data is stale<select className={`${input} mt-1`} value={f.stalePolicy} onChange={(e) => set({ stalePolicy: e.target.value })}><option value="skip">Skip and tell me</option><option value="deliver_with_warning">Deliver with a warning</option><option value="deliver">Deliver anyway</option></select></label>
          <label className="text-xs text-gray-400">If delivery fails<select className={`${input} mt-1`} value={f.failurePolicy} onChange={(e) => set({ failurePolicy: e.target.value })}><option value="notify_owner">Notify me</option><option value="retry">Retry next cycle</option><option value="skip">Skip</option></select></label>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-300"><input type="checkbox" checked={f.includeMe} onChange={(e) => set({ includeMe: e.target.checked })} /> Send to me</label>
        <label className="block text-xs text-gray-400">Other recipients — membership IDs or <code>role:&lt;key&gt;</code>, separated by commas<input className={`${input} mt-1`} value={f.recipientsText} onChange={(e) => set({ recipientsText: e.target.value })} placeholder="role:team_leader" /></label>
        <p className="text-[11px] text-gray-500">Each recipient receives only what their own access allows; anyone who loses access to the report is skipped. Only members of this organization can be recipients.</p>
        <ErrorBox error={error} />
        <div className="flex justify-end gap-2"><button type="button" className={btn} onClick={onClose}>Cancel</button><button type="submit" className={btnPrimary} disabled={busy || !f.reportId}>Create schedule</button></div>
      </form>
    </Modal>
  );
}

function RunHistory({ id }) {
  const { data, error, loading } = useLoad(() => api.getSchedule(id), [id]);
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data.runs?.length) return <Empty>No deliveries yet.</Empty>;
  return (
    <ul className="text-sm space-y-1">
      {data.runs.map((r) => (
        <li key={r.scheduledFor} className="flex flex-wrap gap-2 items-center">
          <Badge tone={RUN_TONE[r.status]}>{r.status}</Badge>
          <span className="text-gray-300">{fmtDateTime(r.scheduledFor)}</span>
          <span className="text-gray-500 text-xs">{(r.deliveries || []).filter((d) => d.status === "Queued").length}/{(r.deliveries || []).length} recipients{r.safeError ? ` · ${r.safeError}` : ""}</span>
        </li>
      ))}
    </ul>
  );
}

export default function SchedulesPage() {
  const [params] = useSearchParams();
  const access = useAnalyticsAccess();
  const [creating, setCreating] = useState(!!params.get("report"));
  const [history, setHistory] = useState(null);
  const allowed = useAllowed(pageRequires("/reports/schedules"));
  const schedules = useLoad(() => api.listSchedules(), [], allowed);
  const reports = useLoad(() => api.listReports(), [], allowed);
  const [run, busy, error] = useAction();
  return (
    <AnalyticsPage section="Reports" title="Scheduled Reports" description="Deliver reports on a schedule. Every delivery is generated with each recipient's own access." requires={pageRequires("/reports/schedules")}
      actions={<button type="button" className={btnPrimary} onClick={() => setCreating(true)} disabled={!reports.data?.reports?.length}>New schedule</button>}>
      <ErrorBox error={schedules.error || reports.error || error} onRetry={schedules.reload} />
      {schedules.loading && !schedules.data ? <Loading /> : (
        <Table rows={schedules.data?.schedules || []} empty="No schedules yet." columns={[
          { label: "Report", render: (s) => s.reportName || s.reportId },
          { label: "When", render: (s) => describe(s) },
          { label: "Next run", render: (s) => (s.active ? fmtDateTime(s.nextRunAt) : "—") },
          { label: "Recipients", render: (s) => s.recipients.map((r) => (r.type === "Role" ? `role ${r.id}` : "member")).join(", ") },
          { label: "Delivery", render: (s) => `${s.deliveryMethod === "email_link" ? "In-app + email link" : "In-app"} · ${s.format.toUpperCase()}` },
          { label: "Status", render: (s) => (s.active ? <Badge tone="green">Active</Badge> : <Badge tone="gray">{s.pausedReason || "Paused"}</Badge>) },
          { label: "", render: (s) => (
            <div className="flex gap-1 flex-wrap">
              <button type="button" className={btn} onClick={() => setHistory(s)}>History</button>
              {s.ownerMembershipId === access.data?.membershipId && s.pausedReason !== "Deleted" && (
                <>
                  {s.active && <button type="button" className={btn} disabled={busy} onClick={() => run(() => api.runScheduleNow(s._id), schedules.reload)}>Run now</button>}
                  <button type="button" className={btn} disabled={busy} onClick={() => run(() => api.updateSchedule(s._id, { active: !s.active, version: s.version }), schedules.reload)}>{s.active ? "Pause" : "Resume"}</button>
                  <button type="button" className={btnDanger} disabled={busy} onClick={() => run(() => api.deleteSchedule(s._id), schedules.reload)}>Delete</button>
                </>
              )}
            </div>
          ) },
        ]} />
      )}
      {creating && reports.data && <ScheduleForm reports={reports.data.reports} initialReport={params.get("report")} membershipId={access.data?.membershipId} onClose={() => setCreating(false)} onSaved={schedules.reload} />}
      {history && <Modal title={`Deliveries · ${history.reportName || history.reportId}`} onClose={() => setHistory(null)}><RunHistory id={history._id} /></Modal>}
      <Panel><p className="text-xs text-gray-500">Times follow each schedule's time zone, including daylight-saving changes. A skipped local time (clocks going forward) runs at the next valid minute.</p></Panel>
    </AnalyticsPage>
  );
}

import { useEffect, useRef, useState } from "react";
import {
  ChevronUp, ChevronDown, Columns3, ChevronLeft, ChevronRight, MoreHorizontal, ListChecks,
} from "lucide-react";
import { queryActivitiesLocal } from "../../../Helpers/mockActivitiesData";
import { TypeIcon, StatusBadge, PriorityBadge, ReminderIndicator } from "./ActivityBadges";
import { formatDateTime } from "./activityUtils";

const ALL_COLUMNS = [
  { key: "type", label: "Type", optional: false },
  { key: "relatedRecordLabel", label: "Related Record", optional: false },
  { key: "ownerName", label: "Owner", optional: false },
  { key: "participants", label: "Participants", optional: false },
  { key: "when", label: "Start / Due", optional: false },
  { key: "priority", label: "Priority", optional: false },
  { key: "status", label: "Status", optional: false },
  { key: "outcome", label: "Outcome", optional: false },
  { key: "updatedAt", label: "Last Updated", optional: false },
  { key: "assignedTeam", label: "Team", optional: true },
  { key: "reminder", label: "Reminder", optional: true },
  { key: "timezone", label: "Time Zone", optional: true },
  { key: "createdBy", label: "Created By", optional: true },
  { key: "createdAt", label: "Created", optional: true },
  { key: "completedAt", label: "Completed", optional: true },
];
const DEFAULT_VISIBLE = ALL_COLUMNS.filter((c) => !c.optional).map((c) => c.key);
const COLUMN_PREF_KEY = "crm.activities.visibleColumns";

export default function TableView({ activities, params, updateParam, selected, onToggleSelect, onToggleSelectAll, onOpen, onQuickAction, onBulkAction }) {
  const [showColumns, setShowColumns] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState(() => {
    try { return JSON.parse(localStorage.getItem(COLUMN_PREF_KEY)) || DEFAULT_VISIBLE; } catch { return DEFAULT_VISIBLE; }
  });
  const toggleColumn = (key) => {
    setVisibleColumns((cols) => {
      const next = cols.includes(key) ? cols.filter((c) => c !== key) : [...cols, key];
      localStorage.setItem(COLUMN_PREF_KEY, JSON.stringify(next));
      return next;
    });
  };

  const sort = params.sort || "startAt";
  const order = params.order || "asc";
  const page = Number(params.page) || 1;
  const pageSize = Number(params.pageSize) || 20;
  const { activities: pageItems, total, page: currentPage, pageSize: size } = queryActivitiesLocal(activities, { sort, order, page, pageSize });
  const totalPages = Math.max(1, Math.ceil(total / size));

  const toggleSort = (key) => {
    if (sort === key) updateParam("order", order === "asc" ? "desc" : "asc", false);
    else { updateParam("sort", key, false); updateParam("order", "asc", false); }
  };

  if (activities.length === 0) {
    return (
      <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-12 text-center text-gray-400">
        <ListChecks size={24} className="mx-auto mb-2 text-gray-600" />
        <p>No activities match the current filters.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-end mb-2 relative">
        <button onClick={() => setShowColumns((v) => !v)} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm">
          <Columns3 size={16} /> Columns
        </button>
        {showColumns && (
          <div className="absolute right-0 top-10 bg-gray-900 border border-gray-800 rounded-lg p-3 z-20 w-56 shadow-xl max-h-72 overflow-y-auto">
            {ALL_COLUMNS.filter((c) => c.optional).map((c) => (
              <label key={c.key} className="flex items-center gap-2 text-sm py-1">
                <input type="checkbox" checked={visibleColumns.includes(c.key)} onChange={() => toggleColumn(c.key)} /> {c.label}
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="bg-gray-900/40 border border-gray-800 rounded-xl overflow-hidden overflow-x-auto">
        <table className="w-full text-sm min-w-300">
          <thead className="bg-gray-900/60 text-gray-400 text-left">
            <tr>
              <th className="px-4 py-3 w-8"><input type="checkbox" checked={selected.size === pageItems.length && pageItems.length > 0} onChange={() => onToggleSelectAll(pageItems)} aria-label="Select all activities" /></th>
              <th scope="col" className="px-4 py-3 font-medium cursor-pointer select-none" onClick={() => toggleSort("title")}>
                <span className="flex items-center gap-1">Activity {sort === "title" && (order === "asc" ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}</span>
              </th>
              {visibleColumns.includes("type") && <th className="px-4 py-3 font-medium">Type</th>}
              {visibleColumns.includes("relatedRecordLabel") && <th className="px-4 py-3 font-medium">Related Record</th>}
              {visibleColumns.includes("ownerName") && <th className="px-4 py-3 font-medium">Owner</th>}
              {visibleColumns.includes("participants") && <th className="px-4 py-3 font-medium">Participants</th>}
              {visibleColumns.includes("assignedTeam") && <th className="px-4 py-3 font-medium">Team</th>}
              {visibleColumns.includes("when") && (
                <th scope="col" className="px-4 py-3 font-medium cursor-pointer select-none" onClick={() => toggleSort("startAt")}>
                  <span className="flex items-center gap-1">Start / Due {sort === "startAt" && (order === "asc" ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}</span>
                </th>
              )}
              {visibleColumns.includes("priority") && <th className="px-4 py-3 font-medium">Priority</th>}
              {visibleColumns.includes("status") && <th className="px-4 py-3 font-medium">Status</th>}
              {visibleColumns.includes("outcome") && <th className="px-4 py-3 font-medium">Outcome</th>}
              {visibleColumns.includes("reminder") && <th className="px-4 py-3 font-medium">Reminder</th>}
              {visibleColumns.includes("timezone") && <th className="px-4 py-3 font-medium">Time Zone</th>}
              {visibleColumns.includes("createdBy") && <th className="px-4 py-3 font-medium">Created By</th>}
              {visibleColumns.includes("createdAt") && <th className="px-4 py-3 font-medium">Created</th>}
              {visibleColumns.includes("completedAt") && <th className="px-4 py-3 font-medium">Completed</th>}
              {visibleColumns.includes("updatedAt") && (
                <th scope="col" className="px-4 py-3 font-medium cursor-pointer select-none" onClick={() => toggleSort("updatedAt")}>
                  <span className="flex items-center gap-1">Last Updated {sort === "updatedAt" && (order === "asc" ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}</span>
                </th>
              )}
              <th scope="col" className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {pageItems.map((activity) => (
              <tr key={activity._id} className="border-t border-gray-800 hover:bg-gray-800/40">
                <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" checked={selected.has(activity._id)} onChange={() => onToggleSelect(activity._id)} aria-label={`Select ${activity.title}`} />
                </td>
                <td className="px-4 py-3 cursor-pointer font-medium" onClick={() => onOpen(activity)}>{activity.title}</td>
                {visibleColumns.includes("type") && <td className="px-4 py-3 text-gray-300"><span className="flex items-center gap-1.5"><TypeIcon type={activity.type} size={13} /> {activity.type}</span></td>}
                {visibleColumns.includes("relatedRecordLabel") && <td className="px-4 py-3 text-gray-300">{activity.relatedRecordLabel || "—"}</td>}
                {visibleColumns.includes("ownerName") && <td className="px-4 py-3 text-gray-300">{activity.ownerName || "Unassigned"}</td>}
                {visibleColumns.includes("participants") && <td className="px-4 py-3 text-gray-300">{(activity.participants || []).map((p) => p.name).join(", ") || "—"}</td>}
                {visibleColumns.includes("assignedTeam") && <td className="px-4 py-3 text-gray-300">{activity.assignedTeam || "—"}</td>}
                {visibleColumns.includes("when") && <td className="px-4 py-3 text-gray-300">{formatDateTime(activity.dueDate || activity.startAt)}</td>}
                {visibleColumns.includes("priority") && <td className="px-4 py-3"><PriorityBadge priority={activity.priority} /></td>}
                {visibleColumns.includes("status") && <td className="px-4 py-3"><StatusBadge activity={activity} /></td>}
                {visibleColumns.includes("outcome") && <td className="px-4 py-3 text-gray-300">{activity.outcome || "—"}</td>}
                {visibleColumns.includes("reminder") && <td className="px-4 py-3"><ReminderIndicator reminder={activity.reminder} /></td>}
                {visibleColumns.includes("timezone") && <td className="px-4 py-3 text-gray-300">{activity.timezone}</td>}
                {visibleColumns.includes("createdBy") && <td className="px-4 py-3 text-gray-300">{activity.createdBy}</td>}
                {visibleColumns.includes("createdAt") && <td className="px-4 py-3 text-gray-300">{new Date(activity.createdAt).toLocaleDateString()}</td>}
                {visibleColumns.includes("completedAt") && <td className="px-4 py-3 text-gray-300">{activity.completedAt ? new Date(activity.completedAt).toLocaleDateString() : "—"}</td>}
                {visibleColumns.includes("updatedAt") && <td className="px-4 py-3 text-gray-300">{new Date(activity.updatedAt).toLocaleDateString()}</td>}
                <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                  <RowMenu activity={activity} onOpen={onOpen} onQuickAction={onQuickAction} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected.size > 0 && (
        <div className="flex items-center gap-3 bg-blue-900/20 border border-blue-700/40 rounded-xl p-3 mt-3 flex-wrap">
          <span className="text-sm">{selected.size} selected</span>
          <button onClick={() => onBulkAction("assign")} className="text-sm text-blue-300 hover:underline">Assign</button>
          <button onClick={() => onBulkAction("reschedule")} className="text-sm text-blue-300 hover:underline">Reschedule</button>
          <button onClick={() => onBulkAction("complete")} className="text-sm text-blue-300 hover:underline">Complete</button>
          <button onClick={() => onBulkAction("cancel")} className="text-sm text-blue-300 hover:underline">Cancel</button>
        </div>
      )}

      <div className="flex items-center justify-between mt-4 text-sm text-gray-400">
        <span>Page {currentPage} of {totalPages} · {total} total</span>
        <div className="flex items-center gap-2">
          <select value={size} onChange={(e) => updateParam("pageSize", e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-2 py-1.5 text-sm">
            {[10, 20, 50, 100].map((n) => <option key={n} value={n}>{n} / page</option>)}
          </select>
          <button disabled={currentPage <= 1} onClick={() => updateParam("page", String(currentPage - 1), false)} className="p-2 rounded-lg border border-gray-800 disabled:opacity-30" aria-label="Previous page"><ChevronLeft size={16} /></button>
          <button disabled={currentPage >= totalPages} onClick={() => updateParam("page", String(currentPage + 1), false)} className="p-2 rounded-lg border border-gray-800 disabled:opacity-30" aria-label="Next page"><ChevronRight size={16} /></button>
        </div>
      </div>
    </div>
  );
}

function RowMenu({ activity, onOpen, onQuickAction }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);
  const isTerminal = ["Completed", "Cancelled"].includes(activity.status);
  const items = [
    { label: "Open details", action: () => onOpen(activity) },
    !isTerminal && { label: "Mark complete", action: () => onQuickAction(activity, "complete") },
    !isTerminal && { label: "Reschedule", action: () => onQuickAction(activity, "reschedule") },
    { label: "Add follow-up", action: () => onQuickAction(activity, "followup") },
    !isTerminal && { label: "Edit", action: () => onQuickAction(activity, "edit") },
    !isTerminal && { label: "Cancel", action: () => onQuickAction(activity, "cancel") },
  ].filter(Boolean);
  return (
    <div className="relative inline-block" ref={ref}>
      <button onClick={() => setOpen((v) => !v)} aria-label={`Actions for ${activity.title}`} aria-haspopup="menu" aria-expanded={open} className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white">
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 mt-1 bg-gray-900 border border-gray-800 rounded-lg py-1 z-20 w-40 shadow-xl text-left">
          {items.map((item) => (
            <button key={item.label} role="menuitem" onClick={() => { item.action(); setOpen(false); }} className="w-full text-left text-sm px-3 py-1.5 hover:bg-gray-800">{item.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}

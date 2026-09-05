import { useState } from "react";
import { useDispatch } from "react-redux";
import { Link } from "react-router-dom";
import { CheckCircle2, CalendarClock } from "lucide-react";
import { completeActivity, fetchActivities } from "../../../redux/crm/activitiesSlice";
import { TypeIcon, StatusBadge, PriorityBadge } from "../Activities/ActivityBadges";
import { formatTime, formatDateTime } from "../Activities/activityUtils";
import ActivityDetailDrawer from "../Activities/ActivityDetailDrawer";
import ActivityFormModal from "../Activities/ActivityFormModal";

const TABS = [
  { key: "dueToday", label: "Due Today" },
  { key: "overdue", label: "Overdue" },
  { key: "upcoming", label: "Upcoming" },
  { key: "completed", label: "Recently Completed" },
];

export default function ActivitiesPanel({ buckets, allActivities }) {
  const dispatch = useDispatch();
  const [tab, setTab] = useState("dueToday");
  const [drawerState, setDrawerState] = useState(null); // { activity, initialAction }
  const [editActivity, setEditActivity] = useState(null);

  const list = buckets[tab] || [];

  const quickComplete = (activity) => (e) => {
    e.stopPropagation();
    dispatch(completeActivity({ id: activity._id, outcome: null })).then(() => dispatch(fetchActivities()));
  };

  return (
    <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <h2 className="font-semibold text-sm">Activities &amp; Follow-ups</h2>
        <Link to="/crm/activities" className="text-xs text-blue-400 hover:underline">View All Activities</Link>
      </div>
      <div className="flex gap-1 border-b border-gray-800 mb-3 overflow-x-auto" role="tablist" aria-label="Activity buckets">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
            className={`px-2.5 py-1.5 text-xs whitespace-nowrap ${tab === t.key ? "text-blue-400 border-b-2 border-blue-400 font-medium" : "text-gray-400 hover:text-gray-200"}`}>
            {t.label} ({(buckets[t.key] || []).length})
          </button>
        ))}
      </div>

      {list.length === 0 ? (
        <p className="text-sm text-gray-500 py-4 text-center">Nothing here right now.</p>
      ) : (
        <ul className="space-y-1.5 max-h-80 overflow-y-auto">
          {list.slice(0, 8).map((a) => (
            <li key={a._id}>
              <button onClick={() => setDrawerState({ activity: a, initialAction: null })}
                className="w-full flex items-center justify-between gap-2 bg-gray-800/40 hover:bg-gray-800/70 rounded-lg px-2.5 py-2 text-left focus:outline-none focus:ring-2 focus:ring-blue-500">
                <div className="flex items-center gap-2 min-w-0">
                  <TypeIcon type={a.type} size={14} />
                  <div className="min-w-0">
                    <p className="text-sm truncate">{a.title}</p>
                    <p className="text-[11px] text-gray-500 truncate">{a.relatedRecordLabel || "No related record"} · {a.ownerName || "Unassigned"} · {tab === "completed" ? formatDateTime(a.completedAt) : formatTime(a.startAt || a.dueDate)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <PriorityBadge priority={a.priority} />
                  <StatusBadge activity={a} status={a.status} />
                  {tab !== "completed" && (
                    <span onClick={quickComplete(a)} role="button" tabIndex={0} aria-label={`Mark ${a.title} complete`}
                      onKeyDown={(e) => { if (e.key === "Enter") quickComplete(a)(e); }}
                      title="Mark complete" className="text-gray-500 hover:text-emerald-400 p-0.5">
                      <CheckCircle2 size={15} />
                    </span>
                  )}
                  <span onClick={(e) => { e.stopPropagation(); setDrawerState({ activity: a, initialAction: "reschedule" }); }} role="button" tabIndex={0}
                    aria-label={`Reschedule ${a.title}`} onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); setDrawerState({ activity: a, initialAction: "reschedule" }); } }}
                    title="Reschedule" className="text-gray-500 hover:text-blue-400 p-0.5">
                    <CalendarClock size={15} />
                  </span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
      {list.length > 8 && <p className="text-[11px] text-gray-500 mt-2 text-center">Showing 8 of {list.length} — <Link to="/crm/activities" className="text-blue-400 hover:underline">view all</Link></p>}

      {editActivity && <ActivityFormModal activity={editActivity} onClose={() => setEditActivity(null)} onSaved={() => dispatch(fetchActivities())} />}
      {drawerState && (
        <ActivityDetailDrawer
          activity={allActivities.find((a) => a._id === drawerState.activity._id) || drawerState.activity}
          initialAction={drawerState.initialAction}
          onClose={() => setDrawerState(null)}
          onEdit={() => { setEditActivity(drawerState.activity); setDrawerState(null); }}
          onOpenActivity={(a) => setDrawerState({ activity: a, initialAction: null })}
        />
      )}
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { MoreHorizontal, CalendarClock } from "lucide-react";
import { effectiveStatus } from "../../../redux/crm/activitiesSlice";
import { TypeIcon, StatusBadge, PriorityBadge, ReminderIndicator } from "./ActivityBadges";
import { formatTime } from "./activityUtils";

function bucketOf(activity, now, startOfToday, startOfTomorrow, endOfWeek) {
  if (effectiveStatus(activity) === "Overdue") return "Overdue";
  const ref = activity.dueDate || activity.startAt;
  if (!ref) return "Later";
  const d = new Date(ref);
  if (d >= startOfToday && d < startOfTomorrow) return "Today";
  const startOfDayAfterTomorrow = new Date(startOfTomorrow.getTime() + 86400000);
  if (d >= startOfTomorrow && d < startOfDayAfterTomorrow) return "Tomorrow";
  if (d >= startOfDayAfterTomorrow && d < endOfWeek) return "This week";
  return "Later";
}

const BUCKET_ORDER = ["Overdue", "Today", "Tomorrow", "This week", "Later"];
const BUCKET_STYLES = {
  Overdue: "text-red-300",
  Today: "text-blue-300",
  Tomorrow: "text-violet-300",
  "This week": "text-gray-300",
  Later: "text-gray-400",
};

export default function AgendaView({ activities, onOpen, onQuickAction, onCreateActivity }) {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfTomorrow = new Date(startOfToday.getTime() + 86400000);
  const endOfWeek = new Date(startOfToday.getTime() + 7 * 86400000);

  const buckets = BUCKET_ORDER.reduce((acc, b) => ({ ...acc, [b]: [] }), {});
  for (const a of activities) buckets[bucketOf(a, now, startOfToday, startOfTomorrow, endOfWeek)].push(a);

  if (activities.length === 0) {
    return (
      <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-12 text-center text-gray-400">
        <CalendarClock size={24} className="mx-auto mb-2 text-gray-600" />
        <p className="mb-3">No activities to show.</p>
        <button onClick={onCreateActivity} className="text-blue-400 hover:underline text-sm">Create Activity</button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {BUCKET_ORDER.filter((b) => buckets[b].length > 0).map((bucket) => (
        <div key={bucket}>
          <h2 className={`text-sm font-semibold uppercase tracking-wide mb-2 ${BUCKET_STYLES[bucket]}`}>
            {bucket} <span className="text-gray-500 font-normal">({buckets[bucket].length})</span>
          </h2>
          <div className="bg-gray-900/40 border border-gray-800 rounded-xl divide-y divide-gray-800">
            {buckets[bucket].map((activity) => (
              <AgendaRow key={activity._id} activity={activity} overdue={bucket === "Overdue"} onOpen={onOpen} onQuickAction={onQuickAction} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function AgendaRow({ activity, overdue, onOpen, onQuickAction }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onDocClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setMenuOpen(false); };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [menuOpen]);

  const isTerminal = ["Completed", "Cancelled"].includes(activity.status);
  const items = [
    { label: "Open details", action: () => onOpen(activity) },
    !isTerminal && { label: "Mark complete", action: () => onQuickAction(activity, "complete") },
    !isTerminal && { label: "Reschedule", action: () => onQuickAction(activity, "reschedule") },
    { label: "Add follow-up", action: () => onQuickAction(activity, "followup") },
    !isTerminal && { label: "Edit", action: () => onQuickAction(activity, "edit") },
    !isTerminal && { label: "Cancel", action: () => onQuickAction(activity, "cancel") },
  ].filter(Boolean);

  const reference = activity.dueDate || activity.startAt;

  return (
    <div className={`flex items-center gap-3 px-4 py-3 hover:bg-gray-800/40 ${overdue ? "border-l-2 border-red-500/60" : ""}`}>
      <button onClick={() => onOpen(activity)} className="flex items-center gap-3 flex-1 min-w-0 text-left">
        <div className="w-8 h-8 rounded-full bg-gray-800 flex items-center justify-center shrink-0"><TypeIcon type={activity.type} size={14} className="text-blue-400" /></div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate">{activity.title}</p>
          <p className="text-xs text-gray-500 truncate">{activity.relatedRecordLabel || "No related record"} {activity.ownerName ? `· ${activity.ownerName}` : "· Unassigned"}</p>
        </div>
      </button>
      <span className={`text-xs whitespace-nowrap hidden sm:block ${overdue ? "text-red-300 font-medium" : "text-gray-400"}`}>{formatTime(reference)}</span>
      <span className="hidden md:block"><PriorityBadge priority={activity.priority} /></span>
      <span className="hidden lg:block"><StatusBadge activity={activity} /></span>
      <span className="hidden lg:block"><ReminderIndicator reminder={activity.reminder} /></span>
      <div className="relative" ref={ref}>
        <button onClick={() => setMenuOpen((v) => !v)} aria-label={`Actions for ${activity.title}`} aria-haspopup="menu" aria-expanded={menuOpen} className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white">
          <MoreHorizontal size={16} />
        </button>
        {menuOpen && (
          <div role="menu" className="absolute right-0 mt-1 bg-gray-900 border border-gray-800 rounded-lg py-1 z-20 w-40 shadow-xl text-left">
            {items.map((item) => (
              <button key={item.label} role="menuitem" onClick={() => { item.action(); setMenuOpen(false); }} className="w-full text-left text-sm px-3 py-1.5 hover:bg-gray-800">{item.label}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

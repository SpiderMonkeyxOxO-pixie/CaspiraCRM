import {
  AlertTriangle, CheckCircle2, XCircle, Clock, PhoneMissed, Bell, RefreshCcw, StickyNote,
} from "lucide-react";
import { effectiveStatus } from "../../../redux/crm/activitiesSlice";
import { TYPE_ICONS } from "./activityUtils";

export function TypeIcon({ type, size = 14, className = "" }) {
  const Icon = TYPE_ICONS[type] || StickyNote;
  return <Icon size={size} className={className} aria-hidden="true" />;
}

const STATUS_CONFIG = {
  Scheduled: { color: "bg-blue-500/15 text-blue-300 border-blue-500/30", icon: Clock },
  "In Progress": { color: "bg-violet-500/15 text-violet-300 border-violet-500/30", icon: RefreshCcw },
  Completed: { color: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30", icon: CheckCircle2 },
  Cancelled: { color: "bg-gray-500/15 text-gray-300 border-gray-500/30", icon: XCircle },
  Missed: { color: "bg-red-500/15 text-red-300 border-red-500/30", icon: PhoneMissed },
  // Overdue is intentionally NOT communicated by color alone — icon + label together.
  Overdue: { color: "bg-amber-500/15 text-amber-300 border-amber-500/30", icon: AlertTriangle },
};

export function StatusBadge({ activity, status }) {
  const value = status || effectiveStatus(activity);
  const config = STATUS_CONFIG[value] || STATUS_CONFIG.Scheduled;
  const Icon = config.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs border ${config.color}`}>
      <Icon size={12} />
      {value}
    </span>
  );
}

const PRIORITY_COLORS = {
  Low: "bg-gray-500/15 text-gray-300 border-gray-500/30",
  Medium: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  High: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  Urgent: "bg-red-500/15 text-red-300 border-red-500/30",
};
export function PriorityBadge({ priority }) {
  return <span className={`px-2 py-1 rounded-full text-xs border ${PRIORITY_COLORS[priority] || PRIORITY_COLORS.Medium}`}>{priority}</span>;
}

export function ReminderIndicator({ reminder }) {
  if (!reminder?.enabled) return <span className="text-gray-600" title="No reminder set">—</span>;
  return (
    <span className="inline-flex items-center gap-1 text-amber-300" title={`Reminder ${reminder.minutesBefore} minutes before`}>
      <Bell size={12} /> {reminder.minutesBefore}m
    </span>
  );
}

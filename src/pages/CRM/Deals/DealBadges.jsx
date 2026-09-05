import { Trophy, XCircle, PauseCircle, Circle, HeartPulse, AlertTriangle, ShieldAlert, Clock } from "lucide-react";

const STAGE_COLORS = {
  Discovery: "bg-gray-500/15 text-gray-300 border-gray-500/30",
  Qualified: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  Proposal: "bg-indigo-500/15 text-indigo-300 border-indigo-500/30",
  Negotiation: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  Approval: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  Won: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  Lost: "bg-red-500/15 text-red-300 border-red-500/30",
  Cancelled: "bg-gray-500/15 text-gray-400 border-gray-500/30",
  "On Hold": "bg-orange-500/15 text-orange-300 border-orange-500/30",
};
export function StageBadge({ stage }) {
  return <span className={`px-2 py-1 rounded-full text-xs border ${STAGE_COLORS[stage] || STAGE_COLORS.Discovery}`}>{stage}</span>;
}

const STATUS_CONFIG = {
  Open: { color: "bg-blue-500/15 text-blue-300 border-blue-500/30", icon: Circle },
  Won: { color: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30", icon: Trophy },
  Lost: { color: "bg-red-500/15 text-red-300 border-red-500/30", icon: XCircle },
  Cancelled: { color: "bg-gray-500/15 text-gray-400 border-gray-500/30", icon: XCircle },
  "On Hold": { color: "bg-orange-500/15 text-orange-300 border-orange-500/30", icon: PauseCircle },
};
export function DealStatusBadge({ status }) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.Open;
  const Icon = config.icon;
  return <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs border ${config.color}`}><Icon size={12} /> {status}</span>;
}

const PRIORITY_COLORS = {
  Low: "bg-gray-500/15 text-gray-300 border-gray-500/30",
  Medium: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  High: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  Urgent: "bg-red-500/15 text-red-300 border-red-500/30",
};
export function DealPriorityBadge({ priority }) {
  return <span className={`px-2 py-1 rounded-full text-xs border ${PRIORITY_COLORS[priority] || PRIORITY_COLORS.Medium}`}>{priority}</span>;
}

const HEALTH_CONFIG = {
  Healthy: { color: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30", icon: HeartPulse, fallback: "Active engagement" },
  "Needs Attention": { color: "bg-amber-500/15 text-amber-300 border-amber-500/30", icon: AlertTriangle, fallback: "No recent activity" },
  "At Risk": { color: "bg-red-500/15 text-red-300 border-red-500/30", icon: ShieldAlert, fallback: "This deal is at risk" },
  Stalled: { color: "bg-gray-500/15 text-gray-300 border-gray-500/30", icon: Clock, fallback: "No activity for an extended period" },
};
// Deal health is always shown with its reason — never an unexplained state
// or bare color, same convention as Companies' HealthBadge.
export function DealHealthBadge({ health, reason, showReason = false }) {
  const config = HEALTH_CONFIG[health] || HEALTH_CONFIG.Healthy;
  const Icon = config.icon;
  const explanation = reason || config.fallback;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs border ${config.color}`} title={explanation}>
      <Icon size={12} /> {health}
      {showReason && <span className="text-[11px] opacity-80">· {explanation}</span>}
    </span>
  );
}

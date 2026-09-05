import { HeartPulse, AlertTriangle, ShieldAlert, MinusCircle } from "lucide-react";

const HEALTH_CONFIG = {
  Healthy: { color: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30", icon: HeartPulse, fallbackReason: "Active engagement" },
  "Needs Attention": { color: "bg-amber-500/15 text-amber-300 border-amber-500/30", icon: AlertTriangle, fallbackReason: "No activity for 30 days" },
  "At Risk": { color: "bg-red-500/15 text-red-300 border-red-500/30", icon: ShieldAlert, fallbackReason: "Multiple overdue tickets" },
  Inactive: { color: "bg-gray-500/15 text-gray-300 border-gray-500/30", icon: MinusCircle, fallbackReason: "No recent activity" },
};

// Account health is always shown with its reason — never an unexplained
// score or bare color. The reason is a tooltip (title attribute) plus
// visible on the detail page's full health panel.
export default function HealthBadge({ health, reason, showReason = false }) {
  const config = HEALTH_CONFIG[health] || HEALTH_CONFIG.Healthy;
  const Icon = config.icon;
  const explanation = reason || config.fallbackReason;
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs border ${config.color}`}
      title={explanation}
    >
      <Icon size={12} />
      {health}
      {showReason && <span className="text-[11px] opacity-80">· {explanation}</span>}
    </span>
  );
}

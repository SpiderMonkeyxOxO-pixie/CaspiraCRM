// Returns "breached" | "at-risk" | "on-track" | "met" for a given SLA deadline.
// "met" means the ticket was already resolved/closed before we need to worry about it.
export function getSlaStatus(deadline, isResolved) {
  if (isResolved) return "met";
  const now = Date.now();
  const dl = new Date(deadline).getTime();
  const diffMs = dl - now;
  if (diffMs < 0) return "breached";
  if (diffMs < 2 * 60 * 60 * 1000) return "at-risk"; // under 2 hours left
  return "on-track";
}

export const SLA_LABELS = {
  breached: "Overdue",
  "at-risk": "At Risk",
  "on-track": "On Track",
  met: "Met",
};

export const SLA_COLORS = {
  breached: "bg-red-500/15 text-red-300 border-red-500/30",
  "at-risk": "bg-amber-500/15 text-amber-300 border-amber-500/30",
  "on-track": "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  met: "bg-gray-500/15 text-gray-300 border-gray-500/30",
};

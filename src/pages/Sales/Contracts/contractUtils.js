// Pure formatting/display helpers for Contracts — reuses the Products &
// Services catalog's own money/date formatters and the Price Books percent
// formatter rather than re-implementing them.
export { formatMoney, formatDate, formatDateTime } from "../Products/catalogUtils";
export { formatPercent } from "../PriceBooks/priceBookUtils";

export const CONTRACT_STATUS_COLORS = {
  Draft: "bg-gray-500/15 text-gray-300 border-gray-500/30",
  "Pending Internal Review": "bg-blue-500/15 text-blue-300 border-blue-500/30",
  "Sent for Signature": "bg-amber-500/15 text-amber-300 border-amber-500/30",
  Signed: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  Expired: "bg-slate-500/15 text-slate-300 border-slate-500/30",
  Terminated: "bg-red-500/15 text-red-300 border-red-500/30",
  Cancelled: "bg-red-500/15 text-red-300 border-red-500/30",
  Archived: "bg-slate-500/15 text-slate-300 border-slate-500/30",
};

// The linear "happy path" — used to render the status-progression rail.
// Terminated/Cancelled are shown as alternative side-states, not steps.
export const CONTRACT_PROGRESSION = ["Draft", "Pending Internal Review", "Sent for Signature", "Signed"];
export const ALTERNATIVE_STATUSES = ["Expired", "Terminated", "Cancelled"];

// Statuses where "Edit Draft" is not offered — only Draft Contracts are
// directly editable; anything further along needs a status-transition
// action instead of silently rewriting an agreement already in flight.
export const LOCKED_FOR_EDIT_STATUSES = ["Pending Internal Review", "Sent for Signature", "Signed", "Expired", "Terminated", "Cancelled", "Archived"];

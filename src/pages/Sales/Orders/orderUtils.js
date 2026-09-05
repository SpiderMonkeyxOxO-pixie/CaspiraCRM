// Pure formatting/display helpers for Orders — reuses the Products &
// Services catalog's own money/date formatters and the Price Books percent
// formatter rather than re-implementing them.
export { formatMoney, formatDate, formatDateTime } from "../Products/catalogUtils";
export { formatPercent } from "../PriceBooks/priceBookUtils";

export const ORDER_STATUS_COLORS = {
  Draft: "bg-gray-500/15 text-gray-300 border-gray-500/30",
  "Pending Review": "bg-blue-500/15 text-blue-300 border-blue-500/30",
  Confirmed: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",
  Processing: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  "Partially Fulfilled": "bg-amber-500/15 text-amber-300 border-amber-500/30",
  Fulfilled: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  "On Hold": "bg-orange-500/15 text-orange-300 border-orange-500/30",
  Cancelled: "bg-red-500/15 text-red-300 border-red-500/30",
  Completed: "bg-emerald-600/20 text-emerald-300 border-emerald-600/40",
  Archived: "bg-slate-500/15 text-slate-300 border-slate-500/30",
};

// The linear "happy path" — used to render the status-progression rail.
// On Hold and Cancelled are shown as alternative side-states, not steps on
// this rail.
export const ORDER_PROGRESSION = ["Draft", "Pending Review", "Confirmed", "Processing", "Fulfilled", "Completed"];
export const ALTERNATIVE_STATUSES = ["On Hold", "Cancelled"];

// Statuses where "Edit Draft" is not offered — only Draft Orders are
// directly editable; anything further along needs a status-transition
// action instead of silently rewriting a confirmed commitment.
export const LOCKED_FOR_EDIT_STATUSES = ["Pending Review", "Confirmed", "Processing", "Partially Fulfilled", "Fulfilled", "On Hold", "Cancelled", "Completed", "Archived"];

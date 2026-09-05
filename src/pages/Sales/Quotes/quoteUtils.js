// Pure formatting/display helpers for Quotes — reuses the Products &
// Services catalog's own money/date formatters and the Price Books
// percent formatter rather than re-implementing them.
export { formatMoney, formatDate, formatDateTime } from "../Products/catalogUtils";
export { formatPercent } from "../PriceBooks/priceBookUtils";

export const QUOTE_STATUS_COLORS = {
  Draft: "bg-gray-500/15 text-gray-300 border-gray-500/30",
  "Internal Review": "bg-blue-500/15 text-blue-300 border-blue-500/30",
  "Approval Pending": "bg-amber-500/15 text-amber-300 border-amber-500/30",
  Approved: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  "Preview Sent": "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",
  "Preview Viewed": "bg-violet-500/15 text-violet-300 border-violet-500/30",
  "Preview Accepted": "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  "Preview Rejected": "bg-red-500/15 text-red-300 border-red-500/30",
  Expired: "bg-orange-500/15 text-orange-300 border-orange-500/30",
  Cancelled: "bg-slate-500/15 text-slate-300 border-slate-500/30",
  Superseded: "bg-slate-500/15 text-slate-300 border-slate-500/30",
};

export const APPROVAL_STATUS_COLORS = {
  "Not Required": "bg-gray-500/15 text-gray-300 border-gray-500/30",
  Pending: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  Approved: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  Rejected: "bg-red-500/15 text-red-300 border-red-500/30",
  "Changes Requested": "bg-orange-500/15 text-orange-300 border-orange-500/30",
};

// Statuses where "Edit" is not offered directly — a new version must be
// created instead, per "Do not overwrite an accepted or sent version
// directly."
export const LOCKED_FOR_EDIT_STATUSES = ["Preview Accepted", "Superseded", "Cancelled"];

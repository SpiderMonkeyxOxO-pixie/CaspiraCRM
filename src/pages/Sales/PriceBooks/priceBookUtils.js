// Pure formatting/display helpers for Price Books — reuses the Products &
// Services catalog's own money/date formatters rather than re-implementing
// them, per "reuse existing components."
export { formatMoney, formatDate, formatDateTime } from "../Products/catalogUtils";

export function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

export const PB_STATUS_COLORS = {
  Draft: "bg-gray-500/15 text-gray-300 border-gray-500/30",
  Scheduled: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  Active: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  Expired: "bg-orange-500/15 text-orange-300 border-orange-500/30",
  Inactive: "bg-slate-500/15 text-slate-300 border-slate-500/30",
  Archived: "bg-red-500/15 text-red-300 border-red-500/30",
};

export function scopeSummary(pb) {
  const bits = [];
  bits.push(pb.market && pb.market !== "Global" ? pb.market : "Global");
  if (pb.customerSegment) bits.push(pb.customerSegment);
  if (pb.salesChannel) bits.push(pb.salesChannel);
  if ((pb.companyIds || []).length > 0) bits.push(`${pb.companyIds.length} compan${pb.companyIds.length === 1 ? "y" : "ies"}`);
  return bits.join(" · ");
}

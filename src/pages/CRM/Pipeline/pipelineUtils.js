// Pure helpers for the Pipeline board — sorting, grouping and time-since
// formatting kept out of the components so this file can freely mix plain
// function/constant exports (same pattern as Deals/dealUtils.js).

export const SORT_OPTIONS = [
  { value: "expectedClosingDate", label: "Expected Closing Date" },
  { value: "value", label: "Deal Value" },
  { value: "weightedValue", label: "Weighted Value" },
  { value: "lastActivity", label: "Last Activity" },
  { value: "createdAt", label: "Date Created" },
  { value: "priority", label: "Priority" },
  { value: "company", label: "Company" },
  { value: "manual", label: "Manual Order" },
];

export const GROUP_OPTIONS = [
  { value: "", label: "No Grouping" },
  { value: "ownerName", label: "Owner" },
  { value: "assignedTeam", label: "Team" },
  { value: "dealHealth", label: "Health" },
  { value: "expectedCloseMonth", label: "Expected-Close Month" },
];

const PRIORITY_RANK = { Urgent: 0, High: 1, Medium: 2, Low: 3 };

export function formatAgo(iso) {
  if (!iso) return "No activity yet";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "just now";
  const days = Math.floor(ms / 86400000);
  if (days < 1) return "today";
  if (days === 1) return "1 day ago";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? "1 month ago" : `${months} months ago`;
}

export function expectedCloseMonthLabel(iso) {
  if (!iso) return "No date set";
  return new Date(iso).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

// Sorts one stage's deals. `manualOrder` is a Map<dealId, index>, used only
// for the "manual" option — anything missing from it sorts to the end.
export function sortDeals(deals, sortKey, { manualOrder, companyById, lastActivityById } = {}) {
  const arr = [...deals];
  switch (sortKey) {
    case "value":
      return arr.sort((a, b) => (b.value || 0) - (a.value || 0));
    case "weightedValue":
      return arr.sort((a, b) => (b.weightedValue || 0) - (a.weightedValue || 0));
    case "lastActivity":
      return arr.sort((a, b) => new Date(lastActivityById?.(b._id) || b.updatedAt) - new Date(lastActivityById?.(a._id) || a.updatedAt));
    case "createdAt":
      return arr.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    case "priority":
      return arr.sort((a, b) => (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9));
    case "company":
      return arr.sort((a, b) => (companyById?.(a.companyId)?.name || "").localeCompare(companyById?.(b.companyId)?.name || ""));
    case "manual":
      return arr.sort((a, b) => (manualOrder?.get(a._id) ?? 999999) - (manualOrder?.get(b._id) ?? 999999));
    case "expectedClosingDate":
    default:
      return arr.sort((a, b) => {
        if (!a.expectedClosingDate) return 1;
        if (!b.expectedClosingDate) return -1;
        return new Date(a.expectedClosingDate) - new Date(b.expectedClosingDate);
      });
  }
}

export function groupDeals(deals, groupKey) {
  if (!groupKey) return [{ key: null, label: null, deals }];
  const buckets = new Map();
  for (const d of deals) {
    const key = groupKey === "expectedCloseMonth" ? expectedCloseMonthLabel(d.expectedClosingDate) : (d[groupKey] || "Unassigned");
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(d);
  }
  return [...buckets.entries()].map(([key, list]) => ({ key, label: key, deals: list }));
}

export const DEFAULT_BOARD_SETTINGS = {
  density: "comfortable", // "comfortable" | "compact"
  visibleFields: { primaryContact: true, quoteAvailable: true, productsCount: true, priority: false, tags: false },
  showWeighted: true,
  showTotals: true,
  hideCollapsedStages: false,
  defaultSort: "expectedClosingDate",
  warningIndicators: true,
};

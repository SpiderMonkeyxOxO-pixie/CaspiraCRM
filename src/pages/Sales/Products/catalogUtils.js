// Pure formatting/display helpers for the Products & Services catalog —
// kept in their own module (not exported alongside a component) so
// react-refresh stays happy, matching the CRM Deals/dealUtils.js pattern.

export function formatMoney(amount, currency = "USD") {
  if (amount === null || amount === undefined || amount === "") return null;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: amount % 1 === 0 ? 0 : 2 }).format(amount);
  } catch {
    return `${currency} ${Number(amount).toLocaleString()}`;
  }
}

export function formatDate(iso) {
  return iso ? new Date(iso).toLocaleDateString() : "—";
}
export function formatDateTime(iso) {
  return iso ? new Date(iso).toLocaleString() : "—";
}

const INTERVAL_SUFFIX = {
  Weekly: "per week", Monthly: "per month", Quarterly: "per quarter",
  Semiannual: "per half-year", Annual: "per year", Custom: "per custom interval",
};

// Pricing must never be shown as a plain number — always with its currency,
// billing interval and unit, or an explicit "Custom Quote" label.
export function formatPricingLabel(item) {
  if (!item) return "—";
  if (item.billingModel === "Custom Quote") return "Custom Quote";
  if (item.billingModel === "Usage Based") {
    const unitPrice = item.usageConfig?.unitPrice;
    if (unitPrice === undefined || unitPrice === null) return "Usage-based — pricing not configured";
    const money = formatMoney(unitPrice, item.currency);
    return `${money} per ${(item.usageConfig?.billingUnit || item.unit || "unit").toLowerCase()}`;
  }
  if (item.standardPrice === null || item.standardPrice === undefined) return "Pricing not set";
  const money = formatMoney(item.standardPrice, item.currency);
  if (item.billingModel === "One Time") return `${money} one time`;
  if (item.billingModel === "Recurring") {
    const suffix = INTERVAL_SUFFIX[item.billingInterval] || "per interval";
    return `${money} ${suffix}`;
  }
  return money;
}

export function formatPriceOnly(item) {
  if (item.billingModel === "Custom Quote") return "Custom Quote";
  if (item.billingModel === "Usage Based") return formatMoney(item.usageConfig?.unitPrice, item.currency) ?? "—";
  return formatMoney(item.standardPrice, item.currency) ?? "—";
}

export const TYPE_COLORS = {
  Product: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  Service: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  Package: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  "Add-on": "bg-amber-500/15 text-amber-300 border-amber-500/30",
};

export const STATUS_COLORS = {
  Draft: "bg-gray-500/15 text-gray-300 border-gray-500/30",
  Active: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  Inactive: "bg-slate-500/15 text-slate-300 border-slate-500/30",
  Archived: "bg-red-500/15 text-red-300 border-red-500/30",
};

export const BILLING_MODEL_COLORS = {
  "One Time": "bg-gray-500/15 text-gray-300 border-gray-500/30",
  Recurring: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  "Usage Based": "bg-violet-500/15 text-violet-300 border-violet-500/30",
  "Custom Quote": "bg-amber-500/15 text-amber-300 border-amber-500/30",
};

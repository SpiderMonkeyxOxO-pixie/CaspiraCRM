// Formatting and style constants shared by the backend-mode Finance screens.
export const money = (amount, currency) =>
  amount === null || amount === undefined
    ? "—"
    : `${Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${currency ? ` ${currency}` : ""}`;

export const day = (value) => (value ? new Date(value).toLocaleDateString() : "—");

export const inputClass = "w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white";

export const buttonClass = {
  primary: "px-3 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-800 text-sm font-medium disabled:opacity-50",
  success: "px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-sm font-medium disabled:opacity-50",
  danger: "px-3 py-1.5 rounded-lg border border-red-700 text-red-300 hover:bg-red-900/30 text-sm disabled:opacity-50",
  ghost: "px-3 py-1.5 rounded-lg border border-gray-700 hover:bg-gray-800 text-sm disabled:opacity-50",
};

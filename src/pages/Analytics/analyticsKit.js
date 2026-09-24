// Helpers for Analytics & Reports (Backend Phase 12): access-gated data
// hooks, value formatting, range presets and button/input classes. (Kept apart
// from AnalyticsUi.jsx, which only exports components.)
import { useCallback, useEffect, useState } from "react";
import { BACKEND_ANALYTICS_MODE_ENABLED, analyticsErrorMessage } from "../../Helpers/backendAnalyticsClient";
import { useAnalyticsAccess } from "../../Helpers/analyticsAccess";

export { btn, btnPrimary, btnDanger, input } from "../Admin/aiBackend/aiKit";

// Whether the member's grants open a page (false until access has loaded),
// so pages never request data they aren't allowed to see.
export function useAllowed(requires = []) {
  const access = useAnalyticsAccess();
  if (!BACKEND_ANALYTICS_MODE_ENABLED || access.loading) return false;
  return requires.length === 0 || requires.some(([m, a]) => access.can(m, a));
}

// Loads data with a visible error (never silently empty). Nothing is
// requested while `enabled` is false.
export function useLoad(fn, deps = [], enabled = true) {
  const [state, setState] = useState({ data: null, error: null, loading: enabled });
  const load = useCallback(async () => {
    if (!enabled) return;
    setState((s) => ({ ...s, loading: true, error: null }));
    try { setState({ data: await fn(), error: null, loading: false }); } catch (e) { setState({ data: null, error: analyticsErrorMessage(e, "Couldn't load this page."), loading: false }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, enabled]);
  useEffect(() => { load(); }, [load]);
  return { ...state, reload: load };
}

// Runs an action, returning [run, busy, error, setError].
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const run = useCallback(async (fn, after) => {
    setBusy(true); setError(null);
    try { const out = await fn(); if (after) await after(out); return out; } catch (e) { setError(analyticsErrorMessage(e)); return null; } finally { setBusy(false); }
  }, []);
  return [run, busy, error, setError];
}

// ─── Formatting ───────────────────────────────────────────────────────────────
export function formatValue(value, unit, currency) {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  if (Number.isNaN(n)) return String(value);
  if (unit === "currency" || unit === "usd") {
    // Money arrives as exact decimal strings; format for display only.
    try { return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "USD", maximumFractionDigits: 2 }).format(n); } catch { return `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${currency || ""}`.trim(); }
  }
  if (unit === "percent") return `${n.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
  if (unit === "minutes") return n >= 120 ? `${(n / 60).toLocaleString(undefined, { maximumFractionDigits: 1 })} h` : `${n.toLocaleString(undefined, { maximumFractionDigits: 1 })} min`;
  if (unit === "hours") return `${n.toLocaleString(undefined, { maximumFractionDigits: 1 })} h`;
  if (unit === "ms") return `${Math.round(n).toLocaleString()} ms`;
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export const fmtDateTime = (v) => (v ? new Date(v).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

export const RANGE_PRESETS = [
  ["last_30_days", "Last 30 days"], ["last_90_days", "Last 90 days"], ["month", "This month"], ["last_month", "Last month"],
  ["quarter", "This quarter"], ["fiscal_quarter", "This fiscal quarter"], ["year", "This year"], ["fiscal_year", "This fiscal year"], ["custom", "Custom range"],
];

export const rangeParams = (v) => (v.preset === "custom" && v.from && v.to ? { from: v.from, to: v.to } : { range: v.preset === "custom" ? "last_30_days" : v.preset });
export const rangeBody = (v) => (v.preset === "custom" && v.from && v.to ? { from: v.from, to: v.to } : v.preset === "custom" ? "last_30_days" : v.preset);
export const DEFAULT_RANGE = { preset: "last_30_days", from: "", to: "", comparison: "previous_period", currencyMode: "base" };

// Helpers for the backend-mode AI Provider screens: button/input classes,
// data-loading hooks and formatters. (Kept apart from aiUi.jsx, which only
// exports components.)
import { useCallback, useEffect, useState } from "react";
import { aiErrorMessage } from "../../../Helpers/backendAiClient";

export const btn = "px-3 py-1.5 rounded-lg text-sm border border-gray-700 hover:bg-gray-800 text-gray-200 disabled:opacity-40";
export const btnPrimary = "px-3 py-1.5 rounded-lg text-sm bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-40";
export const btnDanger = "px-3 py-1.5 rounded-lg text-sm border border-red-800 text-red-300 hover:bg-red-500/10 disabled:opacity-40";
export const input = "bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white w-full";

// Loads data with a visible error (never silently empty).
export function useAiLoad(fn, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try { setState({ data: await fn(), error: null, loading: false }); } catch (e) { setState({ data: null, error: aiErrorMessage(e, "Couldn't load this page."), loading: false }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { load(); }, [load]);
  return { ...state, reload: load };
}

// Runs an action, returning [run, busy, error].
export function useAiAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const run = useCallback(async (fn, after) => {
    setBusy(true); setError(null);
    try { const out = await fn(); if (after) await after(out); return out; } catch (e) { setError(aiErrorMessage(e)); return null; } finally { setBusy(false); }
  }, []);
  return [run, busy, error, setError];
}

export const fmtDate = (v) => (v ? new Date(v).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
export const fmtCost = (v, currency = "USD") => (v === null || v === undefined ? "Cost unknown" : `≈ ${Number(v).toLocaleString(undefined, { maximumFractionDigits: 4 })} ${currency}`);
export const fmtInt = (v) => Number(v || 0).toLocaleString();


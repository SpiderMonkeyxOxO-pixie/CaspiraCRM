// Backend Phase 12 — organization calendars. Warehouse timestamps are UTC; a
// business date is the organization's local calendar date (Intl handles
// daylight-saving transitions). Fiscal periods come from the organization's
// fiscal-year start month; weeks from its week-start preference.
import prisma from "../../lib/prisma.js";

const fmtCache = new Map();
function dateFormatter(timeZone) {
  if (!fmtCache.has(timeZone)) {
    try { fmtCache.set(timeZone, new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })); }
    catch { fmtCache.set(timeZone, new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" })); }
  }
  return fmtCache.get(timeZone);
}

// "YYYY-MM-DD" for an instant in a time zone.
export const localYmd = (instant, timeZone = "UTC") => (instant ? dateFormatter(timeZone).format(new Date(instant)) : null);
// A @db.Date value (UTC midnight of the local calendar date).
export const toDateValue = (ymd) => (ymd ? new Date(`${ymd}T00:00:00.000Z`) : null);
export const businessDate = (instant, timeZone) => toDateValue(localYmd(instant, timeZone));
export const ymdOf = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
export const addDays = (ymd, n) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// UTC instant of local midnight at the start of a local date (DST-safe).
export function localMidnightUtc(ymd, timeZone = "UTC") {
  const guess = new Date(`${ymd}T00:00:00Z`);
  for (let i = 0; i < 3; i += 1) {
    const local = localYmd(guess, timeZone);
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(guess);
    const h = Number(parts.find((p) => p.type === "hour").value); const m = Number(parts.find((p) => p.type === "minute").value);
    const dayShift = local === ymd ? 0 : local < ymd ? 1 : -1;
    const adjust = dayShift * 86_400_000 - (h * 60 + m) * 60_000;
    if (!adjust) return guess;
    guess.setTime(guess.getTime() + adjust);
  }
  return guess;
}

export async function calendarFor(organizationId, db = prisma) {
  const existing = await db.analyticsFiscalCalendar.findUnique({ where: { organizationId } });
  if (existing) return existing;
  return refreshCalendar(organizationId, db);
}

// Derived from organization settings and Finance configuration.
export async function refreshCalendar(organizationId, db = prisma) {
  const [org, fin, fy] = await Promise.all([
    db.organization.findUnique({ where: { id: organizationId }, select: { settings: true } }),
    db.financeSettings.findUnique({ where: { organizationId }, select: { baseCurrency: true } }),
    db.fiscalYear.findFirst({ where: { organizationId }, orderBy: { startDate: "asc" }, select: { startDate: true } }),
  ]);
  const s = org?.settings || {};
  let timeZone = typeof s.timeZone === "string" ? s.timeZone : "UTC";
  try { new Intl.DateTimeFormat("en", { timeZone }); } catch { timeZone = "UTC"; }
  const data = {
    timeZone, baseCurrency: fin?.baseCurrency || "USD", fiscalYearStartMonth: fy ? new Date(fy.startDate).getUTCMonth() + 1 : Number(s.fiscalYearStartMonth) || 1,
    weekStart: Number(s.weekStart) === 0 ? 0 : 1, source: fy ? "finance_fiscal_year" : s.timeZone ? "organization_settings" : "default",
  };
  return db.analyticsFiscalCalendar.upsert({ where: { organizationId }, update: data, create: { organizationId, ...data } });
}

// Fiscal year label and quarter for a local date.
export function fiscalPeriod(ymd, startMonth = 1) {
  const [y, m] = ymd.split("-").map(Number);
  const offset = (m - startMonth + 12) % 12;
  const fiscalYear = m >= startMonth ? y : y - 1;
  return { fiscalYear: startMonth === 1 ? fiscalYear : fiscalYear + 1, fiscalQuarter: Math.floor(offset / 3) + 1, fiscalMonth: offset + 1 };
}

// Period helpers for comparisons (inclusive local dates).
export function periodRange(kind, today, cal) {
  const [y, m] = today.split("-").map(Number);
  const pad = (n) => String(n).padStart(2, "0");
  const lastDay = (yy, mm) => new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  if (kind === "month") return { from: `${y}-${pad(m)}-01`, to: today };
  if (kind === "last_month") { const d = new Date(Date.UTC(y, m - 2, 1)); const yy = d.getUTCFullYear(); const mm = d.getUTCMonth() + 1; return { from: `${yy}-${pad(mm)}-01`, to: `${yy}-${pad(mm)}-${pad(lastDay(yy, mm))}` }; }
  if (kind === "quarter" || kind === "fiscal_quarter") {
    const start = kind === "fiscal_quarter" ? cal.fiscalYearStartMonth : 1;
    const offset = (m - start + 12) % 12; const qStartMonthIndex = m - (offset % 3);
    const d = new Date(Date.UTC(y, qStartMonthIndex - 1, 1));
    return { from: d.toISOString().slice(0, 10), to: today };
  }
  if (kind === "year" || kind === "fiscal_year") {
    const start = kind === "fiscal_year" ? cal.fiscalYearStartMonth : 1;
    const yy = m >= start ? y : y - 1;
    return { from: `${yy}-${pad(start)}-01`, to: today };
  }
  if (kind === "last_30_days") return { from: addDays(today, -29), to: today };
  if (kind === "last_90_days") return { from: addDays(today, -89), to: today };
  return { from: addDays(today, -29), to: today };
}

// The comparison period of the same length immediately before, or a year earlier.
export function comparisonRange({ from, to }, mode = "previous_period") {
  if (mode === "previous_year") return { from: `${Number(from.slice(0, 4)) - 1}${from.slice(4)}`, to: `${Number(to.slice(0, 4)) - 1}${to.slice(4)}` };
  const days = Math.round((new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86_400_000) + 1;
  return { from: addDays(from, -days), to: addDays(from, -1) };
}

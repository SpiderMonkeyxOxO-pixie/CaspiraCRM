// Business-hours arithmetic for SLA clocks — pure functions, no database.
//
// A calendar is { timeZone, workingHours, holidays }:
//   timeZone      IANA name, e.g. "Asia/Manila" — never the browser's zone.
//   workingHours  { mon: [["09:00","12:00"],["13:00","17:00"]], ..., sun: [] }
//                 local wall-clock intervals; several per day allowed.
//   holidays      [{ date: "2026-12-25", name: "Christmas" }] — whole local days off.
//
// Local times are converted to UTC instants with the zone's offset AT THAT
// MOMENT, so daylight-saving changes are handled: an interval on a
// 23-hour DST day really is an hour shorter. A wall-clock time that doesn't
// exist (skipped by a spring-forward) resolves to the next valid instant.
// All inputs and outputs are Date objects (UTC instants).

export const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const MINUTE = 60_000;
const MAX_DAYS = 3 * 366; // safety bound for any single calculation

export function isValidTimeZone(timeZone) {
  if (typeof timeZone !== "string" || !timeZone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(0);
    return true;
  } catch {
    return false;
  }
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$|^24:00$/;
const toMin = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

// Returns an error message, or null when the calendar is valid.
export function validateCalendar({ timeZone, workingHours, holidays = [] }) {
  if (!isValidTimeZone(timeZone)) return "timeZone must be a valid IANA time zone (for example Asia/Manila).";
  if (!workingHours || typeof workingHours !== "object") return "workingHours is required.";
  let any = false;
  for (const [day, intervals] of Object.entries(workingHours)) {
    if (!WEEKDAYS.includes(day)) return `Unknown day "${day}" — use ${WEEKDAYS.join(", ")}.`;
    if (!Array.isArray(intervals)) return `${day} must be a list of [start, end] intervals.`;
    const sorted = [...intervals].sort((a, b) => String(a?.[0]).localeCompare(String(b?.[0])));
    let lastEnd = -1;
    for (const iv of sorted) {
      if (!Array.isArray(iv) || iv.length !== 2 || !HHMM.test(iv[0]) || !HHMM.test(iv[1])) return `${day}: intervals must be ["HH:MM", "HH:MM"].`;
      const [s, e] = [toMin(iv[0]), toMin(iv[1])];
      if (s >= e) return `${day}: ${iv[0]}–${iv[1]} ends before it starts.`;
      if (s < lastEnd) return `${day}: intervals overlap.`;
      lastEnd = e;
      any = true;
    }
  }
  if (!any) return "At least one working interval is required.";
  if (!Array.isArray(holidays)) return "holidays must be a list.";
  for (const h of holidays) if (!/^\d{4}-\d{2}-\d{2}$/.test(h?.date || "")) return 'holidays entries need a "date" in YYYY-MM-DD form.';
  return null;
}

// Offset (ms) of `timeZone` from UTC at the instant `utcMs`.
function offsetAt(utcMs, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

// Local wall-clock time in `timeZone` → UTC instant (ms).
export function zonedToUtc(year, month, day, minutes, timeZone) {
  const wall = Date.UTC(year, month - 1, day, 0, minutes);
  let utc = wall - offsetAt(wall, timeZone);
  // Re-check with the offset at the candidate instant (DST boundaries).
  const second = wall - offsetAt(utc, timeZone);
  if (second !== utc) utc = Math.max(utc, second);
  return utc;
}

// The local calendar date of an instant: { year, month, day, weekday, iso }.
export function localDate(utcMs, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" }).formatToParts(new Date(utcMs));
  const get = (t) => parts.find((p) => p.type === t).value;
  const year = Number(get("year"));
  const month = Number(get("month"));
  const day = Number(get("day"));
  return { year, month, day, weekday: get("weekday").slice(0, 3).toLowerCase(), iso: `${get("year")}-${get("month")}-${get("day")}` };
}

function nextLocalDay({ year, month, day }) {
  const d = new Date(Date.UTC(year, month - 1, day + 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

// Working intervals of one local day as UTC [start, end) pairs, sorted.
function dayIntervals(date, calendar, holidaySet) {
  const iso = `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
  if (holidaySet.has(iso)) return [];
  const weekday = WEEKDAYS[new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay()];
  return (calendar.workingHours[weekday] || [])
    .map(([s, e]) => [zonedToUtc(date.year, date.month, date.day, toMin(s), calendar.timeZone), zonedToUtc(date.year, date.month, date.day, toMin(e), calendar.timeZone)])
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);
}

// Walks working intervals from `startMs` forward, calling `visit(s, e)` for
// each clipped interval until it returns true.
function walk(startMs, calendar, visit) {
  const holidaySet = new Set((calendar.holidays || []).map((h) => h.date));
  let date = localDate(startMs, calendar.timeZone);
  for (let i = 0; i < MAX_DAYS; i++) {
    for (const [s, e] of dayIntervals(date, calendar, holidaySet)) {
      if (e <= startMs) continue;
      if (visit(Math.max(s, startMs), e)) return;
    }
    date = nextLocalDay(date);
  }
  throw new RangeError("Business-hours calculation exceeded three years — check the calendar.");
}

// `minutes` of working time after `start`. Without a calendar, plain
// elapsed minutes (24/7).
export function addBusinessMinutes(start, minutes, calendar = null) {
  const startMs = new Date(start).getTime();
  if (!calendar) return new Date(startMs + minutes * MINUTE);
  if (minutes <= 0) {
    // The next moment working time is running (or `start` itself if inside hours).
    let at = startMs;
    walk(startMs, calendar, (s) => { at = s; return true; });
    return new Date(at);
  }
  let remaining = minutes * MINUTE;
  let result = startMs;
  walk(startMs, calendar, (s, e) => {
    const available = e - s;
    if (remaining <= available) { result = s + remaining; return true; }
    remaining -= available;
    return false;
  });
  return new Date(result);
}

// Working minutes between two instants (0 if `to` is before `from`).
export function businessMinutesBetween(from, to, calendar = null) {
  const a = new Date(from).getTime();
  const b = new Date(to).getTime();
  if (b <= a) return 0;
  if (!calendar) return Math.floor((b - a) / MINUTE);
  let total = 0;
  walk(a, calendar, (s, e) => {
    if (s >= b) return true;
    total += Math.min(e, b) - s;
    return e >= b;
  });
  return Math.floor(total / MINUTE);
}

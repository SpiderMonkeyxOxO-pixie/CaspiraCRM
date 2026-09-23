import { describe, it, expect } from "vitest";
import { addBusinessMinutes, businessMinutesBetween, validateCalendar, zonedToUtc, isValidTimeZone } from "./businessHours.js";

const WEEK = (intervals) => ({ mon: intervals, tue: intervals, wed: intervals, thu: intervals, fri: intervals, sat: [], sun: [] });
const manila = { timeZone: "Asia/Manila", workingHours: WEEK([["09:00", "17:00"]]), holidays: [{ date: "2026-12-25", name: "Christmas" }] };
const newYork = { timeZone: "America/New_York", workingHours: { ...WEEK([["09:00", "17:00"]]), sun: [["00:00", "24:00"]] }, holidays: [] };

describe("business hours", () => {
  it("validates time zones, intervals and overlaps", () => {
    expect(isValidTimeZone("Asia/Manila")).toBe(true);
    expect(isValidTimeZone("Mars/Base")).toBe(false);
    expect(validateCalendar({ timeZone: "Nowhere/X", workingHours: WEEK([["09:00", "17:00"]]) })).toMatch(/IANA/);
    expect(validateCalendar({ timeZone: "UTC", workingHours: { mon: [["09:00", "12:00"], ["11:00", "14:00"]] } })).toMatch(/overlap/);
    expect(validateCalendar({ timeZone: "UTC", workingHours: { mon: [["17:00", "09:00"]] } })).toMatch(/ends before/);
    expect(validateCalendar(manila)).toBeNull();
  });

  it("counts only working time in the calendar's own zone (not the server's)", () => {
    // Friday 16:00 Manila (08:00Z) + 2 working hours → Monday 10:00 Manila (02:00Z).
    const due = addBusinessMinutes("2026-09-25T08:00:00Z", 120, manila);
    expect(due.toISOString()).toBe("2026-09-28T02:00:00.000Z");
  });

  it("skips holidays", () => {
    // Thursday 24 Dec 16:30 Manila + 1h → Christmas is off → Saturday/Sunday off → Mon 28 Dec 09:30.
    const due = addBusinessMinutes("2026-12-24T08:30:00Z", 60, manila);
    expect(due.toISOString()).toBe("2026-12-28T01:30:00.000Z");
  });

  it("supports several intervals a day (lunch break)", () => {
    const lunch = { timeZone: "UTC", workingHours: WEEK([["09:00", "12:00"], ["13:00", "17:00"]]) };
    // Monday 11:30 + 60 working minutes → 13:30 (the lunch hour doesn't count).
    expect(addBusinessMinutes("2026-09-28T11:30:00Z", 60, lunch).toISOString()).toBe("2026-09-28T13:30:00.000Z");
    expect(businessMinutesBetween("2026-09-28T11:30:00Z", "2026-09-28T13:30:00Z", lunch)).toBe(60);
  });

  it("handles daylight-saving changes", () => {
    // 2026-03-08 is a 23-hour day in New York (clocks go forward at 02:00).
    expect(zonedToUtc(2026, 3, 7, 0, "America/New_York")).toBe(Date.parse("2026-03-07T05:00:00Z"));
    expect(zonedToUtc(2026, 3, 9, 0, "America/New_York")).toBe(Date.parse("2026-03-09T04:00:00Z"));
    // Sunday is a 24h working day here; on the DST Sunday it only has 23 hours.
    expect(businessMinutesBetween("2026-03-08T05:00:00Z", "2026-03-09T04:00:00Z", newYork)).toBe(23 * 60);
  });

  it("without a calendar, counts plain elapsed minutes (24/7)", () => {
    expect(addBusinessMinutes("2026-09-28T23:30:00Z", 60).toISOString()).toBe("2026-09-29T00:30:00.000Z");
    expect(businessMinutesBetween("2026-09-28T00:00:00Z", "2026-09-28T02:00:00Z")).toBe(120);
  });
});

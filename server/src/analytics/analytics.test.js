import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { localYmd, businessDate, fiscalPeriod, periodRange, comparisonRange, localMidnightUtc } from "./common/calendar.js";
import { converterFor, UNAVAILABLE_NOTE } from "./common/currency.js";
import { zonedTimeToUtc, nextRunAfter } from "./reports/scheduleService.js";
import { neutralize, toCsv, toXlsx, toPdf, toJson, zipStore } from "./exports/formats.js";
import { validateRequest, resolveRange, canReadMetric, scopeFor, scopeSql, comparisonOf, QueryError } from "./query/queryService.js";
import { METRICS, METRIC_BY_KEY, TABLES, DASHBOARDS, metricKeysForSource, definitionPayload } from "./metrics/definitions.js";
import { SOURCES } from "./warehouse/sources.js";
import { canRead } from "./reports/reportService.js";
import { tableFromResult } from "./exports/exportService.js";

const grants = (list) => [{ role: { key: "custom", defaultScope: "Own", permissionGrants: list.map(([moduleId, ...actions]) => ({ moduleId, actions })) } }];
const req = (list, { scope = "Own", team = null, department = null, id = "m-1" } = {}) => ({
  organizationId: "org-1", user: { id: "u-1", team, department }, isSystemOwnerOverride: false,
  membership: { id, roles: grants(list).map((r) => ({ role: { ...r.role, defaultScope: scope } })) },
});
const sqlText = (s) => s.strings.join("?");

describe("organization calendar", () => {
  it("business dates use the organization's local date, across midnight and DST", () => {
    const instant = new Date("2026-03-08T04:30:00Z"); // 23:30 on 7 March in New York
    expect(localYmd(instant, "America/New_York")).toBe("2026-03-07");
    expect(localYmd(instant, "Asia/Kolkata")).toBe("2026-03-08");
    expect(businessDate(instant, "America/New_York").toISOString()).toBe("2026-03-07T00:00:00.000Z");
    // Local midnight on a spring-forward day is still 05:00 UTC (EST).
    expect(localMidnightUtc("2026-03-08", "America/New_York").toISOString()).toBe("2026-03-08T05:00:00.000Z");
  });
  it("fiscal periods follow the organization's fiscal-year start month", () => {
    expect(fiscalPeriod("2026-03-15", 1)).toEqual({ fiscalYear: 2026, fiscalQuarter: 1, fiscalMonth: 3 });
    expect(fiscalPeriod("2026-03-15", 4)).toEqual({ fiscalYear: 2026, fiscalQuarter: 4, fiscalMonth: 12 });
    expect(fiscalPeriod("2026-04-01", 4)).toEqual({ fiscalYear: 2027, fiscalQuarter: 1, fiscalMonth: 1 });
  });
  it("period presets and comparison ranges", () => {
    const cal = { fiscalYearStartMonth: 4 };
    expect(periodRange("month", "2026-09-25", cal)).toEqual({ from: "2026-09-01", to: "2026-09-25" });
    expect(periodRange("last_month", "2026-03-10", cal)).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(periodRange("fiscal_year", "2026-09-25", cal)).toEqual({ from: "2026-04-01", to: "2026-09-25" });
    expect(periodRange("fiscal_quarter", "2026-09-25", cal)).toEqual({ from: "2026-07-01", to: "2026-09-25" });
    expect(comparisonRange({ from: "2026-09-01", to: "2026-09-10" })).toEqual({ from: "2026-08-22", to: "2026-08-31" });
    expect(comparisonRange({ from: "2026-09-01", to: "2026-09-10" }, "previous_year")).toEqual({ from: "2025-09-01", to: "2025-09-10" });
  });
});

describe("currency conversion", () => {
  const rates = [
    { baseCurrency: "USD", quoteCurrency: "EUR", rate: new Prisma.Decimal("0.9"), effectiveDate: new Date("2026-01-01T00:00:00Z"), version: 1 },
    { baseCurrency: "USD", quoteCurrency: "EUR", rate: new Prisma.Decimal("0.8"), effectiveDate: new Date("2026-06-01T00:00:00Z"), version: 2 },
    { baseCurrency: "GBP", quoteCurrency: "USD", rate: new Prisma.Decimal("1.25"), effectiveDate: new Date("2026-01-01T00:00:00Z"), version: 1 },
  ].sort((a, b) => b.effectiveDate - a.effectiveDate);
  const db = { analyticsExchangeRate: { findMany: async () => rates } };
  it("uses the rate effective on the business date (never today's rate for history)", async () => {
    const convert = await converterFor("org-1", "USD", db);
    expect(convert(90, "EUR", "2026-03-01").baseAmount.toString()).toBe("100");
    expect(convert(80, "EUR", "2026-07-01").baseAmount.toString()).toBe("100");
    expect(convert(80, "EUR", "2026-07-01").rateVersion).toBe(2);
  });
  it("supports inverse rates, same-currency and exact decimals", async () => {
    const convert = await converterFor("org-1", "USD", db);
    expect(convert(100, "GBP", "2026-02-01").baseAmount.toString()).toBe("125");
    expect(convert("0.1", "USD", "2026-02-01").baseAmount.add("0.2").toString()).toBe("0.3");
    expect(convert(5, "USD").conversionStatus).toBe("Same currency");
  });
  it("marks a missing rate unavailable instead of guessing", async () => {
    const convert = await converterFor("org-1", "USD", db);
    const r = convert(100, "JPY", "2026-02-01");
    expect(r).toMatchObject({ baseAmount: null, conversionStatus: "Unavailable" });
    expect(convert(90, "EUR", "2025-06-01").conversionStatus).toBe("Unavailable"); // before any rate
    expect(UNAVAILABLE_NOTE).toMatch(/unavailable/i);
  });
});

describe("report schedules (time zones and DST)", () => {
  it("wall-clock times stay put across daylight-saving changes", () => {
    expect(zonedTimeToUtc("2026-01-12", "08:30", "America/New_York").toISOString()).toBe("2026-01-12T13:30:00.000Z");
    expect(zonedTimeToUtc("2026-07-13", "08:30", "America/New_York").toISOString()).toBe("2026-07-13T12:30:00.000Z");
    expect(zonedTimeToUtc("2026-07-13", "08:30", "Asia/Kolkata").toISOString()).toBe("2026-07-13T03:00:00.000Z");
  });
  it("a skipped local time moves forward; a repeated time uses the first occurrence", () => {
    expect(zonedTimeToUtc("2026-03-08", "02:30", "America/New_York").toISOString()).toBe("2026-03-08T07:30:00.000Z"); // 03:30 EDT
    expect(zonedTimeToUtc("2026-11-01", "01:30", "America/New_York").toISOString()).toBe("2026-11-01T05:30:00.000Z"); // first 01:30 (EDT)
  });
  it("computes the next weekly, monthly and quarterly occurrence", () => {
    const after = new Date("2026-09-25T12:00:00Z"); // a Friday
    const weekly = nextRunAfter({ frequency: "weekly", dayOfWeek: 1, runAt: "09:00", timeZone: "Europe/London" }, after);
    expect(weekly.toISOString()).toBe("2026-09-28T08:00:00.000Z");
    const monthly = nextRunAfter({ frequency: "monthly", dayOfMonth: 1, runAt: "07:00", timeZone: "UTC" }, after);
    expect(monthly.toISOString()).toBe("2026-10-01T07:00:00.000Z");
    const quarterly = nextRunAfter({ frequency: "quarterly", dayOfMonth: 2, runAt: "07:00", timeZone: "UTC" }, after);
    expect(quarterly.toISOString()).toBe("2026-10-02T07:00:00.000Z");
    const daily = nextRunAfter({ frequency: "daily", runAt: "11:00", timeZone: "UTC" }, after);
    expect(daily.toISOString()).toBe("2026-09-26T11:00:00.000Z");
    expect(nextRunAfter({ frequency: "once", startDate: new Date("2026-01-01T00:00:00Z"), runAt: "08:00", timeZone: "UTC" }, after)).toBeNull();
  });
});

describe("export files", () => {
  const table = { title: "T", columns: ["Name", "Value"], rows: [["=HYPERLINK(\"http://x\")", "10.50"], ["+cmd", -5], ["@SUM(A1)", "ok"], ["plain, with comma", "-3.2"]], meta: [["Range", "2026-09-01 to 2026-09-25"]], watermark: "Exported for Tester" };
  it("neutralizes spreadsheet formulas but keeps numbers", () => {
    expect(neutralize("=1+1")).toBe("'=1+1");
    expect(neutralize("+cmd")).toBe("'+cmd");
    expect(neutralize("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(neutralize("-3.2")).toBe("-3.2");
    expect(neutralize(-5)).toBe("-5");
  });
  it("CSV escapes and carries the metadata", () => {
    const csv = toCsv(table).toString("utf8");
    expect(csv).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(csv).toContain(`"plain, with comma"`);
    expect(csv).toContain("# Range");
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });
  it("XLSX is a valid stored zip with inline strings (never formulas)", () => {
    const buf = toXlsx(table);
    expect(buf.subarray(0, 2).toString()).toBe("PK");
    expect(buf.readUInt32LE(buf.length - 22)).toBe(0x06054b50);
    const text = buf.toString("utf8");
    expect(text).not.toContain("<f>");
    expect(text).toContain("&apos;=HYPERLINK");
    expect(text).toContain("<v>10.50</v>");
  });
  it("zip entries carry correct CRC-32 values", () => {
    const zip = zipStore([{ name: "a.txt", data: Buffer.from("hello") }]);
    expect(zip.readUInt32LE(14)).toBe(0x3610a686); // CRC-32 of "hello"
  });
  it("PDF and JSON are well formed", () => {
    const pdf = toPdf(table).toString("latin1");
    expect(pdf.startsWith("%PDF-1.4")).toBe(true);
    expect(pdf.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(pdf).toContain("Exported for Tester");
    expect(JSON.parse(toJson(table).toString()).meta.Range).toBe("2026-09-01 to 2026-09-25");
  });
  it("tables from query results keep metric versions and the watermark", () => {
    const result = { range: { from: "2026-09-01", to: "2026-09-25" }, timeZone: "UTC", baseCurrency: "USD", disclaimer: "d", groupBy: null, grain: null, metrics: [{ key: "leads_created", name: "Leads created", unit: "count", value: 3, version: 2, comparison: null }] };
    const t = tableFromResult(result, { title: "X", requester: "Ann", generatedAt: "2026-09-25T00:00:00Z", versions: { leads_created: 2 } });
    expect(t.rows[0]).toEqual(["Leads created", 3, "count", "", "", "", "", 2]);
    expect(t.meta.find(([k]) => k === "Metric versions")[1]).toBe("leads_created@2");
    expect(t.watermark).toContain("Ann");
  });
});

describe("semantic query validation", () => {
  it("rejects SQL, unknown fields, unknown metrics and bad filters", () => {
    const code = (fn) => { try { fn(); } catch (e) { return e instanceof QueryError ? e.code : e.message; } return "accepted"; };
    expect(code(() => validateRequest({ metrics: ["leads_created"], sql: "select 1" }))).toBe("UNKNOWN_FIELDS");
    expect(code(() => validateRequest({ metrics: ["leads_created"], table: "users" }))).toBe("UNKNOWN_FIELDS");
    expect(code(() => validateRequest({ metrics: ["drop table"] }))).toBe("UNKNOWN_METRIC");
    expect(code(() => validateRequest({ metrics: [] }))).toBe("INVALID_QUERY");
    expect(code(() => validateRequest({ metrics: ["leads_created"], filters: [{ field: "status", op: "like", value: "%" }] }))).toBe("INVALID_FILTER");
    expect(code(() => validateRequest({ metrics: ["leads_created"], filters: [{ field: "status", value: { $ne: 1 } }] }))).toBe("INVALID_FILTER");
    expect(code(() => validateRequest({ metrics: ["leads_created"], grain: "second" }))).toBe("INVALID_GRAIN");
    expect(code(() => validateRequest({ metrics: METRICS.slice(0, 21).map((m) => m.key) }))).toBe("TOO_MANY_METRICS");
    expect(validateRequest({ metrics: ["leads_created"], limit: 10_000 }).limit).toBe(500);
  });
  it("enforces date-range limits", () => {
    const cal = { timeZone: "UTC", fiscalYearStartMonth: 1 };
    const now = new Date("2026-09-25T12:00:00Z");
    expect(resolveRange("last_30_days", cal, now)).toMatchObject({ from: "2026-08-27", to: "2026-09-25", days: 30 });
    expect(() => resolveRange({ from: "2020-01-01", to: "2026-01-01" }, cal, now)).toThrow(/limited/);
    expect(() => resolveRange({ from: "2026-02-01", to: "2026-01-01" }, cal, now)).toThrow(/starts after/);
    expect(() => resolveRange({ from: "1; drop", to: "2026-01-01" }, cal, now)).toThrow(/YYYY-MM-DD/);
    expect(() => resolveRange("forever", cal, now)).toThrow(/preset/);
  });
  it("metric access needs the domain grant; the overview grant exposes only non-sensitive overview metrics", () => {
    const sales = req([["analytics_sales", "read"]]);
    expect(canReadMetric(sales, "leads_created")).toBe(true);
    expect(canReadMetric(sales, "invoiced_amount")).toBe(false);
    const overview = req([["analytics_overview", "read"]]);
    expect(canReadMetric(overview, "leads_created")).toBe(false);
    expect(canReadMetric(overview, "leads_created", "overview")).toBe(true);
    expect(canReadMetric(overview, "invoiced_amount", "overview")).toBe(false);
    expect(canReadMetric(overview, "weighted_pipeline", "overview")).toBe(false); // not on the overview
  });
  it("record scope is applied before aggregation", () => {
    const own = scopeFor(req([["analytics_activities", "read"], ["activities", "view"]], { scope: "Own" }), "analytics_fact_activities");
    expect(own.level).toBe("Own");
    expect(sqlText(scopeSql(own, "analytics_fact_activities"))).toContain("\"ownerMembershipId\" = ? OR \"assignedMembershipId\" = ?");
    const team = scopeFor(req([["deals", "view"]], { scope: "Team", team: "North" }), "analytics_fact_deal_snapshots");
    expect(sqlText(scopeSql(team, "analytics_fact_deal_snapshots"))).toBe("\"team\" = ?");
    const org = scopeFor(req([["tickets", "view"]], { scope: "Organization" }), "analytics_fact_support");
    expect(sqlText(scopeSql(org, "analytics_fact_support"))).toBe("TRUE");
    // No grant on the source module → most restrictive (own records).
    expect(scopeFor(req([["analytics_sales", "read"]], { scope: "Organization" }), "analytics_fact_leads").level).toBe("Own");
    // Budgets have no owner: anything below organization scope sees nothing.
    const budget = scopeFor(req([["budgets", "view"]], { scope: "Team", team: "North" }), "analytics_fact_budgets");
    expect(sqlText(scopeSql(budget, "analytics_fact_budgets"))).toBe("FALSE");
    expect(scopeFor({ ...req([]), isSystemOwnerOverride: true }, "analytics_fact_leads").level).toBe("Organization");
  });
});

describe("metric definitions", () => {
  it("every metric is well formed and uses whitelisted tables, columns and dimensions", () => {
    const keys = new Set();
    for (const m of METRICS) {
      expect(keys.has(m.key)).toBe(false); keys.add(m.key);
      expect(m.definition && m.formula && m.module && m.unit && m.additivity).toBeTruthy();
      expect(["additive", "semi-additive", "non-additive"]).toContain(m.additivity);
      if (m.agg === "ratio") { expect(METRIC_BY_KEY[m.numerator]).toBeTruthy(); expect(METRIC_BY_KEY[m.denominator]).toBeTruthy(); continue; }
      expect(TABLES[m.table]).toBeTruthy();
      for (const [col] of m.where || []) expect(col).toMatch(/^[A-Za-z]+$/);
      expect((m.sources || []).every((s) => SOURCES[s] || ["deal_snapshots", "budgets", "snapshots"].includes(s))).toBe(true);
      expect(definitionPayload(m).sources).toEqual(m.sources);
    }
    for (const t of Object.values(TABLES)) for (const col of Object.values(t.dims)) expect(col).toMatch(/^[A-Za-z]+$/);
  });
  it("dashboards reference existing metrics in their own module (or finance metrics that need their grant)", () => {
    for (const [name, d] of Object.entries(DASHBOARDS)) {
      for (const k of d.metrics) expect(METRIC_BY_KEY[k], `${name}:${k}`).toBeTruthy();
      if (name !== "overview") for (const k of d.metrics) expect(METRIC_BY_KEY[k].module).toBe(d.module);
    }
  });
  it("financial metrics are sensitive; data-quality issues map sources to metrics", () => {
    for (const m of METRICS.filter((x) => x.module === "analytics_finance")) expect(m.sensitivity).toBe("sensitive");
    expect(metricKeysForSource("leads")).toEqual(expect.arrayContaining(["leads_created", "lead_conversion_rate"]));
  });
  it("source mappers produce organization-bound facts with a stable key", () => {
    const ctx = { tz: "UTC", base: "USD", convert: () => ({ baseAmount: new Prisma.Decimal(1), rateDate: null, rateVersion: null, conversionStatus: "Same currency" }), jobId: "j", now: new Date() };
    const lead = SOURCES.leads.map({ id: "l1", organizationId: "o1", createdAt: new Date("2026-09-01T10:00:00Z"), updatedAt: new Date(), status: "Converted", archived: false, email: "a@b.c", convertedAt: new Date("2026-09-02T10:00:00Z") }, ctx);
    expect(lead).toMatchObject({ organizationId: "o1", sourceId: "l1", converted: true, hasContactInfo: true, isDeleted: false });
    expect(lead).not.toHaveProperty("email");
    const inv = SOURCES.invoices.map({ id: "i1", organizationId: "o1", issueDate: new Date("2026-09-01T00:00:00Z"), status: "Void", total: "10", amountPaid: "0", amountDue: "10", currency: "USD", updatedAt: new Date() }, ctx);
    expect(inv).toMatchObject({ isDeleted: true, amount: "10" });
  });
});

describe("report visibility", () => {
  const report = (o) => ({ ownerMembershipId: "owner", visibility: "Private", team: null, department: null, ...o });
  it("private reports are visible only to their owner", () => {
    expect(canRead(req([["analytics_reports", "read_own"]], { id: "owner" }), report())).toBe(true);
    expect(canRead(req([["analytics_reports", "read_organization"]]), report())).toBe(false);
  });
  it("team, department and organization visibility need matching grants and membership", () => {
    const teamReport = report({ visibility: "Team", team: "North" });
    expect(canRead(req([["analytics_reports", "read_team"]], { team: "North" }), teamReport)).toBe(true);
    expect(canRead(req([["analytics_reports", "read_team"]], { team: "South" }), teamReport)).toBe(false);
    expect(canRead(req([["analytics_reports", "read_own"]], { team: "North" }), teamReport)).toBe(false);
    expect(canRead(req([["analytics_reports", "read_department"]], { department: "Sales" }), report({ visibility: "Department", department: "Sales" }))).toBe(true);
    expect(canRead(req([["analytics_reports", "read_organization"]]), report({ visibility: "Organization" }))).toBe(true);
    expect(canRead(req([["analytics_reports", "read_own"]]), report({ visibility: "Organization" }))).toBe(false);
  });
  it("explicit shares to a member or role grant access; no report grant means no access", () => {
    const r = report({ visibility: "Shared" });
    expect(canRead(req([["analytics_reports", "read_own"]], { id: "m-9" }), r, [{ targetType: "Membership", targetId: "m-9" }])).toBe(true);
    expect(canRead(req([["analytics_reports", "read_own"]]), r, [{ targetType: "Role", targetId: "custom" }])).toBe(true);
    expect(canRead(req([["analytics_sales", "read"]], { id: "m-9" }), r, [{ targetType: "Membership", targetId: "m-9" }])).toBe(false);
  });
});

describe("period comparisons", () => {
  const m = { current: false };
  it("labels zero and missing comparisons instead of inventing a percentage", () => {
    expect(comparisonOf(m, { value: 5 }, { value: 0 }, "p")).toMatchObject({ change: 5, changePercent: null, note: "New from zero." });
    expect(comparisonOf(m, { value: 0 }, { value: 0 }, "p")).toMatchObject({ change: 0, changePercent: null, note: "No change (both zero)." });
    expect(comparisonOf(m, { value: 5 }, { value: null }, "p")).toMatchObject({ change: null, note: "No prior-period value." });
    expect(comparisonOf(m, { value: 12 }, { value: 8 }, "p")).toMatchObject({ change: 4, changePercent: 50 });
    expect(comparisonOf(m, { value: "90.00" }, { value: "100.00" }, "p")).toMatchObject({ change: -10, changePercent: -10 });
    expect(comparisonOf({ current: true }, { value: 3 }, { value: 1 }, "p")).toMatchObject({ label: "Comparison unavailable", change: null });
  });
});

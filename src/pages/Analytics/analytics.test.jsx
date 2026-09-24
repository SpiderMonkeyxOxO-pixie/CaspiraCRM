import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const api = {};
const names = ["dashboard", "drilldown", "explainMetric", "listMetrics", "getReport", "createReport", "updateReport", "query", "listReports", "runReport", "listExports", "requestExport", "approveExport", "rejectExport", "revokeExport", "downloadExport", "listSchedules", "createSchedule", "getSchedule", "updateSchedule", "deleteSchedule", "warehouseStatus", "startWarehouseJob", "retryWarehouseJob", "refreshViews", "getMetric", "draftMetric", "publishMetric", "cloneReport", "archiveReport", "shareReport"];
for (const n of names) api[n] = vi.fn();
vi.mock("../../Helpers/backendAnalyticsClient", () => ({
  BACKEND_ANALYTICS_MODE_ENABLED: true,
  ...Object.fromEntries(names.map((n) => [n, (...a) => api[n](...a)])),
  analyticsErrorMessage: (e) => e?.message || "failed",
}));
let access = { loading: false, data: null };
vi.mock("../../Helpers/analyticsAccess", async () => {
  const actual = await vi.importActual("../../Helpers/analyticsAccess");
  return { ...actual, useAnalyticsAccess: () => ({ ...access, can: (m, a) => actual.analyticsCan(access.data, m, a) }) };
});

const { default: AnalyticsDashboard } = await import("./AnalyticsDashboard");
const { default: ReportBuilder } = await import("./ReportBuilder");
const { default: ExportsPage } = await import("./ExportsPage");
const { default: SchedulesPage } = await import("./SchedulesPage");
const { default: WarehousePage } = await import("./WarehousePage");
const { formatValue } = await import("./analyticsKit");
const { visibleAnalyticsPages } = await vi.importActual("../../Helpers/analyticsAccess");
const grants = (g, extra = {}) => ({ access: g, systemOwner: false, membershipId: "m-me", aiFeatures: false, ...extra });
const wrap = (el, path = "/") => render(<MemoryRouter initialEntries={[path]}><Routes><Route path="*" element={el} /></Routes></MemoryRouter>);

const fresh = { lastLoadedAt: "2026-09-25T08:00:00Z", stale: false, issues: [], targetMinutes: 60 };
const metric = (o) => ({ key: "leads_created", name: "Leads created", unit: "count", additivity: "additive", definition: "Leads created in the period.", version: 3, value: 12, comparison: { label: "2026-07-28 – 2026-08-26 (previous period)", value: 8, change: 4, changePercent: 50 }, freshness: fresh, ...o });

beforeEach(() => { for (const n of names) api[n].mockReset(); });

describe("Analytics navigation", () => {
  it("lists only the pages a member's grants open", () => {
    expect(visibleAnalyticsPages(grants({ analytics_sales: ["read"], analytics_reports: ["create", "read_own"], analytics_exports: ["basic"] })).map((p) => p.label))
      .toEqual(["Sales", "Reports", "Report Builder", "Exports"]);
    expect(visibleAnalyticsPages(grants({ leads: ["view"] }))).toHaveLength(0);
    expect(visibleAnalyticsPages(null)).toHaveLength(0);
    expect(visibleAnalyticsPages({ systemOwner: true, access: {} }).length).toBeGreaterThan(10);
  });
});

describe("value formatting", () => {
  it("formats governed values by unit without changing them", () => {
    expect(formatValue("12000.00", "currency", "USD")).toMatch(/12,000/);
    expect(formatValue(12.345, "percent")).toBe("12.3%");
    expect(formatValue(null, "count")).toBe("—");
    expect(formatValue(150, "minutes")).toBe("2.5 h");
  });
});

describe("Analytics dashboards", () => {
  it("refuses members without the dashboard grant", () => {
    access = { loading: false, data: grants({ analytics_activities: ["read"] }) };
    wrap(<AnalyticsDashboard name="finance" />);
    expect(screen.getByRole("alert").textContent).toMatch(/doesn't include access/);
    expect(api.dashboard).not.toHaveBeenCalled();
  });
  it("shows governed metrics with definition, freshness, comparison, currencies and hidden-metric notice", async () => {
    access = { loading: false, data: grants({ analytics_sales: ["read"] }) };
    api.dashboard.mockResolvedValue({
      dashboard: "sales", hiddenMetrics: 2, range: { from: "2026-08-27", to: "2026-09-25", days: 30 }, comparisonRange: { from: "2026-07-28", to: "2026-08-26" }, timeZone: "Europe/London", baseCurrency: "GBP",
      metrics: [metric(), metric({ key: "quotes_value", name: "Quoted value", unit: "currency", value: null, currency: null, byCurrency: [{ currency: "EUR", value: "100.00" }, { currency: "USD", value: "50.00" }], note: "Multiple currencies are shown separately and not added together.", comparison: null })],
      trend: { metric: "leads_created", grain: "day", series: [{ period: "2026-09-01", value: 2 }, { period: "2026-09-02", value: 5 }] },
      breakdown: null, disclaimer: "Operational analytics from the reporting warehouse — not audited financial statements.",
    });
    wrap(<AnalyticsDashboard name="sales" />);
    expect(await screen.findByText("Leads created")).toBeTruthy();
    expect(screen.getByText(/Time zone Europe\/London · Base currency GBP/)).toBeTruthy();
    expect(screen.getByText(/2 metrics are not shown for your role. Additional restricted information is available to authorized roles./)).toBeTruthy();
    expect(screen.getByText(/\+50%/)).toBeTruthy();
    expect(screen.getByText(/not added together/)).toBeTruthy();
    expect(within(screen.getByLabelText("Quoted value by currency")).getAllByRole("listitem")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Definition of Leads created" }));
    expect(screen.getByText("Leads created · v3")).toBeTruthy();
    // Chart has a text summary and a table alternative.
    expect(screen.getByText(/Highest 5 \(2026-09-02\)/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Show data table" })[0]);
    expect(screen.getByRole("rowheader", { name: "2026-09-02" })).toBeTruthy();
    expect(screen.getByText(/not audited financial statements/)).toBeTruthy();
  });
  it("drill-down lists only the records returned for the viewer", async () => {
    access = { loading: false, data: grants({ analytics_activities: ["read"] }) };
    api.dashboard.mockResolvedValue({ dashboard: "activities", hiddenMetrics: 0, range: { from: "2026-08-27", to: "2026-09-25" }, timeZone: "UTC", baseCurrency: "USD", metrics: [metric({ key: "activities_created", name: "Activities created" })] });
    api.drilldown.mockResolvedValue({ metric: "activities_created", range: { from: "2026-08-27", to: "2026-09-25" }, truncated: false, path: "/crm/activities", rows: [{ id: "act-1", date: "2026-09-20", status: "Completed" }] });
    wrap(<AnalyticsDashboard name="activities" />);
    fireEvent.click(await screen.findByRole("button", { name: "Show records behind Activities created" }));
    expect(await screen.findByText("act-1")).toBeTruthy();
    expect(api.drilldown).toHaveBeenCalledWith(expect.objectContaining({ metric: "activities_created" }));
    expect(screen.getByText(/records within your access/)).toBeTruthy();
  });
  it("AI explanations show the governed reference and fall back visibly", async () => {
    access = { loading: false, data: grants({ analytics_sales: ["read"] }, { aiFeatures: true }) };
    api.dashboard.mockResolvedValue({ dashboard: "sales", hiddenMetrics: 0, range: { from: "2026-08-27", to: "2026-09-25" }, timeZone: "UTC", baseCurrency: "USD", metrics: [metric()] });
    api.explainMetric.mockResolvedValue({ explanation: "Leads created was 12.", numbersVerified: false, usedDeterministicFallback: true, reference: { metric: "leads_created", version: 3, value: 12, range: { from: "2026-08-27", to: "2026-09-25" }, freshness: fresh }, disclaimer: "Every number comes from the metric engine." });
    wrap(<AnalyticsDashboard name="sales" />);
    fireEvent.click(await screen.findByRole("button", { name: "Explain Leads created with AI" }));
    expect(await screen.findByText("Leads created was 12.")).toBeTruthy();
    expect(screen.getByText("Showing the deterministic summary")).toBeTruthy();
    expect(screen.getByText("leads_created v3")).toBeTruthy();
  });
});

describe("Report builder", () => {
  const catalog = { metrics: [
    { key: "leads_created", name: "Leads created", module: "analytics_sales", status: "Published", accessible: true, dimensions: ["owner", "team", "status", "source"], definition: { definition: "Leads created." } },
    { key: "deals_won", name: "Deals won", module: "analytics_sales", status: "Published", accessible: true, dimensions: ["owner", "team", "stage"], definition: { definition: "Deals won." } },
    { key: "invoiced_amount", name: "Invoiced", module: "analytics_finance", status: "Published", accessible: false, dimensions: ["owner", "status"], definition: { definition: "Invoiced." } },
  ] };
  it("offers only accessible metrics and the dimensions every selected metric supports", async () => {
    access = { loading: false, data: grants({ analytics_reports: ["create", "read_own"], analytics_sales: ["read"] }) };
    api.listMetrics.mockResolvedValue(catalog);
    wrap(<ReportBuilder />);
    expect(await screen.findByText("Leads created")).toBeTruthy();
    expect(screen.queryByText("Invoiced")).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: /Leads created/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Deals won/ }));
    const groupBy = screen.getByRole("combobox", { name: "Group by" });
    expect([...groupBy.options].map((o) => o.value)).toEqual(["", "owner", "team"]);
    // Without the share grant, only private reports.
    expect([...screen.getByRole("combobox", { name: "Who can open it" }).options].map((o) => o.value)).toEqual(["Private"]);
  });
  it("saves a governed definition (never SQL)", async () => {
    access = { loading: false, data: grants({ analytics_reports: ["create", "read_own"], analytics_sales: ["read"] }) };
    api.listMetrics.mockResolvedValue(catalog);
    api.createReport.mockResolvedValue({ _id: "rpt_1" });
    wrap(<ReportBuilder />);
    fireEvent.change(await screen.findByRole("textbox", { name: "Name" }), { target: { value: "My leads" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Leads created/ }));
    fireEvent.change(screen.getByRole("combobox", { name: "Group by" }), { target: { value: "source" } });
    fireEvent.click(screen.getByRole("button", { name: "Save report" }));
    await waitFor(() => expect(api.createReport).toHaveBeenCalled());
    const body = api.createReport.mock.calls[0][0];
    expect(body).toEqual({ name: "My leads", description: "", visibility: "Private", definition: { metrics: ["leads_created"], groupBy: "source", grain: null, range: "last_30_days", comparison: "previous_period", currencyMode: "base", visualization: "table" } });
    expect(JSON.stringify(body)).not.toMatch(/select|from\s/i);
  });
});

describe("Exports", () => {
  const exp = (o) => ({ _id: "exp_1", status: "Ready", format: "csv", purpose: "Board pack", classification: "Internal", metrics: ["leads_created"], rowCount: 3, fileSize: 400, downloads: 0, downloadLimit: 5, expiresAt: "2026-10-01T00:00:00Z", createdAt: "2026-09-24T00:00:00Z", requestedByMembershipId: "m-me", ...o });
  it("requesters download their own files; they cannot approve their own sensitive export", async () => {
    access = { loading: false, data: grants({ analytics_exports: ["basic", "sensitive", "approve"], analytics_reports: ["read_own"] }) };
    api.listExports.mockResolvedValue({ exports: [exp(), exp({ _id: "exp_2", status: "Awaiting approval", classification: "Confidential", purpose: "Finance pack" }), exp({ _id: "exp_3", status: "Awaiting approval", classification: "Confidential", purpose: "Their pack", requestedByMembershipId: "m-other" })] });
    api.listReports.mockResolvedValue({ reports: [{ _id: "rpt_1", name: "Leads" }] });
    api.downloadExport.mockResolvedValue("leads.csv");
    wrap(<ExportsPage />);
    expect(await screen.findByText("Board pack")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Approve" })).toHaveLength(1); // only someone else's
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    expect(await screen.findByText("Downloaded leads.csv.")).toBeTruthy();
  });
  it("a purpose is required to request an export", async () => {
    access = { loading: false, data: grants({ analytics_exports: ["basic"], analytics_reports: ["read_own"] }) };
    api.listExports.mockResolvedValue({ exports: [] });
    api.listReports.mockResolvedValue({ reports: [{ _id: "rpt_1", name: "Leads" }] });
    wrap(<ExportsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Request export" }));
    const purpose = screen.getByRole("textbox", { name: /Purpose/ });
    expect(purpose.required).toBe(true);
    expect(screen.getByText(/Financial exports need approval from someone else/)).toBeTruthy();
  });
});

describe("Scheduled reports", () => {
  it("describes schedules in their time zone and requires recipients", async () => {
    access = { loading: false, data: grants({ analytics_reports: ["schedule", "read_own"] }) };
    api.listSchedules.mockResolvedValue({ schedules: [{ _id: "sch_1", reportName: "Weekly pipeline", frequency: "weekly", dayOfWeek: 1, runAt: "08:30", timeZone: "America/New_York", nextRunAt: "2026-09-28T12:30:00Z", recipients: [{ type: "Role", id: "team_leader" }], deliveryMethod: "in_app", format: "csv", active: true, ownerMembershipId: "m-me", version: 1 }] });
    api.listReports.mockResolvedValue({ reports: [{ _id: "rpt_1", name: "Weekly pipeline" }] });
    wrap(<SchedulesPage />);
    expect(await screen.findByText("Every Monday at 08:30 America/New_York")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "New schedule" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Send to me" }));
    fireEvent.click(screen.getByRole("button", { name: "Create schedule" }));
    expect(await screen.findByText("Add at least one recipient.")).toBeTruthy();
    expect(api.createSchedule).not.toHaveBeenCalled();
    expect(screen.queryByRole("option", { name: /attachment/i })).toBeNull();
  });
});

describe("Data warehouse", () => {
  it("shows sources, reconciliation and issues; rebuild is hidden without the rebuild grant", async () => {
    access = { loading: false, data: grants({ analytics_warehouse: ["monitor", "refresh"] }) };
    api.warehouseStatus.mockResolvedValue({ rebuildAllowed: true, sources: [{ source: "leads", snapshot: false, lastLoadedAt: "2026-09-25T08:00:00Z", watermark: "2026-09-25T07:59:00Z", lastStatus: "Completed", reconciliation: { status: "Passed" } }], jobs: [{ _id: "awj_1", source: "leads", jobType: "incremental", status: "Dead letter", attempts: 3, rowsRead: 0, rowsInserted: 0, rowsUpdated: 0, rowsRejected: 0, safeError: "The warehouse job failed." }], issues: [{ id: "i1", source: "invoices", issueType: "invalid_rate", severity: "Warning", summary: "2 invoices rows have no approved exchange rate for their date.", affectedCount: 2, status: "Open" }] });
    api.retryWarehouseJob.mockResolvedValue({});
    wrap(<WarehousePage />);
    expect(await screen.findByText("Passed")).toBeTruthy();
    expect(screen.getByText(/no approved exchange rate/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Rebuild…" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(api.retryWarehouseJob).toHaveBeenCalledWith("awj_1"));
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const api = {};
const names = ["governanceDashboard", "listKillSwitches", "activateKillSwitch", "deactivateKillSwitch", "listEvalRuns", "listEvalSuites", "getEvalRun", "monitoringSummary", "listAlerts", "listSafetyEvents", "governanceHealth", "measureSlos", "evaluateAlerts", "listCapabilities"];
for (const n of names) api[n] = vi.fn();
vi.mock("../../../Helpers/backendAiClient", () => ({
  BACKEND_AI_MODE_ENABLED: true,
  ...Object.fromEntries(names.map((n) => [n, (...a) => api[n](...a)])),
  aiErrorMessage: (e) => e?.message || "failed",
}));
let access = { loading: false, data: null };
vi.mock("../../../Helpers/aiAdminAccess", async () => {
  const actual = await vi.importActual("../../../Helpers/aiAdminAccess");
  return { ...actual, useAiAdminAccess: () => ({ ...access, can: (m, a) => actual.aiCan(access.data, m, a) }) };
});

const { default: GovernancePage } = await import("./GovernancePage");
const { default: EvaluationsPage } = await import("./EvaluationsPage");
const { default: MonitoringPage } = await import("./MonitoringPage");
const { visibleAiAdminPages } = await vi.importActual("../../../Helpers/aiAdminAccess");
const grants = (g) => ({ access: g, systemOwner: false });
const wrap = (el) => render(<MemoryRouter>{el}</MemoryRouter>);

beforeEach(() => { for (const n of names) api[n].mockReset(); });

describe("AI Administration navigation", () => {
  it("shows pages only for the grants a member has; ordinary members see none", () => {
    expect(visibleAiAdminPages(grants({ ai_capabilities: ["view"] }))).toHaveLength(0);
    expect(visibleAiAdminPages(grants({ ai_governance: ["read"], ai_monitoring: ["read"] })).map((p) => p.label)).toEqual(["Governance", "Monitoring", "Releases"]);
    expect(visibleAiAdminPages(null)).toHaveLength(0);
  });
});

describe("GovernancePage", () => {
  it("refuses members without governance access with a clear message", () => {
    access = { loading: false, data: grants({ ai_capabilities: ["view"] }) };
    wrap(<GovernancePage />);
    expect(screen.getByRole("alert").textContent).toMatch(/doesn't include access/);
  });
  it("shows statuses without an overall safety score", async () => {
    access = { loading: false, data: grants({ ai_governance: ["read"] }) };
    api.governanceDashboard.mockResolvedValue({ environment: "development", simulatorLabel: null, note: "Statuses are shown as recorded; there is no single overall safety score.", enablement: {}, capabilities: [{ key: "ai_copilot", name: "AI Copilot", riskLevel: "Moderate", status: "Approved", enabledForOrganization: true, killSwitch: false }], providers: [], models: { total: 1, approved: 1 }, prompts: { active: 5, pending: 0 }, tools: { active: 30, total: 37 }, workflows: { active: 6, total: 6 }, policies: [], evaluations: [], releases: [], activeIncidents: [], openReviews: 0, killSwitches: { active: 0 }, nextReviews: [] });
    wrap(<GovernancePage />);
    expect(await screen.findByText("AI Copilot")).toBeTruthy();
    expect(screen.getByText(/no single overall safety score/)).toBeTruthy();
    expect(screen.queryByText(/safety score:/i)).toBeNull();
  });
  it("a kill switch needs a written reason before it is activated", async () => {
    access = { loading: false, data: grants({ ai_governance: ["read"], ai_kill_switches: ["activate", "deactivate"] }) };
    api.governanceDashboard.mockResolvedValue({ environment: "development", note: "", enablement: {}, capabilities: [], providers: [], models: { total: 0, approved: 0 }, prompts: { active: 0, pending: 0 }, tools: { active: 0, total: 0 }, workflows: { active: 0, total: 0 }, policies: [], evaluations: [], releases: [], activeIncidents: [], openReviews: 0, killSwitches: { active: 0 }, nextReviews: [] });
    const orgSwitch = { _id: "ks-org", kind: "organization", target: "org-1", scope: "Organization", active: false };
    api.listKillSwitches.mockResolvedValue({ killSwitches: [orgSwitch], organizationSwitch: orgSwitch, kinds: ["global", "organization"], systemOwner: false });
    api.activateKillSwitch.mockResolvedValue({ killSwitch: { ...orgSwitch, active: true } });
    wrap(<GovernancePage />);
    fireEvent.click(await screen.findByRole("tab", { name: "Kill switches" }));
    fireEvent.click(await screen.findByRole("button", { name: "Activate" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Activate" }).at(-1));
    expect(await screen.findByText(/Write a reason/)).toBeTruthy();
    expect(api.activateKillSwitch).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "Suspected prompt injection" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Activate" }).at(-1));
    await waitFor(() => expect(api.activateKillSwitch).toHaveBeenCalledWith("ks-org", expect.objectContaining({ reason: "Suspected prompt injection" })));
  });
});

describe("EvaluationsPage", () => {
  it("shows gates with sample size and dataset versions", async () => {
    access = { loading: false, data: grants({ ai_gov_evaluations: ["read"] }) };
    api.listEvalRuns.mockResolvedValue({ runs: [{ _id: "aer_1", suiteId: "s1", candidate: { providerKey: "simulator" }, status: "Passed", passed: 20, sampleSize: 20, zeroToleranceFailures: 0, estimatedCost: 0, trigger: "manual", createdAt: new Date().toISOString() }] });
    api.listEvalSuites.mockResolvedValue({ suites: [{ id: "s1", key: "zero_tolerance_quick", version: 1 }], graders: [] });
    api.getEvalRun.mockResolvedValue({ run: { _id: "aer_1", status: "Passed", completedCases: 20, sampleSize: 20, estimatedCost: 0, gateResults: [{ key: "zero_tolerance", kind: "zero_tolerance", status: "Passed", sampleSize: 14, datasetVersions: ["zero_tolerance_core@1"] }] }, suite: { name: "Zero-tolerance quick suite", version: 1 }, results: [] });
    wrap(<EvaluationsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "aer_1" }));
    expect(await screen.findByText(/n=14/)).toBeTruthy();
    expect(screen.getByText(/zero_tolerance_core@1/)).toBeTruthy();
  });
});

describe("MonitoringPage", () => {
  it("never reports an SLO as met without data", async () => {
    access = { loading: false, data: grants({ ai_monitoring: ["read"] }) };
    api.monitoringSummary.mockResolvedValue({ metrics: { requests: { total: 0 }, activeUsers: 0, availability: null, errorRate: null, refusalRate: null, latency: {}, safety: { total: 0, bySeverity: {} }, cost: { estimated: 0, label: "Estimated — not a provider invoice" }, validationFailureRate: null, structuredValidityRate: null, copilot: { answers: 0, citationFailures: 0, lowConfidence: 0 }, tools: {}, retrieval: { indexLagMinutes: 0 }, approvals: {}, byProvider: [], byCapability: [] }, slos: [{ key: "gateway_availability", name: "AI Gateway availability", objective: 99, comparator: "gte", unit: "%", windowMinutes: 1440, latest: null }], privacy: { providerStorageMode: "Off", providerHostedInventory: { files: 0, conversations: 0, note: "" }, requestsByProvider7d: {}, redactedFields7d: 0, expiredPayloadsAwaitingDeletion: 0, productionEvaluationDatasets: 0 } });
    api.listAlerts.mockResolvedValue({ alerts: [] });
    api.listSafetyEvents.mockResolvedValue({ events: [] });
    api.governanceHealth.mockResolvedValue({ api: { status: "ok" } });
    wrap(<MonitoringPage />);
    expect(await screen.findByText("Not measured yet")).toBeTruthy();
    expect(screen.queryByText("Met")).toBeNull();
  });
});

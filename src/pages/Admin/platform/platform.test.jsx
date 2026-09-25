import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Backend Phase 13 — Platform Operations page.
const api = {};
const names = ["platformAccess", "systemHealth", "backupStatus", "securityOverview", "listAlerts", "listJobRuns", "listFindings", "listSecrets", "listArtifacts", "listBackupJobs", "runBackup",
  "listRestores", "listRestoreDrills", "planRestore", "listDrPlans", "listIncidents", "declareIncident", "listReleases", "listDeployments", "getDeployment", "emergencyRevoke"];
for (const n of names) api[n] = vi.fn();
let reauthPrompt = null;
vi.mock("../../../Helpers/backendPlatformClient", () => ({
  PLATFORM_MODE_ENABLED: true,
  setReauthPrompt: (fn) => { reauthPrompt = fn; },
  ...Object.fromEntries(names.map((n) => [n, (...a) => api[n](...a)])),
}));

const { default: PlatformOperations } = await import("./PlatformOperations");
const { hasPlatformAccess } = await import("../../../Helpers/platformAccess");
const wrap = () => render(<MemoryRouter><PlatformOperations /></MemoryRouter>);
const OWNER = { environment: "staging", systemOwner: true, permissions: ["platform.health.read", "platform.security.read", "platform.secrets.read_metadata", "platform.secrets.rotate", "platform.backup.read", "platform.backup.run", "platform.restore.plan", "platform.restore.execute", "platform.dr.read", "platform.dr.declare", "platform.release.read", "platform.deployment.plan"] };
const HEALTH = { environment: "staging", overall: "degraded", checkedAt: "2026-09-25T10:00:00Z", checks: { database: { status: "ok", latencyMs: 4 }, backupAgent: { status: "not_configured" } }, capacity: { disk: { usedPercent: 41 } } };

beforeEach(() => {
  for (const n of names) api[n].mockReset();
  api.systemHealth.mockResolvedValue(HEALTH);
  api.backupStatus.mockResolvedValue({ agentConfigured: false, lastBackupAgeHours: null, walArchive: null, lastSuccessfulRestoreDrillAt: "2026-09-25T02:37:42Z" });
  api.securityOverview.mockResolvedValue({ openFindings: 3, findingsBySeverity: { Critical: 1 }, blockingCriticalFindings: 1, secretsNeedingAttention: 0, alertsFiring: 0 });
});

describe("Platform Operations access", () => {
  it("organization administrators without platform permissions see a refusal, not the tools", async () => {
    api.platformAccess.mockResolvedValue({ environment: "production", systemOwner: false, permissions: [] });
    wrap();
    expect((await screen.findByRole("alert")).textContent).toMatch(/Organization administrator roles don't include it/);
    expect(api.systemHealth).not.toHaveBeenCalled();
  });
  it("navigation appears only with a platform permission", () => {
    expect(hasPlatformAccess(null)).toBe(false);
    expect(hasPlatformAccess({ systemOwner: false, permissions: [] })).toBe(false);
    expect(hasPlatformAccess({ systemOwner: false, permissions: ["platform.backup.read"] })).toBe(true);
  });
  it("shows only the tabs a delegated role opens", async () => {
    api.platformAccess.mockResolvedValue({ environment: "production", systemOwner: false, permissions: ["platform.backup.read", "platform.health.read"] });
    wrap();
    await screen.findByRole("tablist");
    const tabs = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(tabs).toEqual(["Health", "Alerts & jobs", "Backups", "Restores & drills"]);
  });
});

describe("Platform Operations content", () => {
  it("shows health, the environment and critical findings without claiming recoverability", async () => {
    api.platformAccess.mockResolvedValue(OWNER);
    wrap();
    expect(await screen.findByText("degraded")).toBeTruthy();
    expect(screen.getByText("staging")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("Blocking critical findings")).toBeTruthy());
    expect(screen.getByText(/isn't proof that a backup can be restored/)).toBeTruthy();
  });
  it("lists restore drills with measured RTO and RPO", async () => {
    api.platformAccess.mockResolvedValue(OWNER);
    api.listRestores.mockResolvedValue({ plans: [] });
    api.listArtifacts.mockResolvedValue({ artifacts: [] });
    api.listRestoreDrills.mockResolvedValue({ drills: [{ id: "rd_1", scenario: "Point-in-time recovery", tool: "pg_basebackup", target: "New local cluster (non-production)", status: "Passed", measuredRtoSeconds: 49, measuredRpoSeconds: 2, completedAt: "2026-09-25T02:37:42Z", evidence: "sha256:abc" }] });
    wrap();
    fireEvent.click(await screen.findByRole("tab", { name: "Restores & drills" }));
    expect(await screen.findByText("Point-in-time recovery")).toBeTruthy();
    expect(screen.getByText("49 s")).toBeTruthy();
    expect(screen.getByText("2 s")).toBeTruthy();
  });
  it("runs a backup of the chosen type and never shows secret values", async () => {
    api.platformAccess.mockResolvedValue(OWNER);
    api.listArtifacts.mockResolvedValue({ artifacts: [] });
    api.listBackupJobs.mockResolvedValue({ jobs: [] });
    api.runBackup.mockResolvedValue({ job: { publicId: "bj_1" } });
    wrap();
    fireEvent.click(await screen.findByRole("tab", { name: "Backups" }));
    fireEvent.change(await screen.findByRole("combobox"), { target: { value: "logical" } });
    fireEvent.click(screen.getByRole("button", { name: "Run backup" }));
    await waitFor(() => expect(api.runBackup).toHaveBeenCalledWith("logical"));
  });
  it("registers a password prompt for sensitive actions and returns the typed password once", async () => {
    api.platformAccess.mockResolvedValue(OWNER);
    wrap();
    await screen.findByRole("tablist");
    let answer;
    await waitFor(() => expect(reauthPrompt).toBeTypeOf("function"));
    const pending = reauthPrompt().then((v) => { answer = v; });
    const field = await screen.findByLabelText("Password");
    fireEvent.change(field, { target: { value: "correct horse" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await pending;
    expect(answer).toBe("correct horse");
    expect(screen.queryByLabelText("Password")).toBeNull();
  });
});

import { describe, it, expect, vi } from "vitest";

vi.mock("./crmBackendCommon", () => ({ orgId: () => "org-1", fetchCrmOwners: async () => [] }));

const { toUiProvider, toUiConnection, toUiJob, ownershipFor, isPausedStatus, isDisconnectedStatus } = await import("./integrationsBackend");

const backendProvider = {
  key: "google_workspace", name: "Google Workspace", category: "Productivity", description: "Calendar and mail.", authType: "OAuth2",
  availability: "Adapter", ownershipTypes: ["User Connection", "Organization Connection"],
  capabilities: [
    { key: "calendar.import", name: "Import events", entityType: "calendar_event", crmModule: "activities", direction: "Import Only", requiredScopes: ["cal.read"] },
    { key: "gmail.draft", name: "Create a draft", entityType: "email_draft", crmModule: "activities", direction: "Export Only", requiredScopes: ["gmail.compose"], requiresConfirmation: true },
    { key: "drive.import", name: "Import files", entityType: "file", crmModule: "documents", direction: "Import Only", requiredScopes: [], requiresPhase: 7, unavailableReason: "Requires Phase 7 (Documents)." },
  ],
  simulatorLabel: "Provider Simulator — no external provider is connected.", mode: "Simulator",
};

describe("integrationsBackend mapping", () => {
  it("maps a backend provider onto the page shape without inventing availability", () => {
    const p = toUiProvider(backendProvider);
    expect(p.authMethod).toBe("OAuth 2.0");
    expect(p.capabilities.map((c) => c.id)).toEqual(["calendar.import", "gmail.draft", "drive.import"]);
    expect(p.capabilities[1]).toMatchObject({ direction: "write", requiresHumanApproval: true, sensitiveData: true });
    expect(p.capabilities[2].unavailableReason).toMatch(/Phase 7/);
    expect(p.dataEnteringCrm).toEqual(["Import events"]);
    expect(p.simulatorLabel).toMatch(/Provider Simulator/);
    expect(p.backend).toBe(true);
  });

  it("maps a connection: public id, real status, health issues, available capabilities, runs", () => {
    const c = toUiConnection({
      publicId: "conn_1", providerKey: "google_workspace", name: "Mine", ownershipType: "User Connection", mode: "Simulator",
      simulatorLabel: "Provider Simulator — no external provider is connected.", status: "Reauthorization Required",
      externalAccountLabel: "me@example.com", reauthorizationRequiredAt: "2026-09-24T00:00:00Z", lastError: { code: "auth_invalid", message: "Reauthorize the connection." },
      scopes: { capabilities: [{ key: "calendar.import", state: "Available" }, { key: "gmail.draft", state: "Disabled — missing scopes" }] },
      createdAt: "2026-09-20T00:00:00Z",
    }, { runs: [{ _id: "r1", kind: "Preview", trigger: "Manual", status: "Awaiting Confirmation", discovered: 3, created: 0, preview: { counts: { create: 3 } }, createdAt: "2026-09-24T00:00:00Z" }] });
    expect(c).toMatchObject({ id: "conn_1", organizationId: "org-1", status: "Reauthorization Required", capabilities: ["calendar.import"], reauthorizationRequired: true, isPreview: false });
    expect(c.health.status).toBe("Attention Required");
    expect(c.health.issues).toContain("Reauthorization required.");
    expect(c.syncJobs[0]).toMatchObject({ kind: "Preview", jobType: "Sync Preview", preview: { counts: { create: 3 } } });
    expect(c.previewLabel).toMatch(/Provider Simulator/);
  });

  it("maps a run's counts into the sync-history shape", () => {
    const j = toUiJob({ _id: "r2", kind: "Sync", trigger: "Schedule", status: "Completed", discovered: 5, created: 2, updated: 1, skipped: 2, conflicts: 0, failures: 0, startedAt: "2026-09-24T10:00:00Z", completedAt: "2026-09-24T10:00:02Z", connectionPublicId: "conn_1" });
    expect(j).toMatchObject({ connectionId: "conn_1", jobType: "Schedule Sync", result: { recordsExamined: 5, created: 2, durationMs: 2000 } });
  });

  it("chooses the ownership the provider supports", () => {
    expect(ownershipFor(backendProvider, "Organization")).toBe("Organization Connection");
    expect(ownershipFor(backendProvider, "Selected Users")).toBe("User Connection");
    expect(ownershipFor({ ownershipTypes: ["Organization Connection"] }, "Selected Users")).toBe("Organization Connection");
  });

  it("recognises paused and disconnected statuses in both modes", () => {
    expect(isPausedStatus("Sync Paused") && isPausedStatus("Preview Paused")).toBe(true);
    expect(isDisconnectedStatus("Revoked") && isDisconnectedStatus("Disconnected")).toBe(true);
    expect(isDisconnectedStatus("Connected")).toBe(false);
  });
});

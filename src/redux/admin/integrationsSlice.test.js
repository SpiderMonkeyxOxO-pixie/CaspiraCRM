import { describe, it, expect, beforeEach } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import integrationsReducer, {
  fetchOrganizations, fetchProviders, fetchProvider, fetchConnections, fetchConnection,
  createConnectionPreview, pauseConnection, resumeConnection, disconnectConnection,
  undoDisconnectConnection, runPreviewSync, retryFailedSync, fetchActivity, fetchWebhooks,
  selectIntegrations,
} from "./integrationsSlice";
import authReducer from "../authSlice";

// Exercises the full round-trip through the REAL mock adapter (mockApi.js),
// same convention as accessManagementSlice.test.js — proves the fixture, the
// mock HTTP handlers and the Redux slice are all wired together correctly,
// including server-side organization-scoping enforcement.
function makeStore(role = "Super-Admin") {
  localStorage.setItem("role", role);
  localStorage.setItem("isLoggedIn", "true");
  return configureStore({
    reducer: { auth: authReducer, integrations: integrationsReducer },
    preloadedState: { auth: { role, isLoggedIn: true, data: {} } },
  });
}

describe("integrationsSlice — organizations", () => {
  beforeEach(() => localStorage.clear());

  it("reuses the shared organizations fixture (no duplicate data source)", async () => {
    const store = makeStore("Super-Admin");
    await store.dispatch(fetchOrganizations());
    expect(selectIntegrations(store.getState()).organizations).toHaveLength(3);
  });
});

describe("integrationsSlice — providers catalog (global, not org-scoped)", () => {
  beforeEach(() => localStorage.clear());

  it("loads the full 61-provider catalog (13 Phase 1 + 13 Phase 2 + 9 Phase 3 + 8 Phase 4 + 9 Phase 5 + 4 Phase 6 + 5 Phase 7) for any authorized role", async () => {
    const store = makeStore("Admin");
    await store.dispatch(fetchProviders());
    expect(selectIntegrations(store.getState()).providers).toHaveLength(61);
  });

  it("fetches a single provider by key", async () => {
    const store = makeStore("Super-Admin");
    await store.dispatch(fetchProvider("stripe"));
    expect(selectIntegrations(store.getState()).currentProvider.key).toBe("stripe");
  });

  it("404s for an unknown provider key", async () => {
    const store = makeStore("Super-Admin");
    const action = await store.dispatch(fetchProvider("not_a_real_provider"));
    expect(action.type).toBe(fetchProvider.rejected.type);
  });
});

describe("integrationsSlice — connection organization scoping", () => {
  beforeEach(() => localStorage.clear());

  it("System Owner sees connections from every organization", async () => {
    const store = makeStore("Super-Admin");
    await store.dispatch(fetchConnections());
    const orgIds = new Set(selectIntegrations(store.getState()).connections.map((c) => c.organizationId));
    expect(orgIds.size).toBeGreaterThan(1);
  });

  it("Organization Administrator only sees their own organization's connections, even requesting another org directly", async () => {
    const store = makeStore("Admin");
    await store.dispatch(fetchConnections({ organizationId: "org_nimbus_retail" }));
    const { connections } = selectIntegrations(store.getState());
    expect(connections.length).toBeGreaterThan(0);
    expect(connections.every((c) => c.organizationId === "org_caspira_hq")).toBe(true);
  });

  it("Organization Administrator cannot view a connection outside their organization", async () => {
    const store = makeStore("Admin");
    const action = await store.dispatch(fetchConnection("conn_6")); // belongs to org_nimbus_retail
    expect(action.type).toBe(fetchConnection.rejected.type);
  });

  it("System Owner can view any connection", async () => {
    const store = makeStore("Super-Admin");
    await store.dispatch(fetchConnection("conn_6"));
    expect(selectIntegrations(store.getState()).currentConnection.id).toBe("conn_6");
  });
});

describe("integrationsSlice — creating a preview connection", () => {
  beforeEach(() => localStorage.clear());

  it("creates a preview connection and never claims a real provider was contacted", async () => {
    const store = makeStore("Admin");
    const action = await store.dispatch(createConnectionPreview({ providerKey: "calendly", capabilities: ["cal_booking_links"] }));
    expect(action.payload.message).toBe("Preview connection created. No external provider was contacted.");
    expect(action.payload.connection.status).toBe("Preview Connected");
  });

  it("Organization Administrator cannot create a connection for another organization", async () => {
    const store = makeStore("Admin");
    const action = await store.dispatch(createConnectionPreview({ providerKey: "zoom", organizationId: "org_nimbus_retail" }));
    expect(action.type).toBe(createConnectionPreview.rejected.type);
  });
});

describe("integrationsSlice — connection lifecycle actions", () => {
  beforeEach(() => localStorage.clear());

  it("pauses and resumes a connection, updating the store", async () => {
    const store = makeStore("Super-Admin");
    await store.dispatch(pauseConnection("conn_1"));
    expect(selectIntegrations(store.getState()).connections.find((c) => c.id === "conn_1")?.status).toBe("Preview Paused");
    await store.dispatch(resumeConnection("conn_1"));
    expect(selectIntegrations(store.getState()).connections.find((c) => c.id === "conn_1")?.status).toBe("Preview Connected");
  });

  it("rejects disconnect with no reason before any request fires", async () => {
    const store = makeStore("Super-Admin");
    const action = await store.dispatch(disconnectConnection({ id: "conn_8", reason: "" }));
    expect(action.type).toBe(disconnectConnection.rejected.type);
  });

  it("disconnects with a reason and supports session Undo", async () => {
    const store = makeStore("Super-Admin");
    await store.dispatch(disconnectConnection({ id: "conn_8", reason: "Testing disconnect flow." }));
    expect(selectIntegrations(store.getState()).lastDisconnectedId).toBe("conn_8");

    await store.dispatch(undoDisconnectConnection("conn_8"));
    expect(selectIntegrations(store.getState()).lastDisconnectedId).toBeNull();
  });

  it("Organization Administrator cannot pause a connection outside their organization", async () => {
    const store = makeStore("Admin");
    const action = await store.dispatch(pauseConnection("conn_8")); // org_solstice_partners
    expect(action.type).toBe(pauseConnection.rejected.type);
  });
});

describe("integrationsSlice — preview synchronization", () => {
  beforeEach(() => localStorage.clear());

  it("runs a preview sync and stores a labeled result", async () => {
    const store = makeStore("Super-Admin");
    const action = await store.dispatch(runPreviewSync({ connectionId: "conn_1", jobType: "Manual Sync" }));
    expect(action.payload.job.label).toBe("Preview Synchronization");
  });

  it("retries a failed sync job", async () => {
    const store = makeStore("Super-Admin");
    const first = await store.dispatch(runPreviewSync({ connectionId: "conn_6", jobType: "Manual Sync" }));
    const action = await store.dispatch(retryFailedSync({ connectionId: "conn_6", jobId: first.payload.job.id }));
    expect(action.payload.job.jobType).toBe("Retry");
  });
});

describe("integrationsSlice — activity and webhooks", () => {
  beforeEach(() => localStorage.clear());

  it("Organization Administrator only sees their own organization's activity", async () => {
    const store = makeStore("Admin");
    await store.dispatch(fetchActivity());
    const { activity } = selectIntegrations(store.getState());
    expect(activity.length).toBeGreaterThan(0);
    expect(activity.every((e) => e.organizationId === "org_caspira_hq")).toBe(true);
  });

  it("Organization Administrator only sees their own organization's webhook previews", async () => {
    const store = makeStore("Admin");
    await store.dispatch(fetchWebhooks());
    const { webhooks } = selectIntegrations(store.getState());
    expect(webhooks.length).toBeGreaterThan(0);
    expect(webhooks.every((w) => w.organizationId === "org_caspira_hq")).toBe(true);
  });
});

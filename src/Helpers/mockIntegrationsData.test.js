import { describe, it, expect } from "vitest";
import {
  PROVIDERS, CONNECTIONS, WEBHOOK_PREVIEWS, AUDIT_EVENTS,
  findProvider, queryProvidersLocal, findConnection, queryConnectionsLocal,
  createConnectionPreview, pauseConnection, resumeConnection, disconnectConnection,
  undoDisconnectConnection, runPreviewSync, retryFailedSync, updateFieldMapping,
  queryWebhooksLocal, queryActivityLocal, computeIntegrationMetrics,
  createIntegrationConnection, createIntegrationProvider,
  FRONTEND_CONNECTION_PREVIEW_LABEL, FRONTEND_CONNECTION_PREVIEW_EXPLANATION,
  PREVIEW_CONNECTION_COMPLETE_MESSAGE, CREDENTIAL_PLACEHOLDER_TEXT, WEBHOOK_BACKEND_NOTICE,
  CONNECTION_STATUSES, CATEGORIES,
} from "./mockIntegrationsData";

describe("mockIntegrationsData: provider catalog", () => {
  it("has the 13 essential (Phase 1) + 13 Sales & Marketing (Phase 2) + 9 Support & Communication (Phase 3) + 8 Projects & Development (Phase 4) + 9 Commerce & Finance (Phase 5) + 4 Documents & Storage (Phase 6) + 5 AI Provider (Phase 7) providers", () => {
    expect(PROVIDERS).toHaveLength(61);
    const keys = PROVIDERS.map((p) => p.key);
    expect(keys).toEqual(expect.arrayContaining([
      "google_workspace", "microsoft_365", "slack", "whatsapp_business", "twilio",
      "calendly", "zoom", "stripe", "quickbooks_online", "xero", "docusign", "zapier", "make",
      "mailchimp", "brevo", "sendgrid", "amazon_ses", "resend", "meta_lead_ads", "google_ads",
      "linkedin_lead_gen", "tiktok_lead_gen", "google_analytics_4", "microsoft_clarity", "typeform", "google_forms",
      "zendesk", "freshdesk", "intercom", "facebook_messenger", "instagram_messaging",
      "telegram_bot_api", "aircall", "ringcentral", "google_business_profile",
      "jira", "asana", "clickup", "trello", "monday_com", "github", "gitlab", "bitbucket",
      "shopify", "woocommerce", "paypal", "razorpay", "square", "wise_business", "plaid", "chargebee", "paddle",
      "dropbox", "box", "dropbox_sign", "adobe_acrobat_sign",
      "anthropic_claude", "openai", "google_gemini", "azure_openai", "ollama",
    ]));
  });

  it("every provider has at least one capability and never claims to be genuinely connected", () => {
    PROVIDERS.forEach((p) => {
      expect(p.capabilities.length).toBeGreaterThan(0);
      expect(CATEGORIES).toContain(p.category);
      expect(p.catalogStatus).not.toBe("Connected");
    });
  });

  it("API-key providers expose the required disabled-credential placeholder text", () => {
    // Resend is a deliberate exception: its spec explicitly says "Do not
    // request or display an API key" even as a disabled placeholder field.
    const apiKeyProviders = PROVIDERS.filter((p) => p.authMethod === "API Key" && p.key !== "resend");
    expect(apiKeyProviders.length).toBeGreaterThan(0);
    apiKeyProviders.forEach((p) => {
      expect(p.credentialFieldInfo?.disabledPlaceholder).toBe(CREDENTIAL_PLACEHOLDER_TEXT);
    });
    expect(PROVIDERS.find((p) => p.key === "resend").credentialFieldInfo).toBeNull();
  });

  it("Google Meet is represented as part of the Calendar workflow, not a separate provider", () => {
    expect(findProvider("google_meet")).toBeNull();
    const gws = findProvider("google_workspace");
    expect(gws.capabilities.some((c) => c.name.toLowerCase().includes("meet"))).toBe(true);
  });

  it("Stripe never exposes full card data, only masked fixture values", () => {
    const stripe = findProvider("stripe");
    expect(stripe.dataEnteringCrm.join(" ")).toMatch(/masked/i);
  });

  it("Zoom never shows recording or transcript content, only availability", () => {
    const zoom = findProvider("zoom");
    const recording = zoom.capabilities.find((c) => c.id === "zoom_recording_availability");
    const transcript = zoom.capabilities.find((c) => c.id === "zoom_transcript_availability");
    expect(recording.description).toMatch(/never shown/i);
    expect(transcript.description).toMatch(/never shown/i);
  });

  it("DocuSign models the full envelope status list", () => {
    const docusign = findProvider("docusign");
    expect(docusign.longDescription).toMatch(/Draft, Sent, Viewed, Signed, Declined, Expired, Voided/);
  });
});

describe("mockIntegrationsData: queryProvidersLocal", () => {
  it("filters by search text", () => {
    const results = queryProvidersLocal({ search: "slack" });
    expect(results).toHaveLength(1);
    expect(results[0].key).toBe("slack");
  });

  it("filters by category", () => {
    const results = queryProvidersLocal({ category: "Accounting" });
    expect(results.map((p) => p.key).sort()).toEqual(["quickbooks_online", "xero"]);
  });

  it("filters by supported module", () => {
    const results = queryProvidersLocal({ module: "Contracts" });
    expect(results.some((p) => p.key === "docusign")).toBe(true);
    expect(results.some((p) => p.key === "slack")).toBe(true);
  });

  it("sorts by name ascending by default", () => {
    const results = queryProvidersLocal({});
    const names = results.map((p) => p.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });
});

describe("mockIntegrationsData: connections", () => {
  it("every seeded connection belongs to a real organization and uses a preview-qualified status", () => {
    CONNECTIONS.forEach((c) => {
      expect(c.organizationId).toBeTruthy();
      expect(CONNECTION_STATUSES).toContain(c.status);
      expect(c.status).not.toBe("Connected");
      expect(c.previewLabel).toBe(FRONTEND_CONNECTION_PREVIEW_LABEL);
      expect(c.previewExplanation).toBe(FRONTEND_CONNECTION_PREVIEW_EXPLANATION);
    });
  });

  it("queryConnectionsLocal filters by organization", () => {
    const hqOnly = queryConnectionsLocal({ organizationId: CONNECTIONS[0].organizationId });
    expect(hqOnly.every((c) => c.organizationId === CONNECTIONS[0].organizationId)).toBe(true);
  });

  it("covers a spread of connection statuses across the seed set", () => {
    const statuses = new Set(CONNECTIONS.map((c) => c.status));
    expect(statuses.has("Preview Connected")).toBe(true);
    expect(statuses.has("Attention Required")).toBe(true);
    expect(statuses.has("Configuration Required")).toBe(true);
    expect(statuses.has("Preview Paused")).toBe(true);
    expect(statuses.has("Preview Disconnected")).toBe(true);
  });
});

describe("mockIntegrationsData: createConnectionPreview", () => {
  it("creates a preview connection and returns the required completion message", () => {
    const result = createConnectionPreview({ providerKey: "calendly", organizationId: "org_solstice_partners", connectedByName: "Test User" });
    expect(result.error).toBeUndefined();
    expect(result.message).toBe(PREVIEW_CONNECTION_COMPLETE_MESSAGE);
    expect(result.connection.status).toBe("Preview Connected");
    expect(result.connection.previewLabel).toBe(FRONTEND_CONNECTION_PREVIEW_LABEL);
  });

  it("refuses an unknown provider", () => {
    const result = createConnectionPreview({ providerKey: "not_a_real_provider", organizationId: "org_caspira_hq" });
    expect(result.error).toBeTruthy();
  });

  it("refuses a duplicate active connection for the same provider and organization", () => {
    const result = createConnectionPreview({ providerKey: "slack", organizationId: "org_caspira_hq" });
    expect(result.error).toMatch(/already exists/i);
  });
});

describe("mockIntegrationsData: pause / resume / disconnect / undo", () => {
  it("pauses and resumes a connection", () => {
    const paused = pauseConnection("conn_1", "Test Actor");
    expect(paused.connection.status).toBe("Preview Paused");
    const resumed = resumeConnection("conn_1", "Test Actor");
    expect(resumed.connection.status).toBe("Preview Connected");
  });

  it("requires a written reason to disconnect", () => {
    const result = disconnectConnection("conn_6", "", "Test Actor");
    expect(result.error).toMatch(/reason is required/i);
  });

  it("disconnects with a reason and can be undone within the session", () => {
    const disconnected = disconnectConnection("conn_6", "Testing disconnect.", "Test Actor");
    expect(disconnected.connection.status).toBe("Preview Disconnected");
    expect(disconnected.connection.disconnectReason).toBe("Testing disconnect.");

    const undone = undoDisconnectConnection("conn_6", "Test Actor");
    expect(undone.connection.status).toBe("Preview Connected");
    expect(undone.connection.disconnectReason).toBeNull();
  });

  it("has nothing to undo once the session's undo window is consumed", () => {
    const result = undoDisconnectConnection("conn_6", "Test Actor");
    expect(result.error).toMatch(/nothing to undo/i);
  });
});

describe("mockIntegrationsData: preview synchronization", () => {
  it("runs a preview sync and produces a labeled, fully-shaped result", () => {
    const { job, connection } = runPreviewSync("conn_8", "Manual Sync", "Test Actor");
    expect(job.label).toBe("Preview Synchronization");
    expect(job.result.label).toBe("Preview Synchronization");
    expect(job.result.recordsExamined).toBeGreaterThanOrEqual(0);
    expect(job.result.startedDate).toBeTruthy();
    expect(job.result.completedDate).toBeTruthy();
    expect(connection.syncJobs[0].id).toBe(job.id);
    expect(connection.lastSyncedAt).toBeTruthy();
  });

  it("retryFailedSync produces a new Retry-triggered result", () => {
    const { job: firstJob } = runPreviewSync("conn_1", "Manual Sync", "Test Actor");
    const retried = retryFailedSync("conn_1", firstJob.id, "Test Actor");
    expect(retried.error).toBeUndefined();
    expect(retried.job.jobType).toBe("Retry");
  });

  it("refuses to sync a connection that does not exist", () => {
    const result = runPreviewSync("conn_does_not_exist");
    expect(result.error).toBeTruthy();
  });
});

describe("mockIntegrationsData: field mapping", () => {
  it("updates an existing field mapping", () => {
    const connection = findConnection("conn_2");
    connection.fieldMappings.push({ id: "map_1", crmField: "email", conflictRule: "CRM Wins" });
    const result = updateFieldMapping("conn_2", "map_1", { conflictRule: "Provider Wins" });
    expect(result.fieldMapping.conflictRule).toBe("Provider Wins");
  });

  it("refuses an unknown mapping id", () => {
    const result = updateFieldMapping("conn_2", "not_a_real_mapping", {});
    expect(result.error).toBeTruthy();
  });
});

describe("mockIntegrationsData: webhooks", () => {
  it("every seeded webhook preview uses the required backend notice, never a real endpoint", () => {
    expect(WEBHOOK_PREVIEWS.length).toBeGreaterThan(0);
    WEBHOOK_PREVIEWS.forEach((w) => {
      expect(w.backendNotice).toBe(WEBHOOK_BACKEND_NOTICE);
      expect(w.endpointLabel).not.toMatch(/^https?:\/\//);
    });
  });

  it("queryWebhooksLocal filters by organization", () => {
    const results = queryWebhooksLocal({ organizationId: "org_caspira_hq" });
    expect(results.every((w) => w.organizationId === "org_caspira_hq")).toBe(true);
  });
});

describe("mockIntegrationsData: activity", () => {
  it("has a separate audit trail from the unrelated Access Audit feature", () => {
    expect(AUDIT_EVENTS.length).toBeGreaterThan(0);
    AUDIT_EVENTS.forEach((e) => expect(e.source).toBe("Integration Center"));
  });

  it("queryActivityLocal filters by organization and event", () => {
    const results = queryActivityLocal({ organizationId: "org_caspira_hq", event: "Preview connection created" });
    expect(results.every((e) => e.organizationId === "org_caspira_hq" && e.event === "Preview connection created")).toBe(true);
  });
});

describe("mockIntegrationsData: metrics", () => {
  it("computeIntegrationMetrics reflects the given connection set", () => {
    const metrics = computeIntegrationMetrics(CONNECTIONS);
    expect(metrics.availableProviders).toBe(61);
    expect(metrics.previewConnections).toBeGreaterThan(0);
    expect(metrics.attentionRequired).toBeGreaterThan(0);
  });
});

describe("mockIntegrationsData: factory defaults", () => {
  it("createIntegrationConnection never omits a field", () => {
    const connection = createIntegrationConnection({ id: "x", providerKey: "slack", organizationId: "org_caspira_hq" });
    expect(connection).toHaveProperty("health");
    expect(connection).toHaveProperty("syncConfiguration");
    expect(connection).toHaveProperty("recentErrors");
    expect(connection.isPreview).toBe(true);
  });

  it("createIntegrationProvider defaults catalogStatus to a preview-qualified value", () => {
    const provider = createIntegrationProvider({ key: "x", name: "X", category: "Automation", shortDescription: "", longDescription: "", authMethod: "API Key", pricingClassification: "Contact Provider", planRequirement: {} });
    expect(provider.catalogStatus).toBe("Preview Available");
  });
});

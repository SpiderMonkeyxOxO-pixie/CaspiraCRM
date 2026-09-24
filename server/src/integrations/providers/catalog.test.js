import { describe, it, expect, vi } from "vitest";
import { PROVIDER_CATALOG, ADAPTER_PROVIDERS } from "./catalog.js";
import { seedProviderCatalog } from "./catalogSeed.js";

describe("provider catalog", () => {
  it("lists every Integration Center provider once, with no credentials", () => {
    const keys = PROVIDER_CATALOG.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.length).toBe(61);
    expect(JSON.stringify(PROVIDER_CATALOG)).not.toMatch(/client_secret"\s*:|sk_live_|access_token"\s*:/);
  });

  it("AI providers are blocked until Phase 9; unlisted providers are catalog-only", () => {
    for (const k of ["anthropic_claude", "openai", "google_gemini", "azure_openai", "ollama"]) expect(PROVIDER_CATALOG.find((p) => p.key === k)).toMatchObject({ availability: "Blocked" });
    expect(PROVIDER_CATALOG.find((p) => p.key === "mailchimp")).toMatchObject({ availability: "Catalog Only", capabilities: [] });
  });

  it("every adapter provider documents its API version, docs, scopes and webhook scheme", () => {
    expect(ADAPTER_PROVIDERS.map((p) => p.key).sort()).toEqual(["asana", "box", "clickup", "docusign", "dropbox", "dropbox_sign", "github", "google_workspace", "jira", "microsoft_365", "paypal", "quickbooks_online", "slack", "stripe", "trello", "xero"]);
    for (const p of ADAPTER_PROVIDERS) {
      expect(p.apiVersion, p.key).toBeTruthy();
      expect(p.docsUrl, p.key).toMatch(/^https:\/\//);
      expect(Array.isArray(p.requiredScopes), p.key).toBe(true);
      expect(p.protocol.webhook, p.key).toBeDefined();
      expect(p.capabilities.length, p.key).toBeGreaterThan(0);
    }
  });

  it("finance adapters are import-only and read-only; file and signature capabilities need Phase 7", () => {
    for (const k of ["stripe", "paypal", "quickbooks_online", "xero"]) {
      for (const c of ADAPTER_PROVIDERS.find((p) => p.key === k).capabilities) expect(c).toMatchObject({ direction: "Import Only", financeReadOnly: true });
    }
    for (const k of ["dropbox", "box", "docusign", "dropbox_sign"]) {
      for (const c of ADAPTER_PROVIDERS.find((p) => p.key === k).capabilities) expect(c.requiresPhase).toBe(7);
    }
    const google = ADAPTER_PROVIDERS.find((p) => p.key === "google_workspace");
    expect(google.ownershipTypes).toEqual(["User Connection"]); // mailboxes are personal
    expect(google.optionalScopes).not.toContain("https://mail.google.com/"); // never full mailbox
  });

  it("the seed is idempotent", async () => {
    const rows = new Map();
    const db = {
      integrationProvider: {
        findMany: vi.fn(async () => [...rows.values()]),
        create: vi.fn(async ({ data }) => rows.set(data.key, JSON.parse(JSON.stringify(data)))),
        update: vi.fn(async ({ where, data }) => rows.set(where.key, { ...rows.get(where.key), ...JSON.parse(JSON.stringify(data)) })),
      },
    };
    expect(await seedProviderCatalog(db)).toMatchObject({ created: 61, updated: 0 });
    expect(await seedProviderCatalog(db)).toMatchObject({ created: 0, updated: 0, unchanged: 61 });
  });
});

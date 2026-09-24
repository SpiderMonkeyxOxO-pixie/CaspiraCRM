import { describe, it, expect, vi } from "vitest";

vi.mock("../../lib/prisma.js", () => ({ default: { integrationConnection: { update: vi.fn() }, integrationLog: { create: vi.fn() } } }));
process.env.INTEGRATIONS_MODE = "simulator";

const svc = await import("./connectionService.js");
const policy = await import("../policies/policyService.js");
const { classifyHttp, KINDS } = await import("../common/errors.js");
const { parseRetryAfter } = await import("../common/http.js");
const { scrub } = await import("../common/audit.js");
const { ADAPTER_PROVIDERS } = await import("../providers/catalog.js");

const member = (grants, scope = "Own", id = "m1") => ({ isSystemOwnerOverride: false, membership: { id, roles: [{ role: { defaultScope: scope, permissionGrants: Object.entries(grants).map(([moduleId, actions]) => ({ moduleId, actions })) } }] } });

describe("connection ownership and visibility", () => {
  it("a personal connection is visible only to its owner unless the caller has organization scope", () => {
    expect(svc.connectionVisibilityWhere(member({ integration_connections: ["view"] }))).toEqual({ OR: [{ ownershipType: { in: ["Organization Connection", "Service Connection"] } }, { connectedMembershipId: "m1" }] });
    expect(svc.connectionVisibilityWhere(member({ integration_connections: ["view"] }, "Organization"))).toEqual({});
  });

  it("only the owner (or an org-level manager) can manage a personal connection; org connections need create_organization", () => {
    const personal = { ownershipType: "User Connection", connectedMembershipId: "m1" };
    expect(svc.canManage(member({ integration_connections: ["view"] }), personal)).toBe(true);
    expect(svc.canManage(member({ integration_connections: ["view"] }, "Own", "m2"), personal)).toBe(false);
    expect(svc.canManage(member({ integration_connections: ["create_organization"] }, "Own", "m2"), personal)).toBe(true);
    expect(svc.canManage(member({ integration_connections: ["create_user"] }), { ownershipType: "Organization Connection" })).toBe(false);
  });

  it("serialization never includes credentials and labels simulator connections", () => {
    const out = svc.serializeConnection({ publicId: "conn_1", mode: "Simulator", status: "Connected", externalAccountId: "ext-1", grantedScopes: [], credentialRef: "encrypted", accessToken: "sim_at_secret" });
    expect(JSON.stringify(out)).not.toContain("sim_at_secret");
    expect(out.simulatorLabel).toBe("Provider Simulator — no external provider is connected.");
    expect(out).not.toHaveProperty("externalAccountId");
  });

  it("scope summary shows granted, missing and disabled capabilities", () => {
    const google = ADAPTER_PROVIDERS.find((p) => p.key === "google_workspace");
    const s = svc.scopeSummary(google, { grantedScopes: ["openid", "email", "https://www.googleapis.com/auth/calendar.readonly"], requestedScopes: ["openid", "email", "https://www.googleapis.com/auth/calendar.readonly"] });
    expect(s.missingRequiredScopes).toEqual([]);
    expect(s.capabilities.find((c) => c.key === "calendar.import").state).toBe("Available");
    expect(s.capabilities.find((c) => c.key === "gmail.link_message")).toMatchObject({ state: "Disabled — missing scopes" });
    expect(s.capabilities.find((c) => c.key === "drive.import").state).toMatch(/Phase 7/);
  });

  it("the circuit breaker and rate limits stop calls; paused or reauth connections aren't callable", () => {
    expect(() => svc.assertCallable({ status: "Connected", circuitOpenUntil: new Date(Date.now() + 60_000) })).toThrow(/circuit breaker/);
    expect(() => svc.assertCallable({ status: "Rate Limited", rateLimitedUntil: new Date(Date.now() + 60_000) })).toThrow(/rate limiting/);
    expect(() => svc.assertCallable({ status: "Reauthorization Required" })).toThrow(/Reauthorization Required/);
    expect(() => svc.assertCallable({ status: "Connected" })).not.toThrow();
  });
});

describe("policies and data egress", () => {
  const google = { ...ADAPTER_PROVIDERS.find((p) => p.key === "google_workspace"), active: true, availability: "Adapter" };

  it("blocked providers, disallowed ownership, unsupported ownership and catalog-only providers are refused", () => {
    expect(() => policy.assertProviderAllowed({ ...policy.DEFAULT_POLICY, blockedProviders: ["google_workspace"] }, google, "User Connection")).toThrow(/blocked/);
    expect(() => policy.assertProviderAllowed({ ...policy.DEFAULT_POLICY, allowedOwnershipTypes: ["Organization Connection"] }, google, "User Connection")).toThrow(/aren't allowed/);
    expect(() => policy.assertProviderAllowed(policy.DEFAULT_POLICY, google, "Organization Connection")).toThrow(/doesn't support/);
    expect(() => policy.assertProviderAllowed(policy.DEFAULT_POLICY, { key: "openai", name: "OpenAI", active: true, availability: "Blocked", availabilityReason: "Phase 9" }, "User Connection")).toThrow(/Phase 9/);
    expect(() => policy.assertProviderAllowed(policy.DEFAULT_POLICY, google, "User Connection")).not.toThrow();
  });

  it("restricted fields are removed before anything leaves, at any depth, and reported", () => {
    const { payload, removedFields } = policy.filterOutbound({ name: "Deal", margin: 42, lines: [{ product: "A", cost: 10, price: 20 }], internalNotes: "x" }, { ...policy.DEFAULT_POLICY, restrictedFields: ["price"] });
    expect(payload).toEqual({ name: "Deal", lines: [{ product: "A" }] });
    expect(removedFields.sort()).toEqual(["internalNotes", "lines[0].cost", "lines[0].price", "margin"]);
  });

  it("policy patches are validated", () => {
    expect(() => policy.policyChanges({ allowedDirections: ["Sideways"] })).toThrow();
    expect(() => policy.policyChanges({ maxSyncFrequencyMinutes: 1 })).toThrow();
    expect(policy.policyChanges({ blockedProviders: ["slack", "slack"], enabled: false })).toEqual({ blockedProviders: ["slack"], enabled: false });
  });
});

describe("provider errors, rate limits and secret scrubbing", () => {
  it("classifies provider responses into retryable and permanent kinds", () => {
    expect(classifyHttp(401).kind).toBe(KINDS.AUTH_INVALID);
    expect(classifyHttp(429, { retryAfterMs: 5000 })).toMatchObject({ kind: KINDS.RATE_LIMITED, retryAfterMs: 5000, retryable: true });
    expect(classifyHttp(503).retryable).toBe(true);
    expect(classifyHttp(422).retryable).toBe(false);
    expect(classifyHttp(403, { body: { message: "API rate limit exceeded" } }).kind).toBe(KINDS.RATE_LIMITED);
  });

  it("parses Retry-After seconds, HTTP dates and rate-limit reset headers", () => {
    expect(parseRetryAfter({ "retry-after": "12" })).toBe(12_000);
    expect(parseRetryAfter({ "retry-after": new Date(10_000).toUTCString() }, 4_000)).toBe(6_000);
    expect(parseRetryAfter({ "x-ratelimit-remaining": "0", "x-ratelimit-reset": "100" }, 40_000)).toBe(60_000);
  });

  it("scrubs tokens and secret-named fields from logs and audit payloads", () => {
    const out = scrub({ note: "token ya29.abcDEF and ghp_1234abcd", clientSecret: "x", nested: { refresh_token: "r", ok: "fine" } });
    expect(out).toEqual({ note: "token [redacted] and [redacted]", clientSecret: "[redacted]", nested: { refresh_token: "[redacted]", ok: "fine" } });
  });
});

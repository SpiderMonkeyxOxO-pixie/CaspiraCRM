import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "node:crypto";

const db = {
  integrationOAuthState: { findUnique: vi.fn(), updateMany: vi.fn(async () => ({ count: 1 })), create: vi.fn() },
  integrationConnection: { findUnique: vi.fn(), update: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
  integrationProvider: { findUnique: vi.fn() },
  organizationMembership: { findUnique: vi.fn(async () => ({ id: "m1", status: "Active" })) },
  integrationProviderApp: { findFirst: vi.fn(async () => null) },
  integrationCredential: { findFirst: vi.fn(async () => null), create: vi.fn(async ({ data }) => ({ id: "cred", ...data })), update: vi.fn(), updateMany: vi.fn() },
  integrationLog: { create: vi.fn() },
  integrationPolicy: { findUnique: vi.fn(async () => null) },
  auditEvent: { create: vi.fn() },
};
vi.mock("../../lib/prisma.js", () => ({ default: db }));
process.env.INTEGRATIONS_MODE = "simulator";

const oauth = await import("./oauthService.js");
const { createOAuth2Adapter, normalizeTokenResponse } = await import("../providers/adapters/oauth2Adapter.js");
const { ADAPTER_PROVIDERS } = await import("../providers/catalog.js");
const { encryptSecret, sha256 } = await import("../credentials/vault.js");

beforeEach(() => {
  for (const m of Object.values(db)) for (const fn of Object.values(m)) fn.mockClear?.();
  process.env.INTEGRATIONS_FRONTEND_URL = "https://crm.example";
});

describe("OAuth helpers", () => {
  it("PKCE challenge is S256 of the verifier", () => {
    const v = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    expect(oauth.pkceChallenge(v)).toBe(crypto.createHash("sha256").update(v).digest("base64url"));
  });

  it("redirects only to pre-registered frontend routes (no open redirect)", () => {
    expect(oauth.resultRedirect("connection", "conn_abc", "connected")).toBe("https://crm.example/admin/integrations/connections/conn_abc?oauth=connected");
    expect(oauth.resultRedirect("https://evil.example", "x", "error", "boom")).toBe("https://crm.example/admin/integrations/marketplace?oauth=error&reason=boom");
  });

  it("requests only known scopes: required plus the chosen capabilities (least privilege)", () => {
    const google = ADAPTER_PROVIDERS.find((p) => p.key === "google_workspace");
    expect(oauth.scopesFor(google, [])).toEqual(["openid", "email"]);
    expect(oauth.scopesFor(google, ["calendar.import"])).toEqual(["openid", "email", "https://www.googleapis.com/auth/calendar.readonly"]);
    expect(oauth.scopesFor(google, ["made.up"])).toEqual(["openid", "email"]);
  });

  it("authorization URLs carry state and, where the provider supports it, PKCE — never an implicit flow", () => {
    const github = createOAuth2Adapter(ADAPTER_PROVIDERS.find((p) => p.key === "github"));
    const u = new URL(github.getAuthorizationUrl({ clientId: "cid", redirectUri: "https://api/cb", state: "s1", codeChallenge: "ch", scopes: ["read:user"] }));
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    const slack = createOAuth2Adapter(ADAPTER_PROVIDERS.find((p) => p.key === "slack"));
    const s = new URL(slack.getAuthorizationUrl({ clientId: "cid", redirectUri: "https://api/cb", state: "s1", codeChallenge: "ch", scopes: ["chat:write", "channels:read"] }));
    expect(s.searchParams.get("code_challenge")).toBeNull(); // not documented by Slack
    expect(s.searchParams.get("scope")).toBe("chat:write,channels:read");
    const ms = createOAuth2Adapter(ADAPTER_PROVIDERS.find((p) => p.key === "microsoft_365"));
    expect(ms.getAuthorizationUrl({ clientId: "c", redirectUri: "r", state: "s", scopes: ["User.Read"] })).toContain("/organizations/oauth2/v2.0/authorize");
  });

  it("normalizes token responses and flags providers that don't report scopes", () => {
    const t = normalizeTokenResponse({ access_token: "a", refresh_token: "r", expires_in: 60, scope: "x y" }, { requestedScopes: ["x"], now: 0 });
    expect(t).toMatchObject({ accessToken: "a", refreshToken: "r", grantedScopes: ["x", "y"], scopeSource: "provider" });
    expect(t.expiresAt.getTime()).toBe(60_000);
    expect(normalizeTokenResponse({ access_token: "a" }, { requestedScopes: ["q"] }).scopeSource).toMatch(/requested/);
    expect(() => normalizeTokenResponse({ error: "invalid_grant" }, {})).toThrow(/invalid or already-used/);
  });
});

describe("OAuth callback security", () => {
  const sealed = () => encryptSecret("verifier-123", "oauth-state|pkce_verifier");
  const state = (over = {}) => {
    const s = sealed();
    return { id: "st1", stateHash: sha256("the-state"), organizationId: "org1", userId: "u1", providerKey: "github", connectionId: "c1", ownershipType: "User Connection", mode: "Simulator", requestedScopes: ["read:user"], verifierCiphertext: s.ciphertext, verifierNonce: s.nonce, verifierTag: s.authTag, keyVersion: s.keyVersion, redirectTarget: "connection", expiresAt: new Date(Date.now() + 60_000), consumedAt: null, ...over };
  };
  const req = (userId = "u1") => ({ user: { id: userId, role: "User" }, headers: {}, ip: "127.0.0.1" });
  const connection = { id: "c1", publicId: "conn_1", organizationId: "org1", status: "Authorization Pending", connectedAt: null };

  it("unknown or missing state is refused", async () => {
    db.integrationOAuthState.findUnique.mockResolvedValueOnce(null);
    expect(await oauth.handleCallback(req(), "github", { state: "nope", code: "c" })).toMatch(/oauth=error&reason=unknown_state/);
    expect(await oauth.handleCallback(req(), "github", { code: "c" })).toMatch(/reason=missing_state/);
  });

  it("state is single use: a replay is refused", async () => {
    db.integrationOAuthState.findUnique.mockResolvedValueOnce(state());
    db.integrationConnection.findUnique.mockResolvedValue(connection);
    db.integrationOAuthState.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await oauth.handleCallback(req(), "github", { state: "the-state", code: "c" })).toMatch(/reason=state_replayed/);
  });

  it("expired state, other provider, other user and other organization are refused", async () => {
    db.integrationConnection.findUnique.mockResolvedValue(connection);
    db.integrationOAuthState.findUnique.mockResolvedValueOnce(state({ expiresAt: new Date(Date.now() - 1000) }));
    expect(await oauth.handleCallback(req(), "github", { state: "the-state", code: "c" })).toMatch(/reason=state_expired/);
    db.integrationOAuthState.findUnique.mockResolvedValueOnce(state());
    expect(await oauth.handleCallback(req(), "slack", { state: "the-state", code: "c" })).toMatch(/reason=provider_mismatch/);
    db.integrationOAuthState.findUnique.mockResolvedValueOnce(state());
    expect(await oauth.handleCallback(req("attacker"), "github", { state: "the-state", code: "c" })).toMatch(/reason=user_mismatch/);
    db.integrationOAuthState.findUnique.mockResolvedValueOnce(state());
    db.organizationMembership.findUnique.mockResolvedValueOnce({ id: "m1", status: "Suspended" });
    expect(await oauth.handleCallback(req(), "github", { state: "the-state", code: "c" })).toMatch(/reason=organization_mismatch/);
  });

  it("the state was consumed before the code was used, and failures are audited without secrets", async () => {
    db.integrationOAuthState.findUnique.mockResolvedValueOnce(state());
    db.integrationConnection.findUnique.mockResolvedValue(connection);
    const url = await oauth.handleCallback(req(), "github", { state: "the-state", error: "access_denied" });
    expect(url).toMatch(/reason=provider_denied/);
    expect(db.integrationOAuthState.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: "st1", consumedAt: null } });
    const audit = JSON.stringify(db.auditEvent.create.mock.calls);
    expect(audit).not.toContain("the-state");
    expect(audit).not.toContain("verifier-123");
  });
});

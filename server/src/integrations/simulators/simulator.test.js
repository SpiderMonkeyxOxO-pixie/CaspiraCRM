import { describe, it, expect, beforeEach } from "vitest";
import crypto from "node:crypto";
import { createSimulator, SIM_CLIENT_ID, SIM_CLIENT_SECRET, signSimulatorWebhook } from "./simulatorCore.js";

const P = "github";
const challenge = (v) => crypto.createHash("sha256").update(v).digest("base64url");
let sim;
beforeEach(() => { sim = createSimulator(); });

function authorize(verifier = "v".repeat(43), scope = "read:user public_repo") {
  const r = sim.authorize({ provider: P, client_id: SIM_CLIENT_ID(P), redirect_uri: "https://api/cb", state: "s", code_challenge: challenge(verifier), code_challenge_method: "S256", scope });
  return new URL(r.redirect).searchParams.get("code");
}
const exchange = (code, verifier = "v".repeat(43), redirect = "https://api/cb") => sim.token({ provider: P, grant_type: "authorization_code", code, redirect_uri: redirect, client_id: SIM_CLIENT_ID(P), client_secret: SIM_CLIENT_SECRET(P), code_verifier: verifier });

describe("provider simulator", () => {
  it("OAuth code flow with PKCE; codes are single use and bound to the redirect URI", () => {
    const code = authorize();
    expect(exchange(code, "wrong-verifier-wrong-verifier-wrong-verifier").status).toBe(400);
    const code2 = authorize();
    expect(exchange(code2, "v".repeat(43), "https://evil/cb").body.error_description).toMatch(/redirect_uri/);
    const code3 = authorize();
    const ok = exchange(code3);
    expect(ok.status).toBe(200);
    expect(ok.body.scope).toBe("read:user public_repo");
    expect(exchange(code3).body.error_description).toMatch(/already used/);
    expect(sim.authorize({ provider: P, client_id: SIM_CLIENT_ID(P), redirect_uri: "x", state: "s", code_challenge: "c", code_challenge_method: "plain" }).status).toBe(400);
  });

  it("refresh tokens rotate; revoked or expired tokens are rejected", () => {
    const t = exchange(authorize()).body;
    const r1 = sim.token({ provider: P, grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: SIM_CLIENT_ID(P), client_secret: SIM_CLIENT_SECRET(P) });
    expect(r1.status).toBe(200);
    expect(sim.token({ provider: P, grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: SIM_CLIENT_ID(P), client_secret: SIM_CLIENT_SECRET(P) }).body.error).toBe("invalid_grant");
    expect(sim.me({ provider: P, bearer: r1.body.access_token }).status).toBe(200);
    sim.control.expireTokens(P);
    expect(sim.me({ provider: P, bearer: r1.body.access_token }).body.error).toBe("token_expired");
    sim.revoke({ token: r1.body.access_token });
    expect(sim.token({ provider: P, grant_type: "refresh_token", refresh_token: r1.body.refresh_token, client_id: SIM_CLIENT_ID(P), client_secret: SIM_CLIENT_SECRET(P) }).body.error).toBe("invalid_grant");
  });

  it("scope changes, rate limits and failures are scriptable", () => {
    sim.control.grantScopes(P, ["read:user"]);
    expect(exchange(authorize()).body.scope).toBe("read:user");
    const token = exchange(authorize()).body.access_token;
    sim.control.rateLimit(P, 1, 7);
    expect(sim.me({ provider: P, bearer: token })).toMatchObject({ status: 429, headers: { "retry-after": "7" } });
    sim.control.fail(P, ["transient", "permanent"]);
    expect(sim.me({ provider: P, bearer: token }).status).toBe(503);
    expect(sim.me({ provider: P, bearer: token }).status).toBe(400);
    expect(sim.me({ provider: P, bearer: token }).status).toBe(200);
  });

  it("paginated records and an incremental cursor that only returns changes", () => {
    const token = exchange(authorize()).body.access_token;
    const first = sim.records({ provider: P, bearer: token, entityType: "issue", limit: 5 });
    expect(first.body.items).toHaveLength(5);
    const second = sim.records({ provider: P, bearer: token, entityType: "issue", cursor: first.body.nextCursor, limit: 5 });
    expect(second.body.items).toHaveLength(3);
    const delta = second.body.deltaToken;
    expect(sim.records({ provider: P, bearer: token, entityType: "issue", deltaToken: delta }).body.items).toHaveLength(0);
    sim.control.updateRecord(P, "issue", "iss_github_2", { title: "Changed" });
    sim.control.deleteRecord(P, "issue", "iss_github_3");
    const changes = sim.records({ provider: P, bearer: token, entityType: "issue", deltaToken: delta }).body.items;
    expect(changes.map((c) => [c.id, c.deleted])).toEqual([["iss_github_2", false], ["iss_github_3", true]]);
    expect(sim.records({ provider: P, bearer: token, entityType: "issue", deltaToken: "expired" }).status).toBe(410);
  });

  it("signs webhooks deterministically", () => {
    const h = signSimulatorWebhook("secret", '{"a":1}', 1000);
    expect(h["x-simulator-signature"]).toBe(crypto.createHmac("sha256", "secret").update('1000.{"a":1}').digest("hex"));
  });
});

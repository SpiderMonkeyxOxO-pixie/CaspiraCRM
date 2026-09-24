// Backend Phase 8 — exercises the Provider Simulator through the real
// simulator adapter, with no database and no external provider:
// OAuth (PKCE, single-use code), token refresh rotation, revocation,
// paginated + incremental reads, cursor expiry, rate limiting, idempotent
// writes and actions, and webhook signing.
//
//   npm run integrations:test-simulator
//
// Exit code 0 when every check passes.
import crypto from "node:crypto";
import express from "express";
import simulatorRouter from "../src/integrations/simulators/simulatorRouter.js";
import { simulator, SIMULATOR_LABEL, SIM_WEBHOOK_SECRET, signSimulatorWebhook } from "../src/integrations/simulators/simulatorCore.js";
import { createSimulatorAdapter, simulatorApp } from "../src/integrations/providers/adapters/simulatorAdapter.js";
import { verifySignature } from "../src/integrations/webhooks/verifiers.js";

const app = express();
app.use("/sim", simulatorRouter);
const server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
process.env.INTEGRATIONS_SIMULATOR_URL = `http://127.0.0.1:${server.address().port}/sim`;

const PROVIDER = "google_workspace";
const adapter = createSimulatorAdapter(PROVIDER);
const { clientId, clientSecret } = simulatorApp(PROVIDER);
const redirectUri = "http://127.0.0.1/callback";
const results = [];
const check = async (name, fn) => {
  try { results.push(["PASS", name, (await fn()) || ""]); } catch (err) { results.push(["FAIL", name, err.message]); }
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

async function authorize(scopes = ["calendar.import"]) {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const url = adapter.getAuthorizationUrl({ clientId, redirectUri, state: "st-1", codeChallenge: challenge, scopes });
  const res = await fetch(url, { redirect: "manual" });
  const code = new URL(res.headers.get("location")).searchParams.get("code");
  return { code, verifier };
}

let tokens;
await check("OAuth code exchange with PKCE", async () => {
  const { code, verifier } = await authorize();
  tokens = await adapter.exchangeAuthorizationCode({ clientId, clientSecret, code, redirectUri, codeVerifier: verifier, requestedScopes: ["calendar.import"] });
  assert(tokens.accessToken && tokens.refreshToken, "no tokens");
  const replay = await adapter.exchangeAuthorizationCode({ clientId, clientSecret, code, redirectUri, codeVerifier: verifier }).then(() => "accepted", (e) => e.kind);
  assert(replay !== "accepted", "code reused");
  return `granted ${tokens.grantedScopes.join(" ")}; replayed code → ${replay}`;
});
await check("Wrong PKCE verifier refused", async () => {
  const { code } = await authorize();
  const r = await adapter.exchangeAuthorizationCode({ clientId, clientSecret, code, redirectUri, codeVerifier: "wrong" }).then(() => "accepted", (e) => e.kind);
  assert(r !== "accepted", "accepted a wrong verifier");
  return r;
});
await check("Identity", async () => {
  const me = await adapter.getConnectedIdentity({ accessToken: tokens.accessToken });
  return `${me.externalAccountLabel} (${me.tenantLabel})`;
});
await check("Refresh rotates; the old refresh token stops working", async () => {
  const old = tokens.refreshToken;
  tokens = await adapter.refreshCredentials({ clientId, clientSecret, refreshToken: old });
  const again = await adapter.refreshCredentials({ clientId, clientSecret, refreshToken: old }).then(() => "accepted", (e) => e.kind);
  assert(again === "auth_invalid", `old refresh token → ${again}`);
  return "rotated; old → auth_invalid";
});
let checkpoint;
await check("Paged initial read, then incremental from the checkpoint", async () => {
  let cursor = null;
  let count = 0;
  let pages = 0;
  do {
    const page = await adapter.pullChanges({ accessToken: tokens.accessToken, entityType: "calendar_event", cursor, limit: 5 });
    count += page.items.length;
    pages += 1;
    cursor = page.nextCursor;
    if (!cursor) checkpoint = page.deltaToken;
  } while (cursor);
  const none = await adapter.pullChanges({ accessToken: tokens.accessToken, entityType: "calendar_event", deltaToken: checkpoint });
  simulator.control.updateRecord(PROVIDER, "calendar_event", `evt_${PROVIDER}_1`, { summary: "Moved" });
  const one = await adapter.pullChanges({ accessToken: tokens.accessToken, entityType: "calendar_event", deltaToken: checkpoint });
  assert(none.items.length === 0 && one.items.length === 1, "incremental read wrong");
  return `${count} events in ${pages} pages; unchanged → 0; one edit → ${one.items.length}`;
});
await check("Expired change token → HTTP 410", async () => {
  const r = await adapter.pullChanges({ accessToken: tokens.accessToken, entityType: "calendar_event", deltaToken: "expired" }).then(() => null, (e) => e.status);
  assert(r === 410, `got ${r}`);
  return "410";
});
await check("Rate limit → rate_limited with Retry-After", async () => {
  simulator.control.rateLimit(PROVIDER, 1, 3);
  const e = await adapter.pullChanges({ accessToken: tokens.accessToken, entityType: "calendar_event" }).then(() => null, (x) => x);
  assert(e?.kind === "rate_limited", `got ${e?.kind}`);
  return `retry after ${e.retryAfterMs / 1000}s`;
});
await check("Transient failure is retryable, permanent is not", async () => {
  simulator.control.fail(PROVIDER, ["transient", "permanent"]);
  const a = await adapter.testConnection({ accessToken: tokens.accessToken }).then(() => null, (e) => e);
  const b = await adapter.testConnection({ accessToken: tokens.accessToken }).then(() => null, (e) => e);
  assert(a?.retryable && b && !b.retryable, "classification wrong");
  return `${a.kind} (retryable), ${b.kind} (not retried)`;
});
await check("Idempotent write and action", async () => {
  const w1 = await adapter.pushChanges({ accessToken: tokens.accessToken, entityType: "issue", externalId: `iss_${PROVIDER}_1`, fields: { title: "Renamed" }, idempotencyKey: "k-1" });
  const w2 = await adapter.pushChanges({ accessToken: tokens.accessToken, entityType: "issue", externalId: `iss_${PROVIDER}_1`, fields: { title: "Renamed" }, idempotencyKey: "k-1" });
  const a1 = await adapter.performAction({ accessToken: tokens.accessToken, kind: "draft", payload: { to: ["a@example.com"], subject: "S", body: "B" }, idempotencyKey: "act-1" });
  const a2 = await adapter.performAction({ accessToken: tokens.accessToken, kind: "draft", payload: { to: ["a@example.com"], subject: "S", body: "B" }, idempotencyKey: "act-1" });
  assert(w1.externalVersion === w2.externalVersion && a1.externalId === a2.externalId && a2.replayed, "not idempotent");
  return `write version ${w1.externalVersion}; draft ${a1.externalId} created once`;
});
await check("Webhook signature verifies; tampered body and stale timestamp don't", async () => {
  const body = JSON.stringify({ id: "evt-1", type: "calendar_event.updated" });
  const secret = SIM_WEBHOOK_SECRET(PROVIDER);
  const headers = signSimulatorWebhook(secret, body);
  const ok = verifySignature("simulator", { headers, raw: body, secret });
  const tampered = verifySignature("simulator", { headers, raw: `${body} `, secret });
  const stale = verifySignature("simulator", { headers: signSimulatorWebhook(secret, body, Math.floor(Date.now() / 1000) - 3600), raw: body, secret });
  assert(ok.valid === true, "valid signature rejected");
  assert(!tampered.valid && !stale.valid, "bad signature accepted");
  return "valid / tampered rejected / stale rejected";
});
await check("Revocation ends access", async () => {
  await adapter.revokeCredentials({ token: tokens.accessToken });
  const r = await adapter.testConnection({ accessToken: tokens.accessToken }).then(() => "ok", (e) => e.kind);
  assert(r === "auth_invalid", `got ${r}`);
  return r;
});

server.close();
console.log(`${SIMULATOR_LABEL}\n`);
for (const [s, n, d] of results) console.log(`${s}  ${n}${d ? `  —  ${d}` : ""}`);
const passed = results.filter((r) => r[0] === "PASS").length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);

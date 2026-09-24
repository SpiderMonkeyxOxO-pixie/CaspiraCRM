// Backend Phase 8 — the deterministic provider simulator (local development
// and tests only). It emulates the provider PROTOCOL — OAuth 2.0 with PKCE,
// token refresh/expiry/revocation, an identity endpoint, paginated records
// with an incremental cursor, rate limits, temporary and permanent failures,
// and signed webhooks — for any provider key. It does not reproduce each
// provider's exact API shapes; the real adapters are tested separately.
//
// Everything a simulator connection shows is labelled:
//   "Provider Simulator — no external provider is connected."
import crypto from "node:crypto";

export const SIMULATOR_LABEL = "Provider Simulator — no external provider is connected.";
export const SIM_CLIENT_ID = (provider) => `sim-client-${provider}`;
export const SIM_CLIENT_SECRET = (provider) => `sim-secret-${provider}`;
export const SIM_WEBHOOK_SECRET = (provider) => `sim-webhook-secret-${provider}`;

const rand = () => crypto.randomBytes(18).toString("base64url");
const s256 = (v) => crypto.createHash("sha256").update(v).digest("base64url");

// Deterministic seed data per entity type.
function seedRecords(provider) {
  const base = Date.UTC(2026, 8, 1, 9, 0, 0);
  const iso = (ms) => new Date(ms).toISOString();
  const zones = ["Asia/Manila", "America/New_York", "Europe/London"];
  const records = {
    calendar_event: Array.from({ length: 12 }, (_, i) => ({
      id: `evt_${provider}_${i + 1}`, summary: `Customer meeting ${i + 1}`, timeZone: zones[i % 3],
      start: { dateTime: iso(base + i * 86_400_000), timeZone: zones[i % 3] }, end: { dateTime: iso(base + i * 86_400_000 + 3_600_000), timeZone: zones[i % 3] },
      attendees: [{ email: `guest${i + 1}@external.example`, responseStatus: "needsAction" }], location: i % 2 ? "Video call" : "Office",
    })),
    issue: Array.from({ length: 8 }, (_, i) => ({ id: `iss_${provider}_${i + 1}`, number: i + 1, title: `Integration issue ${i + 1}`, state: i % 3 === 0 ? "closed" : "open", body: `Details for issue ${i + 1}.` })),
    financial_transaction: Array.from({ length: 10 }, (_, i) => ({ id: `txn_${provider}_${i + 1}`, amount: ((i + 1) * 125.5).toFixed(2), currency: "USD", direction: i % 4 === 0 ? "Debit" : "Credit", description: `Payment ${i + 1}`, reference: `REF-${1000 + i}`, date: iso(base + i * 86_400_000).slice(0, 10) })),
    email_thread: [
      ...Array.from({ length: 4 }, (_, i) => ({ id: `thr_${provider}_${i + 1}`, subject: `Re: Proposal ${i + 1}`, from: `client${i + 1}@external.example`, snippetAvailable: false })),
      { id: `thr_${provider}_security`, subject: "Security alert: new sign-in", from: "no-reply@accounts.example", category: "security" },
    ],
  };
  let seq = 0;
  const out = {};
  for (const [type, rows] of Object.entries(records)) {
    out[type] = rows.map((r) => ({ ...r, seq: ++seq, updatedAt: iso(base), etag: `"v1-${r.id}"`, deleted: false }));
  }
  return { records: out, seq };
}

export function createSimulator() {
  const providers = new Map();
  const codes = new Map();
  const tokens = new Map(); // accessToken → grant
  const refreshTokens = new Map(); // refreshToken → grant

  const p = (provider) => {
    if (!providers.has(provider)) {
      const { records, seq } = seedRecords(provider);
      providers.set(provider, { records, seq, controls: { rateLimitRemaining: 0, retryAfterSec: 2, failures: [], grantedScopes: null } });
    }
    return providers.get(provider);
  };

  // Control failures and rate limits apply to resource calls.
  function gate(provider) {
    const s = p(provider);
    if (s.controls.rateLimitRemaining > 0) {
      s.controls.rateLimitRemaining -= 1;
      return { status: 429, headers: { "retry-after": String(s.controls.retryAfterSec) }, body: { error: "rate_limited" } };
    }
    const fail = s.controls.failures.shift();
    if (fail === "transient") return { status: 503, body: { error: "temporarily_unavailable" } };
    if (fail === "permanent") return { status: 400, body: { error: "invalid_request" } };
    return null;
  }

  function grantFor(bearer) {
    const grant = tokens.get(bearer);
    if (!grant || grant.revoked) return { error: { status: 401, body: { error: "invalid_token" } } };
    if (grant.expiresAt <= Date.now()) return { error: { status: 401, body: { error: "token_expired" } } };
    return { grant };
  }

  function issue(provider, { scopes, user }) {
    const access = `sim_at_${rand()}`;
    const refresh = `sim_rt_${rand()}`;
    const grant = { provider, scopes, user, expiresAt: Date.now() + 3600_000, revoked: false, refresh };
    tokens.set(access, grant);
    refreshTokens.set(refresh, { provider, scopes, user, revoked: false });
    return { access_token: access, refresh_token: refresh, token_type: "Bearer", expires_in: 3600, scope: scopes.join(" ") };
  }

  return {
    // GET /authorize — auto-approves (no UI) and redirects back with a code.
    authorize({ provider, client_id, redirect_uri, state, code_challenge, code_challenge_method, scope = "", sim_user = "sim-user-1" }) {
      if (client_id !== SIM_CLIENT_ID(provider)) return { status: 400, body: { error: "unauthorized_client" } };
      if (!redirect_uri || !state) return { status: 400, body: { error: "invalid_request" } };
      if (code_challenge && code_challenge_method !== "S256") return { status: 400, body: { error: "invalid_request", error_description: "Only S256 is supported." } };
      const requested = scope.split(/[ ,]+/).filter(Boolean);
      const granted = p(provider).controls.grantedScopes || requested;
      const code = `sim_code_${rand()}`;
      codes.set(code, { provider, redirect_uri, code_challenge, scopes: granted, user: sim_user, expiresAt: Date.now() + 60_000, used: false });
      const url = new URL(redirect_uri);
      url.searchParams.set("code", code);
      url.searchParams.set("state", state);
      return { status: 302, redirect: url.toString() };
    },

    // POST /token — authorization_code (single use, redirect + PKCE checked) or refresh_token (rotating).
    token({ provider, grant_type, code, redirect_uri, client_id, client_secret, code_verifier, refresh_token }) {
      if (client_id !== SIM_CLIENT_ID(provider) || client_secret !== SIM_CLIENT_SECRET(provider)) return { status: 401, body: { error: "invalid_client" } };
      if (grant_type === "authorization_code") {
        const c = codes.get(code);
        if (!c || c.provider !== provider) return { status: 400, body: { error: "invalid_grant" } };
        if (c.used) { c.replayed = true; return { status: 400, body: { error: "invalid_grant", error_description: "Code already used." } }; }
        c.used = true;
        if (c.expiresAt <= Date.now()) return { status: 400, body: { error: "invalid_grant", error_description: "Code expired." } };
        if (c.redirect_uri !== redirect_uri) return { status: 400, body: { error: "invalid_grant", error_description: "redirect_uri mismatch." } };
        if (c.code_challenge && s256(code_verifier || "") !== c.code_challenge) return { status: 400, body: { error: "invalid_grant", error_description: "PKCE verification failed." } };
        return { status: 200, body: issue(provider, { scopes: c.scopes, user: c.user }) };
      }
      if (grant_type === "refresh_token") {
        const r = refreshTokens.get(refresh_token);
        if (!r || r.revoked || r.provider !== provider) return { status: 400, body: { error: "invalid_grant" } };
        r.revoked = true; // rotation: each refresh token works once
        return { status: 200, body: issue(provider, { scopes: r.scopes, user: r.user }) };
      }
      return { status: 400, body: { error: "unsupported_grant_type" } };
    },

    revoke({ token }) {
      const g = tokens.get(token);
      if (g) { g.revoked = true; const r = refreshTokens.get(g.refresh); if (r) r.revoked = true; }
      const r = refreshTokens.get(token);
      if (r) r.revoked = true;
      return { status: 200, body: {} };
    },

    me({ provider, bearer }) {
      const { grant, error } = grantFor(bearer);
      if (error) return error;
      const g = gate(provider);
      if (g) return g;
      return { status: 200, body: { id: grant.user, email: `${grant.user}@simulator.example`, name: "Simulator User", tenantId: `sim-tenant-${provider}`, tenantName: "Simulator Workspace", scopes: grant.scopes } };
    },

    // GET /records — pagination (cursor) and incremental changes (deltaToken).
    records({ provider, bearer, entityType, cursor, deltaToken, limit = 5 }) {
      const { error } = grantFor(bearer);
      if (error) return error;
      const g = gate(provider);
      if (g) return g;
      const s = p(provider);
      const all = s.records[entityType] || [];
      if (deltaToken === "expired") return { status: 410, body: { error: "sync_token_expired" } };
      const since = deltaToken ? Number(String(deltaToken).replace(/^d:/, "")) : null;
      const pool = since === null ? all.filter((r) => !r.deleted) : all.filter((r) => r.seq > since);
      const offset = cursor ? Number(String(cursor).replace(/^c:/, "")) : 0;
      const page = pool.slice(offset, offset + Math.min(Number(limit) || 5, 50));
      const more = offset + page.length < pool.length;
      return { status: 200, body: { items: page, nextCursor: more ? `c:${offset + page.length}` : null, deltaToken: more ? null : `d:${s.seq}` } };
    },

    // PATCH /records/:entityType/:id — used by two-way sync; idempotent per key.
    updateRecord({ provider, bearer, entityType, id, fields, idempotencyKey }) {
      const { error } = grantFor(bearer);
      if (error) return error;
      const g = gate(provider);
      if (g) return g;
      const s = p(provider);
      const r = (s.records[entityType] || []).find((x) => x.id === id && !x.deleted);
      if (!r) return { status: 404, body: { error: "not_found" } };
      s.seen ||= new Set();
      if (idempotencyKey && s.seen.has(idempotencyKey)) return { status: 200, body: { record: r, replayed: true } };
      if (idempotencyKey) s.seen.add(idempotencyKey);
      const map = entityType === "issue" ? { title: fields.title, body: fields.description, state: fields.state } : fields;
      for (const [k, v] of Object.entries(map)) if (v !== undefined) r[k] = v;
      Object.assign(r, { seq: ++s.seq, updatedAt: new Date().toISOString(), etag: `"v${s.seq}-${id}"` });
      return { status: 200, body: { record: r } };
    },

    // GET /records/:entityType/:id — one record (message headers for linking).
    getRecord({ provider, bearer, entityType, id }) {
      const { error } = grantFor(bearer);
      if (error) return error;
      const g = gate(provider);
      if (g) return g;
      const r = (p(provider).records[entityType] || []).find((x) => x.id === id && !x.deleted);
      return r ? { status: 200, body: { record: r } } : { status: 404, body: { error: "not_found" } };
    },

    // GET /channels — notification targets.
    channels({ provider, bearer }) {
      const { error } = grantFor(bearer);
      if (error) return error;
      return { status: 200, body: { channels: [{ id: "C-general", name: "general" }, { id: "C-sales", name: "sales" }] } };
    },

    // POST /actions/:kind — notify | draft. Nothing leaves the simulator; the
    // action is recorded so tests can inspect it. Idempotent per key.
    act({ provider, bearer, kind, payload, idempotencyKey }) {
      const { error } = grantFor(bearer);
      if (error) return error;
      const g = gate(provider);
      if (g) return g;
      if (!["notify", "draft"].includes(kind)) return { status: 400, body: { error: "unknown_action" } };
      const s = p(provider);
      s.actions ||= [];
      const seen = idempotencyKey && s.actions.find((a) => a.idempotencyKey === idempotencyKey);
      if (seen) return { status: 200, body: { id: seen.id, replayed: true } };
      if (kind === "notify" && !["C-general", "C-sales"].includes(payload?.channel)) return { status: 404, body: { error: "channel_not_found" } };
      const action = { id: `${kind}_${s.actions.length + 1}`, kind, payload, idempotencyKey, at: new Date().toISOString() };
      s.actions.push(action);
      return { status: 201, body: { id: action.id } };
    },

    // ---- controls (tests and local dev) ----
    control: {
      rateLimit(provider, count, retryAfterSec = 2) { Object.assign(p(provider).controls, { rateLimitRemaining: count, retryAfterSec }); },
      fail(provider, kinds) { p(provider).controls.failures.push(...kinds); },
      grantScopes(provider, scopes) { p(provider).controls.grantedScopes = scopes; },
      expireTokens(provider) { for (const g of tokens.values()) if (g.provider === provider) g.expiresAt = 0; },
      revokeAll(provider) {
        for (const g of tokens.values()) if (g.provider === provider) g.revoked = true;
        for (const r of refreshTokens.values()) if (r.provider === provider) r.revoked = true;
      },
      updateRecord(provider, entityType, id, fields) {
        const s = p(provider);
        const r = s.records[entityType].find((x) => x.id === id);
        Object.assign(r, fields, { seq: ++s.seq, updatedAt: new Date().toISOString(), etag: `"v${s.seq}-${id}"` });
        return r;
      },
      deleteRecord(provider, entityType, id) {
        const s = p(provider);
        const r = s.records[entityType].find((x) => x.id === id);
        Object.assign(r, { deleted: true, seq: ++s.seq, updatedAt: new Date().toISOString() });
        return r;
      },
      addRecord(provider, entityType, record) {
        const s = p(provider);
        const r = { ...record, seq: ++s.seq, updatedAt: new Date().toISOString(), etag: `"v${s.seq}-${record.id}"`, deleted: false };
        s.records[entityType].push(r);
        return r;
      },
      actions(provider) { return p(provider).actions || []; },
      reset() { providers.clear(); codes.clear(); tokens.clear(); refreshTokens.clear(); },
    },
  };
}

// Signs a simulator webhook the way the gateway verifies it:
// X-Simulator-Signature = hex(HMAC-SHA256(secret, timestamp + "." + body)).
export function signSimulatorWebhook(secret, body, timestamp = Math.floor(Date.now() / 1000)) {
  const signature = crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return { "x-simulator-timestamp": String(timestamp), "x-simulator-signature": signature };
}

// One shared instance per process.
export const simulator = createSimulator();

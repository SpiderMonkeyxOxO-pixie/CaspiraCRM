// Backend Phase 8 — live provider adapters: the provider-specific pieces on
// top of the shared OAuth 2.0 adapter. Identity endpoints, token request
// styles and response fields follow each provider's official docs (see the
// catalog's docsUrl / protocol.references). Provider response objects stay
// inside this file — callers only see the normalized identity.
import { ADAPTER_PROVIDERS } from "../catalog.js";
import { providerRequest } from "../../common/http.js";
import { IntegrationError, KINDS } from "../../common/errors.js";
import { completeAdapter, compareScopes } from "./contract.js";
import { createOAuth2Adapter } from "./oauth2Adapter.js";
import { LIVE_PULL } from "./livePull.js";
import { LIVE_ACTIONS } from "./liveActions.js";

const def = (key) => ADAPTER_PROVIDERS.find((p) => p.key === key);
const identity = (externalAccountId, externalAccountLabel, tenantId = null, tenantLabel = null) => ({ externalAccountId: String(externalAccountId), externalAccountLabel, tenantId: tenantId ? String(tenantId) : null, tenantLabel });

const SPECIFIC = {
  google_workspace: {
    async identity({ accessToken, proto }) {
      const { data } = await providerRequest(proto.identityUrl, { bearer: accessToken });
      return identity(data.sub, data.email || data.name);
    },
  },
  microsoft_365: {
    async identity({ accessToken, tokenResult, proto }) {
      const { data } = await providerRequest(proto.identityUrl, { bearer: accessToken });
      const tid = tokenResult?.idTokenClaims?.tid || null;
      return identity(data.id, data.userPrincipalName || data.mail || data.displayName, tid, tid);
    },
  },
  slack: {
    async identity({ accessToken, proto }) {
      const { data } = await providerRequest(proto.identityUrl, { method: "POST", bearer: accessToken });
      return identity(`${data.team_id}:${data.user_id}`, `${data.team} (${data.user})`, data.team_id, data.team);
    },
    async revoke({ token, proto }) {
      await providerRequest(proto.revokeUrl, { method: "POST", bearer: token });
      return { revoked: true };
    },
  },
  github: {
    async identity({ accessToken, proto }) {
      const { data } = await providerRequest(proto.identityUrl, { bearer: accessToken, headers: proto.headers });
      return identity(data.id, data.login);
    },
    // DELETE /applications/{client_id}/grant with the app's basic auth.
    async revoke({ clientId, clientSecret, token, proto }) {
      await providerRequest(proto.revokeUrl.replace("{client_id}", clientId), { method: "DELETE", basic: { user: clientId, pass: clientSecret }, json: { access_token: token }, headers: proto.headers });
      return { revoked: true };
    },
  },
  jira: {
    tokenJson: true,
    async identity({ accessToken, proto }) {
      const [{ data: me }, { data: sites }] = await Promise.all([providerRequest(proto.identityUrl, { bearer: accessToken }), providerRequest(proto.tenantUrl, { bearer: accessToken })]);
      const site = Array.isArray(sites) ? sites[0] : null;
      return { ...identity(me.account_id, me.email || me.name, site?.id, site?.name), availableTenants: (sites || []).map((s) => ({ id: s.id, name: s.name })) };
    },
  },
  asana: {
    async identity({ accessToken, proto }) {
      const { data } = await providerRequest(proto.identityUrl, { bearer: accessToken });
      return identity(data.data.gid, data.data.email || data.data.name);
    },
  },
  clickup: {
    // ClickUp takes the raw token in the Authorization header (no "Bearer").
    async identity({ accessToken, proto }) {
      const { data } = await providerRequest(proto.identityUrl, { headers: { Authorization: accessToken } });
      return identity(data.user.id, data.user.email || data.user.username);
    },
  },
  dropbox: {
    async identity({ accessToken, proto }) {
      const { data } = await providerRequest(proto.identityUrl, { method: "POST", bearer: accessToken });
      return identity(data.account_id, data.email || data.name?.display_name);
    },
    async revoke({ token, proto }) {
      await providerRequest(proto.revokeUrl, { method: "POST", bearer: token });
      return { revoked: true };
    },
  },
  box: {
    async identity({ accessToken, proto }) {
      const { data } = await providerRequest(proto.identityUrl, { bearer: accessToken });
      return identity(data.id, data.login || data.name);
    },
  },
  docusign: {
    tokenAuth: "basic",
    async identity({ accessToken, proto }) {
      const { data } = await providerRequest(proto.identityUrl, { bearer: accessToken });
      const account = (data.accounts || []).find((a) => a.is_default) || data.accounts?.[0];
      return identity(data.sub, data.email, account?.account_id, account?.account_name);
    },
  },
  quickbooks_online: {
    tokenAuth: "basic",
    async identity({ accessToken, context, proto }) {
      const { data } = await providerRequest(proto.identityUrl, { bearer: accessToken });
      return identity(data.sub, data.email || data.sub, context?.realmId, context?.realmId ? `Company ${context.realmId}` : null);
    },
    async revoke({ clientId, clientSecret, token, proto }) {
      await providerRequest(proto.revokeUrl, { method: "POST", basic: { user: clientId, pass: clientSecret }, json: { token } });
      return { revoked: true };
    },
  },
  xero: {
    tokenAuth: "basic",
    async identity({ accessToken, tokenResult, proto }) {
      const { data } = await providerRequest(proto.tenantUrl, { bearer: accessToken });
      const tenant = Array.isArray(data) ? data[0] : null;
      const claims = tokenResult?.idTokenClaims || {};
      return { ...identity(claims.xero_userid || claims.sub || tenant?.id || "unknown", claims.email || tenant?.tenantName || "Xero user", tenant?.tenantId, tenant?.tenantName), availableTenants: (data || []).map((t) => ({ id: t.tenantId, name: t.tenantName })) };
    },
    async revoke({ clientId, clientSecret, token, proto }) {
      await providerRequest(proto.revokeUrl, { method: "POST", basic: { user: clientId, pass: clientSecret }, form: { token } });
      return { revoked: true };
    },
  },
};

// Providers that authenticate with a key or token the person pastes (never
// through the browser's storage): verified by an identity call.
function apiKeyAdapter(key, { verifyKey, identityCall }) {
  return completeAdapter(key, {
    async validateApiKey(apiKey) { return verifyKey ? verifyKey(apiKey) : null; },
    async getConnectedIdentity({ accessToken }) { return identityCall(accessToken); },
    async testConnection({ accessToken }) { return { ok: true, identity: await identityCall(accessToken) }; },
    validateScopes(granted, required) { return compareScopes(granted, required); },
  });
}

const API_KEY_ADAPTERS = {
  // Phase 8: test-mode keys only; a live key is refused before any call.
  stripe: apiKeyAdapter("stripe", {
    verifyKey(key) {
      if (/^(sk|rk)_live_/.test(key)) throw new IntegrationError(KINDS.POLICY, "Live Stripe keys are refused in Phase 8 — use a restricted, read-only test-mode key (rk_test_…).");
      if (!/^(sk|rk)_test_/.test(key)) throw new IntegrationError(KINDS.PERMANENT, "That doesn't look like a Stripe test-mode key.");
      return { grantedScopes: key.startsWith("rk_") ? ["read_only"] : ["full (secret key — use a restricted key)"] };
    },
    async identityCall(token) {
      const p = def("stripe").protocol;
      const { data } = await providerRequest(p.identityUrl, { bearer: token, headers: p.headers });
      return identity(data.id, data.settings?.dashboard?.display_name || data.email || data.id);
    },
  }),
  trello: apiKeyAdapter("trello", {
    async identityCall(token) {
      const [appKey, userToken] = String(token).split(":");
      const u = new URL(def("trello").protocol.identityUrl);
      u.searchParams.set("key", appKey);
      u.searchParams.set("token", userToken);
      const { data } = await providerRequest(u.toString());
      return identity(data.id, data.username || data.fullName);
    },
  }),
  dropbox_sign: apiKeyAdapter("dropbox_sign", {
    async identityCall(apiKey) {
      const { data } = await providerRequest(def("dropbox_sign").protocol.identityUrl, { basic: { user: apiKey, pass: "" } });
      return identity(data.account.account_id, data.account.email_address);
    },
  }),
  // Client credentials against the sandbox only.
  paypal: apiKeyAdapter("paypal", {
    async identityCall(pair) {
      const [clientId, secret] = String(pair).split(":");
      const { data } = await providerRequest(def("paypal").protocol.tokenUrl, { method: "POST", basic: { user: clientId, pass: secret }, form: { grant_type: "client_credentials" } });
      return identity(data.app_id || clientId, `PayPal sandbox app ${data.app_id || ""}`.trim());
    },
  }),
};

export const LIVE_ADAPTERS = Object.fromEntries(ADAPTER_PROVIDERS.map((p) => [
  p.key, API_KEY_ADAPTERS[p.key] || createOAuth2Adapter(p, SPECIFIC[p.key] || {}),
]));

// Live change reading for the priority providers (see livePull.js).
for (const [key, pull] of Object.entries(LIVE_PULL)) {
  const adapter = LIVE_ADAPTERS[key];
  if (!adapter) continue;
  const base = adapter.supports;
  adapter.pullChanges = pull;
  adapter.supports = (op) => op === "pullChanges" || base(op);
}

// Explicit, confirmed actions (see liveActions.js).
for (const [key, ops] of Object.entries(LIVE_ACTIONS)) {
  const adapter = LIVE_ADAPTERS[key];
  if (!adapter) continue;
  const base = adapter.supports;
  Object.assign(adapter, ops);
  adapter.supports = (op) => op in ops || base(op);
}

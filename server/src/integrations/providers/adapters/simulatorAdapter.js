// Backend Phase 8 — the adapter used by every connection in Simulator mode,
// whatever its provider key. It speaks the simulator's generic protocol
// (simulators/simulatorCore.js). A simulator connection never calls a real
// provider, and a live connection never calls the simulator.
import { providerRequest } from "../../common/http.js";
import { compareScopes, completeAdapter } from "./contract.js";
import { normalizeTokenResponse } from "./oauth2Adapter.js";
import { SIM_CLIENT_ID, SIM_CLIENT_SECRET, SIMULATOR_LABEL } from "../../simulators/simulatorCore.js";

export function simulatorBaseUrl() {
  if (process.env.INTEGRATIONS_SIMULATOR_URL) return process.env.INTEGRATIONS_SIMULATOR_URL.replace(/\/$/, "");
  const api = (process.env.INTEGRATIONS_PUBLIC_API_URL || `http://localhost:${process.env.PORT || 4000}`).replace(/\/$/, "");
  return `${api}/api/v1/integrations/simulator`;
}

export const simulatorApp = (providerKey) => ({ clientId: SIM_CLIENT_ID(providerKey), clientSecret: SIM_CLIENT_SECRET(providerKey), environment: "Simulator" });

export function createSimulatorAdapter(providerKey) {
  const base = () => `${simulatorBaseUrl()}/${providerKey}`;
  return completeAdapter(providerKey, {
    label: SIMULATOR_LABEL,
    getAuthorizationUrl({ clientId, redirectUri, state, codeChallenge, scopes }) {
      const u = new URL(`${base()}/oauth/authorize`);
      u.searchParams.set("client_id", clientId);
      u.searchParams.set("redirect_uri", redirectUri);
      u.searchParams.set("state", state);
      u.searchParams.set("scope", (scopes || []).join(" "));
      u.searchParams.set("code_challenge", codeChallenge);
      u.searchParams.set("code_challenge_method", "S256");
      return u.toString();
    },
    async exchangeAuthorizationCode({ clientId, clientSecret, code, redirectUri, codeVerifier, requestedScopes }) {
      const { data } = await providerRequest(`${base()}/oauth/token`, { method: "POST", form: { grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: clientId, client_secret: clientSecret, code_verifier: codeVerifier } });
      return normalizeTokenResponse(data, { requestedScopes });
    },
    async refreshCredentials({ clientId, clientSecret, refreshToken, requestedScopes }) {
      const { data } = await providerRequest(`${base()}/oauth/token`, { method: "POST", form: { grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret } }).catch((err) => {
        if (err.providerCode === "invalid_grant") err.kind = "auth_invalid";
        throw err;
      });
      return normalizeTokenResponse(data, { requestedScopes });
    },
    async revokeCredentials({ token }) {
      await providerRequest(`${base()}/oauth/revoke`, { method: "POST", form: { token } });
      return { revoked: true };
    },
    async getConnectedIdentity({ accessToken }) {
      const { data } = await providerRequest(`${base()}/me`, { bearer: accessToken });
      return { externalAccountId: data.id, externalAccountLabel: data.email, tenantId: data.tenantId, tenantLabel: data.tenantName };
    },
    validateScopes(granted, required) {
      return compareScopes(granted, required);
    },
    async testConnection({ accessToken }) {
      const { data } = await providerRequest(`${base()}/me`, { bearer: accessToken });
      return { ok: true, identity: { externalAccountId: data.id, externalAccountLabel: data.email } };
    },
    async pushChanges({ accessToken, entityType, externalId, fields, idempotencyKey }) {
      const { data } = await providerRequest(`${base()}/records/${entityType}/${encodeURIComponent(externalId)}`, { method: "PATCH", bearer: accessToken, json: { fields }, headers: { "Idempotency-Key": idempotencyKey } });
      return { externalVersion: data.record?.etag || null };
    },
    async pullChanges({ accessToken, entityType, cursor, deltaToken, limit = 5 }) {
      const u = new URL(`${base()}/records`);
      u.searchParams.set("entityType", entityType);
      if (cursor) u.searchParams.set("cursor", cursor);
      if (deltaToken) u.searchParams.set("deltaToken", deltaToken);
      u.searchParams.set("limit", String(limit));
      const { data, rateLimit } = await providerRequest(u.toString(), { bearer: accessToken });
      return { items: data.items, nextCursor: data.nextCursor, deltaToken: data.deltaToken, rateLimit };
    },
  });
}

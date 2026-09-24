// Backend Phase 8 — the shared OAuth 2.0 authorization-code adapter, driven
// by each provider's catalog protocol (endpoints, PKCE, token request style)
// plus small provider-specific pieces (identity mapping, scope parsing).
// Tokens are exchanged only here, on the backend.
import { providerRequest } from "../../common/http.js";
import { IntegrationError, KINDS, classifyHttp } from "../../common/errors.js";
import { completeAdapter, compareScopes } from "./contract.js";

const decodeJwtClaims = (jwt) => {
  try { return JSON.parse(Buffer.from(String(jwt).split(".")[1], "base64url").toString("utf8")); } catch { return null; }
};

// Normalizes a token endpoint response.
export function normalizeTokenResponse(body, { requestedScopes, scopeSeparator = " ", now = Date.now() }) {
  if (!body || typeof body !== "object") throw new IntegrationError(KINDS.PERMANENT, "The provider returned an unreadable token response.");
  if (body.error) {
    if (body.error === "invalid_grant") throw new IntegrationError(KINDS.AUTH_INVALID, "The provider rejected the authorization (invalid or already-used grant).", { providerCode: body.error });
    throw new IntegrationError(KINDS.PERMANENT, "The provider rejected the token request.", { providerCode: body.error });
  }
  const accessToken = body.access_token || body.authed_user?.access_token;
  if (!accessToken) throw new IntegrationError(KINDS.PERMANENT, "The provider returned no access token.");
  const rawScope = body.scope ?? body.scopes;
  const reported = Array.isArray(rawScope) ? rawScope : typeof rawScope === "string" ? rawScope.split(scopeSeparator === "," ? /[,\s]+/ : /\s+/).filter(Boolean) : null;
  return {
    accessToken,
    refreshToken: body.refresh_token || null,
    expiresAt: body.expires_in ? new Date(now + Number(body.expires_in) * 1000) : null,
    grantedScopes: reported || requestedScopes || [],
    scopeSource: reported ? "provider" : "requested (the provider doesn't report granted scopes)",
    idTokenClaims: body.id_token ? decodeJwtClaims(body.id_token) : null,
    extra: { teamId: body.team?.id || null, teamName: body.team?.name || null },
  };
}

export function createOAuth2Adapter(def, specific = {}) {
  const proto = def.protocol || {};
  const tenant = (ctx) => ctx?.tenant || proto.defaultTenant || "common";
  const url = (u, ctx) => (u || "").replace("{tenant}", tenant(ctx));

  const tokenRequest = async (form, { clientId, clientSecret }, ctx) => {
    const style = proto.tokenAuth || specific.tokenAuth || "body";
    const body = style === "basic" ? form : { ...form, client_id: clientId, client_secret: clientSecret };
    const opts = style === "basic" ? { basic: { user: clientId, pass: clientSecret } } : {};
    try {
      const { data } = await providerRequest(url(proto.tokenUrl, ctx), { method: "POST", ...(specific.tokenJson ? { json: body } : { form: body }), ...opts });
      return data;
    } catch (err) {
      // A 400 invalid_grant on refresh means the refresh token is dead.
      if (err.kind === KINDS.PERMANENT && err.providerCode === "invalid_grant") throw new IntegrationError(KINDS.AUTH_INVALID, "The refresh token was rejected. Reauthorize the connection.", { providerCode: "invalid_grant" });
      throw err;
    }
  };

  return completeAdapter(def.key, {
    getAuthorizationUrl({ clientId, redirectUri, state, codeChallenge, scopes, nonce, context }) {
      const u = new URL(url(proto.authorizationUrl, context));
      u.searchParams.set("response_type", "code");
      u.searchParams.set("client_id", clientId);
      u.searchParams.set("redirect_uri", redirectUri);
      u.searchParams.set("state", state);
      if (scopes?.length) u.searchParams.set(specific.scopeParam || "scope", scopes.join(proto.scopeSeparator || " "));
      if (proto.pkce && codeChallenge) {
        u.searchParams.set("code_challenge", codeChallenge);
        u.searchParams.set("code_challenge_method", "S256");
      }
      if (nonce && scopes?.includes("openid")) u.searchParams.set("nonce", nonce);
      for (const [k, v] of Object.entries(proto.authParams || {})) u.searchParams.set(k, v);
      return u.toString();
    },

    async exchangeAuthorizationCode({ clientId, clientSecret, code, redirectUri, codeVerifier, requestedScopes, context }) {
      const form = { grant_type: "authorization_code", code, redirect_uri: redirectUri };
      if (proto.pkce && codeVerifier) form.code_verifier = codeVerifier;
      const data = await tokenRequest(form, { clientId, clientSecret }, context);
      return normalizeTokenResponse(data, { requestedScopes, scopeSeparator: proto.scopeSeparator });
    },

    async refreshCredentials({ clientId, clientSecret, refreshToken, requestedScopes, context }) {
      if (!refreshToken) throw new IntegrationError(KINDS.AUTH_INVALID, "There is no refresh token. Reauthorize the connection.");
      const data = await tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken }, { clientId, clientSecret }, context);
      return normalizeTokenResponse(data, { requestedScopes, scopeSeparator: proto.scopeSeparator });
    },

    ...(proto.revokeUrl && {
      async revokeCredentials({ clientId, clientSecret, token }) {
        if (specific.revoke) return specific.revoke({ clientId, clientSecret, token, proto });
        await providerRequest(url(proto.revokeUrl), { method: "POST", form: { token, client_id: clientId, client_secret: clientSecret } });
        return { revoked: true };
      },
    }),

    async getConnectedIdentity({ accessToken, tokenResult, context }) {
      if (!specific.identity) throw new IntegrationError(KINDS.UNSUPPORTED, "This provider has no identity mapping.");
      return specific.identity({ accessToken, tokenResult, context, proto });
    },

    validateScopes(granted, required) {
      return compareScopes(granted, required);
    },

    async testConnection({ accessToken, context }) {
      const identity = await specific.identity({ accessToken, context, proto });
      return { ok: true, identity };
    },

    ...(specific.pullChanges && { pullChanges: specific.pullChanges }),
    ...(specific.transformInbound && { transformInbound: specific.transformInbound }),
    ...(specific.verifyWebhook && { verifyWebhook: specific.verifyWebhook }),
    ...(specific.parseWebhook && { parseWebhook: specific.parseWebhook }),
    ...(specific.pushChanges && { pushChanges: specific.pushChanges }),

    getRateLimitState({ headers } = {}) {
      return { notes: proto.rateLimits || null, headers: headers || null };
    },

    normalizeProviderError(status, body) {
      return classifyHttp(status, { body });
    },
  });
}

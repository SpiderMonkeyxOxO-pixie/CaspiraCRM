// Backend Phase 8 — the provider-neutral adapter contract. Every adapter is
// completed with this list: an operation a provider doesn't support returns
// an explicit capability result instead of silently doing nothing.
import { unsupported } from "../../common/errors.js";

export const OPERATIONS = [
  "getAuthorizationUrl", "exchangeAuthorizationCode", "refreshCredentials", "revokeCredentials",
  "getConnectedIdentity", "validateScopes", "testConnection",
  "createWebhookSubscription", "renewWebhookSubscription", "deleteWebhookSubscription", "verifyWebhook", "parseWebhook",
  "pullChanges", "pushChanges", "transformInbound", "transformOutbound",
  "getRateLimitState", "normalizeProviderError",
];

export function completeAdapter(providerKey, partial) {
  const adapter = { providerKey, ...partial };
  for (const op of OPERATIONS) {
    if (typeof adapter[op] !== "function") adapter[op] = async () => unsupported(providerKey, op);
  }
  adapter.supports = (op) => typeof partial[op] === "function";
  return adapter;
}

// Scope comparison shared by every adapter.
export function compareScopes(granted = [], required = []) {
  const have = new Set(granted.map((s) => s.toLowerCase()));
  const missing = required.filter((s) => !have.has(s.toLowerCase()));
  return { ok: missing.length === 0, missing };
}

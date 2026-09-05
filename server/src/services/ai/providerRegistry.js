import * as anthropic from "./providers/anthropicProvider.js";
import * as openai from "./providers/openaiProvider.js";
import * as openrouter from "./providers/openrouterProvider.js";

export const PROVIDERS = { anthropic, openai, openrouter };
export const PROVIDER_ORDER = ["anthropic", "openai", "openrouter"];

// Presence-only status — never reveals whether a configured key is
// actually valid, just whether one is set on this server.
export function listProviderStatuses() {
  return PROVIDER_ORDER.map((providerId) => {
    const provider = PROVIDERS[providerId];
    return { id: providerId, label: provider.label, configured: provider.isConfigured(), defaultModel: provider.defaultModel };
  });
}

class AiProviderError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// Omit `id` to auto-pick the first configured provider in PROVIDER_ORDER.
export function getProvider(id) {
  const targetId = id || PROVIDER_ORDER.find((providerId) => PROVIDERS[providerId].isConfigured());
  if (!targetId) throw new AiProviderError("No AI provider is configured on this server.", 503);
  const provider = PROVIDERS[targetId];
  if (!provider) throw new AiProviderError(`Unknown provider "${id}".`, 400);
  if (!provider.isConfigured()) throw new AiProviderError(`${provider.label} is not configured on this server. Ask an administrator to add ${provider.envVar}.`, 503);
  return provider;
}

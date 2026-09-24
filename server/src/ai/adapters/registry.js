// Backend Phase 9 — picks the adapter for a connection. The connection's
// mode decides: a Simulator connection always uses the simulator (whatever
// provider it stands in for); a Live connection never does.
import { openaiAdapter } from "./openaiAdapter.js";
import { anthropicAdapter } from "./anthropicAdapter.js";
import { openrouterAdapter } from "./openrouterAdapter.js";
import { simulatorAdapter } from "./simulatorAdapter.js";
import { AiError, CATEGORIES } from "../common/errors.js";

const LIVE = { openai: openaiAdapter, anthropic: anthropicAdapter, openrouter: openrouterAdapter };

export function getAiAdapter(providerKey, mode) {
  if (mode === "Simulator" || providerKey === "simulator") return simulatorAdapter;
  const adapter = LIVE[providerKey];
  if (!adapter) throw new AiError(CATEGORIES.INVALID_REQUEST, "This AI provider has no adapter in this phase.");
  return adapter;
}

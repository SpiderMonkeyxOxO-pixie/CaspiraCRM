// Backend Phase 8 — picks the adapter for a connection. Simulator and live
// never mix: the connection's mode decides, and it can't change after
// creation.
import { LIVE_ADAPTERS } from "./adapters/liveAdapters.js";
import { createSimulatorAdapter } from "./adapters/simulatorAdapter.js";
import { IntegrationError, KINDS } from "../common/errors.js";

const simulators = new Map();

export function getAdapter(providerKey, mode) {
  if (mode === "Simulator") {
    if (!simulators.has(providerKey)) simulators.set(providerKey, createSimulatorAdapter(providerKey));
    return simulators.get(providerKey);
  }
  const adapter = LIVE_ADAPTERS[providerKey];
  if (!adapter) throw new IntegrationError(KINDS.UNSUPPORTED, "This provider has no backend adapter.");
  return adapter;
}

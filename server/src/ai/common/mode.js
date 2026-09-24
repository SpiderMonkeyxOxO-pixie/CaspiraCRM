// Backend Phase 9 — AI mode. "simulator" (default outside production) sends
// every request to the deterministic AI Provider Simulator; "live" uses the
// organization's real provider keys. The two never mix: a connection's mode
// is fixed when it is created. The simulator is refused in production.
export const SIMULATOR_LABEL = "AI Provider Simulator — no external AI provider is connected.";

export function aiMode() {
  const mode = (process.env.AI_MODE || (process.env.NODE_ENV === "production" ? "live" : "simulator")).toLowerCase();
  return mode === "simulator" ? "simulator" : "live";
}

export const aiSimulatorSafe = () => aiMode() === "simulator" && process.env.NODE_ENV !== "production";

// Connection mode label stored on records.
export const currentAiMode = () => (aiMode() === "simulator" ? "Simulator" : "Live");

export function assertAiModeSafe() {
  if (process.env.NODE_ENV === "production" && aiMode() === "simulator") {
    throw new Error("AI_MODE=simulator is not allowed in production.");
  }
}

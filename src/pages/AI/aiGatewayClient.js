// Thin HTTP client for the backend AI gateway used by /ai/overview.
//
// With VITE_BACKEND_AI_MODE=true (Backend Phase 9) every call goes through
// backendAiClient.js: session cookies, CSRF, the active organization, the
// organization's AI policy, redaction, budgets and usage accounting. The
// response shapes are unchanged, so the Overview's slices keep working.
//
// Without it, calls use the shared axiosInstance as before (mockApi.js
// passes /ai/(providers|narrative|explore) through to the server). Every
// response here is optional, provider-labelled text or findings layered on
// top of the deterministic engine — never a replacement for it, and every
// caller must keep working if these calls fail.
import axiosInstance from "../../Helpers/axiosInstance";
import * as ai from "../../Helpers/backendAiClient";

export async function fetchProviderStatus() {
  if (ai.BACKEND_AI_MODE_ENABLED) {
    const { providers } = await ai.listProviders();
    // Only providers the organization can actually use are offered.
    return providers.filter((p) => p.availability === "Adapter" && p.allowedByPolicy).map((p) => ({ id: p.id, label: p.label, configured: p.configured, defaultModel: null, simulatorLabel: p.simulatorLabel }));
  }
  const { data } = await axiosInstance.get("/ai/providers");
  return data.providers;
}

export async function requestNarrative({ provider, executiveSummary, facts }) {
  if (ai.BACKEND_AI_MODE_ENABLED) return ai.narrative({ provider, executiveSummary, facts });
  const { data } = await axiosInstance.post("/ai/narrative", { provider, executiveSummary, facts });
  return data;
}

export async function requestExploration({ provider, question, scopeLabel, records }) {
  if (ai.BACKEND_AI_MODE_ENABLED) return ai.explore({ provider, question, scopeLabel, records });
  const { data } = await axiosInstance.post("/ai/explore", { provider, question, scopeLabel, records });
  return data;
}

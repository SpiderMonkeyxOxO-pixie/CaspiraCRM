// Thin HTTP client for the real backend AI gateway
// (server/src/routes/aiRoutes.js). Every call goes through the same shared
// axiosInstance the rest of the app already uses — its Authorization header
// interceptor applies unchanged, and mockApi.js passes these three URLs
// straight through to the real Express server instead of mocking them (see
// the `mock.onAny(/\/ai\/(providers|narrative|explore)$/).passThrough()`
// entry there). Every response here is optional, provider-labeled text or
// findings layered on top of the deterministic engine — never a replacement
// for it, and every caller must keep working if these calls fail.
import axiosInstance from "../../Helpers/axiosInstance";

export async function fetchProviderStatus() {
  const { data } = await axiosInstance.get("/ai/providers");
  return data.providers;
}

export async function requestNarrative({ provider, executiveSummary, facts }) {
  const { data } = await axiosInstance.post("/ai/narrative", { provider, executiveSummary, facts });
  return data;
}

export async function requestExploration({ provider, question, scopeLabel, records }) {
  const { data } = await axiosInstance.post("/ai/explore", { provider, question, scopeLabel, records });
  return data;
}

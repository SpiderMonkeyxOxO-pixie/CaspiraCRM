import { describe, it, expect, beforeEach, vi } from "vitest";
import { configureStore } from "@reduxjs/toolkit";

const mockFetchProviderStatus = vi.fn();
const mockRequestNarrative = vi.fn();
vi.mock("../../pages/AI/aiGatewayClient", () => ({
  fetchProviderStatus: (...args) => mockFetchProviderStatus(...args),
  requestNarrative: (...args) => mockRequestNarrative(...args),
}));

import aiReducer, {
  generateAnalysis, cancelGeneration, dismissInsight, restoreInsight, setFeedback,
  recordActionApplied, markActionUndone, selectIsAnalysisStale,
  fetchAiProviderStatus, enhanceNarrative, selectAiProviders, selectAiNarrative,
} from "./aiSlice";
import leadsReducer from "../crm/leadsSlice";
import companiesReducer from "../crm/companiesSlice";
import contactsReducer from "../crm/contactsSlice";
import dealsReducer from "../crm/dealsSlice";
import activitiesReducer from "../crm/activitiesSlice";
import quotesReducer from "../sales/quotesSlice";
import ordersReducer from "../sales/ordersSlice";
import contractsReducer from "../sales/contractsSlice";
import { createAnalysisRequest } from "../../pages/AI/aiTypes";

function makeStore() {
  return configureStore({
    reducer: {
      ai: aiReducer, leads: leadsReducer, companies: companiesReducer, contacts: contactsReducer,
      deals: dealsReducer, activities: activitiesReducer, quotes: quotesReducer, orders: ordersReducer, contracts: contractsReducer,
    },
  });
}

describe("aiSlice — session-only AI Intelligence state", () => {
  // The mock API layer reads the active role from localStorage (see
  // mockApi.js's getCurrentRole), independent of Redux — every test that
  // dispatches generateAnalysis needs a role there or the mock's own
  // permission checks reject the underlying fetch thunks.
  beforeEach(() => {
    localStorage.setItem("role", "Super-Admin");
    localStorage.setItem("isLoggedIn", "true");
    mockFetchProviderStatus.mockReset();
    mockRequestNarrative.mockReset();
  });

  it("starts idle with no analysis and nothing persisted from a prior session", () => {
    const store = makeStore();
    const state = store.getState().ai;
    expect(state.status).toBe("idle");
    expect(state.response).toBeNull();
    expect(state.dismissedIds).toEqual([]);
  });

  it("moves through generating stages and lands on ready with a response", async () => {
    const store = makeStore();
    const request = createAnalysisRequest({ userId: "u1", role: "Super-Admin", scope: "all", dateRange: { preset: "thisMonth" } });
    const promise = store.dispatch(generateAnalysis(request));
    expect(store.getState().ai.status).toBe("generating");
    await promise;
    const finalState = store.getState().ai;
    expect(finalState.status).toBe("ready");
    expect(finalState.response).not.toBeNull();
    expect(finalState.response.providerStatus.status).toBe("Frontend Analysis Preview");
    expect(finalState.stage).toBeNull();
  });

  it("cancelling before completion returns to idle, not error", async () => {
    const store = makeStore();
    const request = createAnalysisRequest({ userId: "u1", role: "Super-Admin", scope: "all", dateRange: { preset: "thisMonth" } });
    const promise = store.dispatch(generateAnalysis(request));
    store.dispatch(cancelGeneration());
    await promise;
    expect(store.getState().ai.status).toBe("idle");
    expect(store.getState().ai.response).toBeNull();
  });

  it("dismiss and restore toggle an insight id in dismissedIds", () => {
    const store = makeStore();
    store.dispatch(dismissInsight("insight-1"));
    expect(store.getState().ai.dismissedIds).toContain("insight-1");
    store.dispatch(restoreInsight("insight-1"));
    expect(store.getState().ai.dismissedIds).not.toContain("insight-1");
  });

  it("dismissing the same insight twice does not duplicate it", () => {
    const store = makeStore();
    store.dispatch(dismissInsight("insight-1"));
    store.dispatch(dismissInsight("insight-1"));
    expect(store.getState().ai.dismissedIds).toEqual(["insight-1"]);
  });

  it("feedback is recorded per insight id and can carry a reason", () => {
    const store = makeStore();
    store.dispatch(setFeedback({ insightId: "insight-1", feedback: { state: "helpful", reason: null } }));
    expect(store.getState().ai.feedbackByInsightId["insight-1"]).toEqual({ state: "helpful", reason: null });
    store.dispatch(setFeedback({ insightId: "insight-2", feedback: { state: "incorrect", reason: "Already resolved" } }));
    expect(store.getState().ai.feedbackByInsightId["insight-2"].reason).toBe("Already resolved");
  });

  it("a fresh generation clears feedback and dismissals from the prior run", async () => {
    const store = makeStore();
    store.dispatch(dismissInsight("stale-insight"));
    store.dispatch(setFeedback({ insightId: "stale-insight", feedback: { state: "helpful" } }));
    const request = createAnalysisRequest({ userId: "u1", role: "Super-Admin", scope: "all", dateRange: { preset: "thisMonth" } });
    await store.dispatch(generateAnalysis(request));
    expect(store.getState().ai.dismissedIds).toEqual([]);
    expect(store.getState().ai.feedbackByInsightId).toEqual({});
  });

  it("recordActionApplied logs an action and markActionUndone flips its undone flag", () => {
    const store = makeStore();
    store.dispatch(recordActionApplied({ id: "a1", insightId: "i1", actionType: "assign_owner", label: "Assign owner", summary: "Assigned Priya Nair", appliedAt: new Date().toISOString(), undo: { type: "updateDeal", dealId: "d1", previousValues: { ownerId: null } } }));
    expect(store.getState().ai.actionHistory).toHaveLength(1);
    expect(store.getState().ai.actionHistory[0].undone).toBe(false);
    store.dispatch(markActionUndone("a1"));
    expect(store.getState().ai.actionHistory[0].undone).toBe(true);
  });

  it("selectIsAnalysisStale is false immediately after a fresh generation", async () => {
    const store = makeStore();
    const request = createAnalysisRequest({ userId: "u1", role: "Super-Admin", scope: "all", dateRange: { preset: "thisMonth" } });
    await store.dispatch(generateAnalysis(request));
    expect(selectIsAnalysisStale(store.getState())).toBe(false);
  });

  it("selectIsAnalysisStale is false before any analysis has ever run", () => {
    const store = makeStore();
    expect(selectIsAnalysisStale(store.getState())).toBe(false);
  });

  it("Auditor/Checker — who the mock API blocks from CRM/Sales endpoints — still reaches ready, not error", async () => {
    localStorage.setItem("role", "Checker");
    const store = makeStore();
    const request = createAnalysisRequest({ userId: "u1", role: "Checker", scope: "all", dateRange: { preset: "thisMonth" } });
    await store.dispatch(generateAnalysis(request));
    const state = store.getState().ai;
    expect(state.status).toBe("ready");
    expect(state.response).not.toBeNull();
    expect(state.response.limitations.some((l) => /does not have direct access/.test(l))).toBe(true);
  });

  describe("real AI gateway integration", () => {
    it("fetchAiProviderStatus populates the providers list on success", async () => {
      mockFetchProviderStatus.mockResolvedValue([{ id: "anthropic", label: "Anthropic (Claude)", configured: false, defaultModel: "m" }]);
      const store = makeStore();
      await store.dispatch(fetchAiProviderStatus());
      const providers = selectAiProviders(store.getState());
      expect(providers.status).toBe("ready");
      expect(providers.list).toHaveLength(1);
    });

    it("fetchAiProviderStatus lands on error without touching the deterministic response", async () => {
      mockFetchProviderStatus.mockRejectedValue(new Error("network down"));
      const store = makeStore();
      await store.dispatch(fetchAiProviderStatus());
      expect(selectAiProviders(store.getState()).status).toBe("error");
      expect(store.getState().ai.response).toBeNull();
    });

    it("enhanceNarrative is rejected when no analysis has been generated yet", async () => {
      const store = makeStore();
      await store.dispatch(enhanceNarrative("anthropic"));
      expect(selectAiNarrative(store.getState()).status).toBe("error");
      expect(mockRequestNarrative).not.toHaveBeenCalled();
    });

    it("enhanceNarrative stores the returned narrative text and provider without altering the deterministic response", async () => {
      mockRequestNarrative.mockResolvedValue({
        narrative: "A rewritten, verified narrative.", numbersVerified: true,
        provider: { id: "anthropic", label: "Anthropic (Claude)", model: "m" },
      });
      const store = makeStore();
      const request = createAnalysisRequest({ userId: "u1", role: "Super-Admin", scope: "all", dateRange: { preset: "thisMonth" } });
      await store.dispatch(generateAnalysis(request));
      const originalSummary = store.getState().ai.response.executiveSummary;

      await store.dispatch(enhanceNarrative("anthropic"));
      const state = store.getState().ai;
      expect(state.narrative.status).toBe("ready");
      expect(state.narrative.text).toBe("A rewritten, verified narrative.");
      expect(state.narrative.provider.id).toBe("anthropic");
      expect(state.narrative.numbersVerified).toBe(true);
      expect(state.response.executiveSummary).toBe(originalSummary); // never overwritten
    });

    it("enhanceNarrative failure only touches narrative state, never the deterministic response", async () => {
      mockRequestNarrative.mockRejectedValue({ response: { data: { message: "No AI provider is configured on this server." } } });
      const store = makeStore();
      const request = createAnalysisRequest({ userId: "u1", role: "Super-Admin", scope: "all", dateRange: { preset: "thisMonth" } });
      await store.dispatch(generateAnalysis(request));

      await store.dispatch(enhanceNarrative("anthropic"));
      const state = store.getState().ai;
      expect(state.narrative.status).toBe("error");
      expect(state.narrative.error).toBe("No AI provider is configured on this server.");
      expect(state.status).toBe("ready");
      expect(state.response).not.toBeNull();
    });

    it("a fresh generateAnalysis call resets a previously-ready narrative", async () => {
      mockRequestNarrative.mockResolvedValue({ narrative: "Old narrative.", numbersVerified: true, provider: { id: "anthropic", label: "Anthropic (Claude)", model: "m" } });
      const store = makeStore();
      const request = createAnalysisRequest({ userId: "u1", role: "Super-Admin", scope: "all", dateRange: { preset: "thisMonth" } });
      await store.dispatch(generateAnalysis(request));
      await store.dispatch(enhanceNarrative("anthropic"));
      expect(selectAiNarrative(store.getState()).status).toBe("ready");

      await store.dispatch(generateAnalysis(request));
      expect(selectAiNarrative(store.getState()).status).toBe("idle");
      expect(selectAiNarrative(store.getState()).text).toBeNull();
    });
  });
});

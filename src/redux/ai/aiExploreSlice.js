import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { fetchAllMatchingLeads } from "../crm/leadsSlice";
import { fetchContacts } from "../crm/contactsSlice";
import { fetchCompanies } from "../crm/companiesSlice";
import { fetchDeals } from "../crm/dealsSlice";
import { fetchActivities } from "../crm/activitiesSlice";
import { fetchQuotes } from "../sales/quotesSlice";
import { fetchOrders } from "../sales/ordersSlice";
import { fetchContracts } from "../sales/contractsSlice";
import { createAnalysisRequest } from "../../pages/AI/aiTypes";
import { AI_VIEWS, defaultViewForRole, defaultScopeForRole } from "../../pages/AI/aiConfig";
import { scopeSharedData } from "../../pages/AI/aiInsightEngine";
import { buildExploreRecordsPayload, findingToPseudoInsight } from "../../pages/AI/aiExploreEngine";
import { requestExploration } from "../../pages/AI/aiGatewayClient";

// AI Explore Mode — deliberately its own slice, separate from aiCopilotSlice
// (deterministic chat answers) and aiSlice (the deterministic Overview
// analysis). A finding here is a real AI model's free-form reasoning over
// raw records: never verified, never mixed into aiCopilot's `messages`, and
// rendered in its own visually distinct card (AiExploreResultCard.jsx) so
// it can never be mistaken for a deterministic answer or insight.
export const runExploration = createAsyncThunk(
  "aiExplore/run",
  async ({ question, providerId } = {}, { dispatch, getState, rejectWithValue }) => {
    // Same permission boundary as aiSlice/aiCopilotSlice: some roles
    // (Auditor/Checker) are not authorized for every CRM/Sales mock
    // endpoint, so each fetch is awaited independently.
    let leadsResult = [];
    await Promise.all([
      dispatch(fetchAllMatchingLeads({})).unwrap().then((r) => { leadsResult = r; }).catch(() => {}),
      dispatch(fetchContacts({ pageSize: 1000 })),
      dispatch(fetchCompanies()),
      dispatch(fetchDeals()),
      dispatch(fetchActivities()),
      dispatch(fetchQuotes()),
      dispatch(fetchOrders()),
      dispatch(fetchContracts()),
    ]);

    const state = getState();
    const role = state.auth.role;
    const sharedData = {
      deals: state.deals.items, leads: leadsResult, companies: state.companies.items,
      contacts: state.contacts.items, activities: state.activities.items,
      quotes: state.quotes.items, orders: state.orders.items, contracts: state.contracts.items,
    };
    const request = createAnalysisRequest({ userId: "u1", role, scope: defaultScopeForRole(role), dateRange: { preset: "thisMonth" } });
    const scoped = scopeSharedData(sharedData, request);
    const records = buildExploreRecordsPayload(scoped, role);
    const scopeLabel = AI_VIEWS.find((v) => v.id === defaultViewForRole(role))?.label || "Current scope";

    try {
      const result = await requestExploration({ provider: providerId, question, scopeLabel, records });
      return {
        id: `explore-run-${Date.now()}`,
        question: question || null,
        insights: result.findings.map((finding) => findingToPseudoInsight(finding, scoped, role)),
        provider: result.provider,
        truncated: result.truncated,
        disclaimer: result.disclaimer,
        createdAt: result.generatedAt || new Date().toISOString(),
      };
    } catch (err) {
      return rejectWithValue(err.response?.data?.message || "The AI provider could not complete this exploration right now.");
    }
  }
);

const initialState = {
  status: "idle", // idle | loading | error
  findings: [], // AiExploreResultCard "runs" — newest first, session-only
  error: null,
};

const aiExploreSlice = createSlice({
  name: "aiExplore",
  initialState,
  reducers: {
    clearExploration(state) {
      state.findings = [];
      state.status = "idle";
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(runExploration.pending, (state) => {
        state.status = "loading";
        state.error = null;
      })
      .addCase(runExploration.fulfilled, (state, action) => {
        state.status = "idle";
        state.findings.unshift(action.payload);
      })
      .addCase(runExploration.rejected, (state, action) => {
        state.status = "error";
        state.error = action.payload || "The AI provider could not complete this exploration right now.";
      });
  },
});

export const { clearExploration } = aiExploreSlice.actions;
export default aiExploreSlice.reducer;

export function selectAiExplore(state) {
  return state.aiExplore;
}

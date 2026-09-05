import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { fetchAllMatchingLeads } from "../crm/leadsSlice";
import { fetchContacts } from "../crm/contactsSlice";
import { fetchCompanies } from "../crm/companiesSlice";
import { fetchDeals } from "../crm/dealsSlice";
import { fetchActivities } from "../crm/activitiesSlice";
import { fetchQuotes } from "../sales/quotesSlice";
import { fetchOrders } from "../sales/ordersSlice";
import { fetchContracts } from "../sales/contractsSlice";
import { generateAnalysisPreview, computeCompactMetrics } from "../../pages/AI/aiInsightEngine";
import { fetchProviderStatus, requestNarrative } from "../../pages/AI/aiGatewayClient";

// Session-only AI Intelligence state. Nothing here is written to
// localStorage — a refresh clears feedback, dismissals and the last
// analysis, matching the "current-session in-memory state" requirement.
// Generation is entirely local computation over already-shared Redux data;
// this thunk never calls fetch/axios itself for "the analysis" step, only
// to (re)load the same shared CRM/Sales records every other completed
// route already fetches.
export const GENERATION_STAGES = [
  { id: "scope", label: "Checking authorized scope" },
  { id: "calculate", label: "Calculating CRM metrics" },
  { id: "detect", label: "Detecting risks and opportunities" },
  { id: "evidence", label: "Connecting supporting evidence" },
  { id: "summary", label: "Preparing summary" },
];
const STAGE_DELAY_MS = 180;

function computeSnapshotSignature(sharedData) {
  let latest = null;
  let count = 0;
  for (const arr of Object.values(sharedData)) {
    count += arr.length;
    for (const r of arr) {
      const ts = r.updatedAt || r.createdAt;
      if (ts && (!latest || new Date(ts) > new Date(latest))) latest = ts;
    }
  }
  return `${count}:${latest || "none"}`;
}

export const generateAnalysis = createAsyncThunk(
  "ai/generateAnalysis",
  async (request, { dispatch, getState, rejectWithValue }) => {
    // Some roles (Auditor/Checker) are not authorized for the CRM/Sales mock
    // endpoints at all — the same permission boundary RequireAuth already
    // enforces for those routes. Each fetch is awaited independently so one
    // role-based 403 degrades that module to an empty array (reflected
    // honestly in Limitations) instead of aborting the whole analysis.
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

    for (const stage of GENERATION_STAGES) {
      if (getState().ai.cancelRequested) return rejectWithValue("cancelled");
      dispatch(aiSlice.actions.setStage(stage.id));
      // Short, real (not decorative) pauses so each stage is readable and
      // screen-reader announceable — never a long artificial delay.
      await new Promise((resolve) => setTimeout(resolve, STAGE_DELAY_MS));
    }
    if (getState().ai.cancelRequested) return rejectWithValue("cancelled");

    const state = getState();
    const sharedData = {
      deals: state.deals.items, leads: leadsResult, companies: state.companies.items,
      contacts: state.contacts.items, activities: state.activities.items,
      quotes: state.quotes.items, orders: state.orders.items, contracts: state.contracts.items,
    };
    try {
      const response = generateAnalysisPreview(request, sharedData);
      // Leads are excluded from the staleness signature: the full
      // unpaginated list only exists as this thunk's local result, not as
      // persisted Redux state, so there's nothing to re-read for a live
      // comparison later. Every other shared module is included and is
      // enough to detect the common case the Stale state exists for.
      const { leads: _leads, ...signatureInput } = sharedData;
      return { response, request, snapshot: computeSnapshotSignature(signatureInput) };
    } catch {
      return rejectWithValue("Something went wrong while preparing the analysis.");
    }
  }
);

const initialNarrativeState = { status: "idle", text: null, provider: null, numbersVerified: null, error: null };

const initialState = {
  status: "idle", // idle | generating | ready | error
  stage: null,
  response: null,
  request: null,
  snapshot: null,
  error: null,
  cancelRequested: false,
  dismissedIds: [],
  feedbackByInsightId: {},
  actionHistory: [], // { id, insightId, actionType, label, summary, appliedAt, undo: {type, payload} | null, undone }
  // Real AI gateway state — layered on top of the deterministic analysis
  // above, never replacing it. providers/narrative failing never touches
  // `response`, so the local engine's "always works" guarantee holds
  // regardless of network/gateway state.
  providers: { list: [], status: "idle" }, // idle | loading | ready | error
  narrative: initialNarrativeState, // idle | loading | ready | error
};

// Only the strings/counts a narrative is allowed to reference — every
// number here is already role-masked (see moneyFor() in aiInsightEngine.js)
// before it ever leaves the browser, and the backend's verifyNoNewNumbers
// guardrail rejects anything the model says that isn't traceable back to
// one of these.
function buildNarrativeFacts(response, metrics) {
  return {
    executiveSummary: response.executiveSummary,
    criticalRisks: metrics.criticalRisks,
    opportunities: metrics.opportunities,
    suggestedActions: metrics.suggestedActions,
    recordsNeedingAttention: metrics.recordsNeedingAttention,
    dataQualityIssues: metrics.dataQualityIssues,
    highConfidenceShare: metrics.highConfidenceShare,
  };
}

export const fetchAiProviderStatus = createAsyncThunk(
  "ai/fetchAiProviderStatus",
  async (_arg, { rejectWithValue }) => {
    try {
      return await fetchProviderStatus();
    } catch {
      return rejectWithValue("Could not check AI provider availability.");
    }
  }
);

export const enhanceNarrative = createAsyncThunk(
  "ai/enhanceNarrative",
  async (providerId, { getState, rejectWithValue }) => {
    const { response } = getState().ai;
    if (!response) return rejectWithValue("Generate an analysis before requesting a live narrative.");
    const facts = buildNarrativeFacts(response, computeCompactMetrics(response));
    try {
      return await requestNarrative({ provider: providerId, executiveSummary: response.executiveSummary, facts });
    } catch (err) {
      return rejectWithValue(err.response?.data?.message || "The AI provider could not generate a narrative right now.");
    }
  }
);

const aiSlice = createSlice({
  name: "ai",
  initialState,
  reducers: {
    setStage(state, action) {
      state.stage = action.payload;
    },
    cancelGeneration(state) {
      if (state.status === "generating") state.cancelRequested = true;
    },
    dismissInsight(state, action) {
      if (!state.dismissedIds.includes(action.payload)) state.dismissedIds.push(action.payload);
    },
    restoreInsight(state, action) {
      state.dismissedIds = state.dismissedIds.filter((id) => id !== action.payload);
    },
    setFeedback(state, action) {
      const { insightId, feedback } = action.payload;
      state.feedbackByInsightId[insightId] = feedback;
    },
    clearFeedback(state, action) {
      delete state.feedbackByInsightId[action.payload];
    },
    recordActionApplied(state, action) {
      state.actionHistory.unshift({ ...action.payload, undone: false });
    },
    markActionUndone(state, action) {
      const entry = state.actionHistory.find((a) => a.id === action.payload);
      if (entry) entry.undone = true;
    },
    resetAnalysis(state) {
      Object.assign(state, initialState);
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(generateAnalysis.pending, (state) => {
        state.status = "generating";
        state.stage = null;
        state.error = null;
        state.cancelRequested = false;
      })
      .addCase(generateAnalysis.fulfilled, (state, action) => {
        state.status = "ready";
        state.stage = null;
        state.response = action.payload.response;
        state.request = action.payload.request;
        state.snapshot = action.payload.snapshot;
        state.dismissedIds = [];
        state.feedbackByInsightId = {};
        // A stale AI narrative must never survive a fresh deterministic
        // regeneration — it was written about the previous response.
        state.narrative = initialNarrativeState;
      })
      .addCase(generateAnalysis.rejected, (state, action) => {
        state.stage = null;
        if (action.payload === "cancelled") {
          state.status = "idle";
        } else {
          state.status = "error";
          state.error = action.payload || "Something went wrong while preparing the analysis.";
        }
        state.cancelRequested = false;
      })
      .addCase(fetchAiProviderStatus.pending, (state) => {
        state.providers.status = "loading";
      })
      .addCase(fetchAiProviderStatus.fulfilled, (state, action) => {
        state.providers.status = "ready";
        state.providers.list = action.payload;
      })
      .addCase(fetchAiProviderStatus.rejected, (state) => {
        state.providers.status = "error";
        state.providers.list = [];
      })
      .addCase(enhanceNarrative.pending, (state) => {
        state.narrative.status = "loading";
        state.narrative.error = null;
      })
      .addCase(enhanceNarrative.fulfilled, (state, action) => {
        state.narrative.status = "ready";
        state.narrative.text = action.payload.narrative;
        state.narrative.provider = action.payload.provider;
        state.narrative.numbersVerified = action.payload.numbersVerified;
      })
      .addCase(enhanceNarrative.rejected, (state, action) => {
        state.narrative.status = "error";
        state.narrative.error = action.payload || "The AI provider could not generate a narrative right now.";
      });
  },
});

export const {
  cancelGeneration, dismissInsight, restoreInsight, setFeedback, clearFeedback,
  recordActionApplied, markActionUndone, resetAnalysis,
} = aiSlice.actions;

export default aiSlice.reducer;

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------
export function selectAiState(state) {
  return state.ai;
}

export function selectAiProviders(state) {
  return state.ai.providers;
}

export function selectAiNarrative(state) {
  return state.ai.narrative;
}

export function selectIsAnalysisStale(state) {
  const { response, snapshot } = state.ai;
  if (!response || !snapshot) return false;
  const current = computeSnapshotSignature({
    deals: state.deals.items, companies: state.companies.items, contacts: state.contacts.items,
    activities: state.activities.items, quotes: state.quotes.items, orders: state.orders.items, contracts: state.contracts.items,
  });
  return current !== snapshot;
}

export { computeSnapshotSignature };

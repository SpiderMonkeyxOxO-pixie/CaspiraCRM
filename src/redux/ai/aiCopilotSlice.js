import { createAsyncThunk, createSlice, nanoid, current } from "@reduxjs/toolkit";
import { fetchAllMatchingLeads } from "../crm/leadsSlice";
import { fetchContacts } from "../crm/contactsSlice";
import { fetchCompanies } from "../crm/companiesSlice";
import { fetchDeals } from "../crm/dealsSlice";
import { fetchActivities } from "../crm/activitiesSlice";
import { fetchQuotes } from "../sales/quotesSlice";
import { fetchOrders } from "../sales/ordersSlice";
import { fetchContracts } from "../sales/contractsSlice";
import { answerCopilotQuestion } from "../../pages/AI/aiCopilotEngine";
import { createAnalysisRequest } from "../../pages/AI/aiTypes";
import { defaultScopeForRole } from "../../pages/AI/aiConfig";

// Chat state is organized into multiple named conversations (New Chat /
// History / Saved / Pinned) rather than one flat message list. Unlike the
// rest of the AI Intelligence Center's session-only state, conversations
// ARE persisted (to localStorage, browser-local only — never sent anywhere)
// since a "History" feature that vanishes on refresh isn't meaningfully
// history. The "thinking" pause is short and real (data actually loads
// during it), never a decorative artificial delay.
const THINKING_DELAY_MS = 250;
const STORAGE_KEY = "aiCopilotConversations";
const MAX_TITLE_LENGTH = 42;

function deriveTitle(text) {
  const trimmed = text.trim();
  return trimmed.length > MAX_TITLE_LENGTH ? `${trimmed.slice(0, MAX_TITLE_LENGTH)}…` : trimmed;
}

function makeConversation() {
  const now = new Date().toISOString();
  return { id: nanoid(), title: "New chat", messages: [], pinned: false, saved: false, createdAt: now, updatedAt: now };
}

function loadPersisted() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.conversations) || parsed.conversations.length === 0) return null;
    if (!parsed.conversations.some((c) => c.id === parsed.activeId)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function persist(conversations, activeId) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ conversations, activeId }));
  } catch {
    // Storage full/unavailable (private browsing, quota) — chat still works
    // for the rest of this session, it just won't be restored next time.
  }
}

// Always unwraps the top-level `state` param (guaranteed to still be a live
// Immer draft) rather than a property read off it — a reducer like
// deleteConversation reassigns state.conversations to a plain array (the
// result of .filter()), and current() throws if handed something that
// isn't itself a draft.
function persistState(state) {
  const snapshot = current(state);
  persist(snapshot.conversations, snapshot.activeId);
}

export const sendCopilotMessage = createAsyncThunk(
  "aiCopilot/sendMessage",
  async (text, { dispatch, getState, rejectWithValue }) => {
    const trimmed = text.trim();
    if (!trimmed) return rejectWithValue("empty");

    dispatch(aiCopilotSlice.actions.addUserMessage(trimmed));

    // Same permission boundary as the Overview: some roles (Auditor/Checker)
    // are not authorized for every CRM/Sales mock endpoint, so each fetch is
    // awaited independently — one role-based 403 degrades that module to an
    // empty array instead of failing the whole answer.
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

    await new Promise((resolve) => setTimeout(resolve, THINKING_DELAY_MS));

    const role = getState().auth.role;
    const state = getState();
    const sharedData = {
      deals: state.deals.items, leads: leadsResult, companies: state.companies.items,
      contacts: state.contacts.items, activities: state.activities.items,
      quotes: state.quotes.items, orders: state.orders.items, contracts: state.contracts.items,
    };
    const request = createAnalysisRequest({ userId: "u1", role, scope: defaultScopeForRole(role), dateRange: { preset: "thisMonth" } });

    try {
      return answerCopilotQuestion(trimmed, request, sharedData);
    } catch {
      return rejectWithValue("Something went wrong while preparing that answer.");
    }
  }
);

function buildInitialState() {
  const persisted = loadPersisted();
  if (persisted) return { conversations: persisted.conversations, activeId: persisted.activeId, status: "idle", error: null };
  const conversation = makeConversation();
  return { conversations: [conversation], activeId: conversation.id, status: "idle", error: null };
}

const initialState = buildInitialState();

function activeConversation(state) {
  return state.conversations.find((c) => c.id === state.activeId);
}

const aiCopilotSlice = createSlice({
  name: "aiCopilot",
  initialState,
  reducers: {
    addUserMessage(state, action) {
      const convo = activeConversation(state);
      if (!convo) return;
      convo.messages.push({ id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, role: "user", text: action.payload, createdAt: new Date().toISOString() });
      if (convo.messages.length === 1) convo.title = deriveTitle(action.payload);
      convo.updatedAt = new Date().toISOString();
      persistState(state);
    },
    startNewChat(state) {
      const convo = makeConversation();
      state.conversations.unshift(convo);
      state.activeId = convo.id;
      state.status = "idle";
      state.error = null;
      persistState(state);
    },
    selectConversation(state, action) {
      if (!state.conversations.some((c) => c.id === action.payload)) return;
      state.activeId = action.payload;
      state.status = "idle";
      state.error = null;
    },
    deleteConversation(state, action) {
      state.conversations = state.conversations.filter((c) => c.id !== action.payload);
      if (state.conversations.length === 0) {
        const convo = makeConversation();
        state.conversations.push(convo);
        state.activeId = convo.id;
      } else if (state.activeId === action.payload) {
        state.activeId = state.conversations[0].id;
      }
      persistState(state);
    },
    togglePinned(state, action) {
      const convo = state.conversations.find((c) => c.id === action.payload);
      if (!convo) return;
      convo.pinned = !convo.pinned;
      persistState(state);
    },
    toggleSaved(state, action) {
      const convo = state.conversations.find((c) => c.id === action.payload);
      if (!convo) return;
      convo.saved = !convo.saved;
      persistState(state);
    },
    clearConversation(state) {
      const convo = activeConversation(state);
      if (convo) {
        convo.messages = [];
        convo.title = "New chat";
        convo.updatedAt = new Date().toISOString();
      }
      state.status = "idle";
      state.error = null;
      persistState(state);
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(sendCopilotMessage.pending, (state) => {
        state.status = "thinking";
        state.error = null;
      })
      .addCase(sendCopilotMessage.fulfilled, (state, action) => {
        state.status = "idle";
        const convo = activeConversation(state);
        if (convo) {
          convo.messages.push(action.payload);
          convo.updatedAt = new Date().toISOString();
        }
        persistState(state);
      })
      .addCase(sendCopilotMessage.rejected, (state, action) => {
        state.status = action.payload === "empty" ? "idle" : "error";
        if (action.payload !== "empty") state.error = action.payload || "Something went wrong while preparing that answer.";
      });
  },
});

export const { startNewChat, selectConversation, deleteConversation, togglePinned, toggleSaved, clearConversation } = aiCopilotSlice.actions;
export default aiCopilotSlice.reducer;

export function selectActiveConversation(state) {
  return activeConversation(state.aiCopilot) || state.aiCopilot.conversations[0];
}

export function selectConversations(state) {
  return state.aiCopilot.conversations;
}

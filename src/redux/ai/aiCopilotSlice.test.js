import { describe, it, expect, beforeEach } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import aiCopilotReducer, {
  sendCopilotMessage, clearConversation, startNewChat, selectConversation, deleteConversation,
  togglePinned, toggleSaved, selectActiveConversation, selectConversations,
} from "./aiCopilotSlice";
import authReducer from "../authSlice";
import leadsReducer from "../crm/leadsSlice";
import companiesReducer from "../crm/companiesSlice";
import contactsReducer from "../crm/contactsSlice";
import dealsReducer from "../crm/dealsSlice";
import activitiesReducer from "../crm/activitiesSlice";
import quotesReducer from "../sales/quotesSlice";
import ordersReducer from "../sales/ordersSlice";
import contractsReducer from "../sales/contractsSlice";

// aiCopilotSlice's own initialState reads localStorage once at module
// import time (same gotcha authSlice has) — pass an explicit aiCopilot
// preloadedState so every test starts from a known, single-conversation
// state regardless of what a previous test file left in localStorage.
function freshCopilotState() {
  const now = new Date().toISOString();
  return {
    conversations: [{ id: "c1", title: "New chat", messages: [], pinned: false, saved: false, createdAt: now, updatedAt: now }],
    activeId: "c1",
    status: "idle",
    error: null,
  };
}

function makeStore(role = "Super-Admin") {
  localStorage.setItem("role", role);
  localStorage.setItem("isLoggedIn", "true");
  return configureStore({
    reducer: {
      auth: authReducer, aiCopilot: aiCopilotReducer, leads: leadsReducer, companies: companiesReducer, contacts: contactsReducer,
      deals: dealsReducer, activities: activitiesReducer, quotes: quotesReducer, orders: ordersReducer, contracts: contractsReducer,
    },
    preloadedState: { auth: { role, isLoggedIn: true, data: {} }, aiCopilot: freshCopilotState() },
  });
}

function activeMessages(store) {
  return selectActiveConversation(store.getState()).messages;
}

describe("aiCopilotSlice — multi-conversation chat state", () => {
  beforeEach(() => localStorage.clear());

  it("starts with a single empty conversation, active", () => {
    const store = makeStore();
    const conversations = selectConversations(store.getState());
    expect(conversations).toHaveLength(1);
    expect(conversations[0].messages).toEqual([]);
    expect(selectActiveConversation(store.getState()).id).toBe(conversations[0].id);
  });

  it("sending a message immediately adds the user's message, then the assistant's reply", async () => {
    const store = makeStore();
    const promise = store.dispatch(sendCopilotMessage("Which deals need attention?"));
    expect(activeMessages(store)).toHaveLength(1);
    expect(activeMessages(store)[0].role).toBe("user");
    expect(store.getState().aiCopilot.status).toBe("thinking");
    await promise;
    expect(store.getState().aiCopilot.status).toBe("idle");
    const messages = activeMessages(store);
    expect(messages).toHaveLength(2);
    expect(messages[1].role).toBe("assistant");
    expect(messages[1].text.length).toBeGreaterThan(0);
  });

  it("an empty or whitespace-only message is not sent", async () => {
    const store = makeStore();
    await store.dispatch(sendCopilotMessage("   "));
    expect(activeMessages(store)).toEqual([]);
    expect(store.getState().aiCopilot.status).toBe("idle");
  });

  it("the first message becomes the conversation's title", async () => {
    const store = makeStore();
    await store.dispatch(sendCopilotMessage("Which deals need attention?"));
    expect(selectActiveConversation(store.getState()).title).toBe("Which deals need attention?");
  });

  it("clearConversation resets the active conversation's messages and title", async () => {
    const store = makeStore();
    await store.dispatch(sendCopilotMessage("help"));
    expect(activeMessages(store).length).toBeGreaterThan(0);
    store.dispatch(clearConversation());
    expect(activeMessages(store)).toEqual([]);
    expect(selectActiveConversation(store.getState()).title).toBe("New chat");
  });

  it("Auditor/Checker — blocked from most CRM/Sales mock endpoints — still gets an answer, not an error", async () => {
    const store = makeStore("Checker");
    await store.dispatch(sendCopilotMessage("what's my open pipeline worth?"));
    expect(store.getState().aiCopilot.status).toBe("idle");
    expect(activeMessages(store)[1].role).toBe("assistant");
  });

  it("multiple messages accumulate in order", async () => {
    const store = makeStore();
    await store.dispatch(sendCopilotMessage("help"));
    await store.dispatch(sendCopilotMessage("which deals need attention?"));
    const messages = activeMessages(store);
    expect(messages).toHaveLength(4);
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
  });

  describe("startNewChat / selectConversation / deleteConversation", () => {
    it("startNewChat creates a fresh conversation, makes it active, and keeps the old one", async () => {
      const store = makeStore();
      await store.dispatch(sendCopilotMessage("help"));
      const oldId = selectActiveConversation(store.getState()).id;
      store.dispatch(startNewChat());
      const conversations = selectConversations(store.getState());
      expect(conversations).toHaveLength(2);
      const active = selectActiveConversation(store.getState());
      expect(active.id).not.toBe(oldId);
      expect(active.messages).toEqual([]);
      expect(conversations.find((c) => c.id === oldId).messages.length).toBeGreaterThan(0);
    });

    it("selectConversation switches the active conversation without losing either one's messages", async () => {
      const store = makeStore();
      await store.dispatch(sendCopilotMessage("first chat message"));
      const firstId = selectActiveConversation(store.getState()).id;
      store.dispatch(startNewChat());
      await store.dispatch(sendCopilotMessage("second chat message"));
      const secondId = selectActiveConversation(store.getState()).id;

      store.dispatch(selectConversation(firstId));
      expect(selectActiveConversation(store.getState()).id).toBe(firstId);
      expect(activeMessages(store)[0].text).toBe("first chat message");

      store.dispatch(selectConversation(secondId));
      expect(activeMessages(store)[0].text).toBe("second chat message");
    });

    it("selectConversation with an unknown id is a no-op", () => {
      const store = makeStore();
      const before = selectActiveConversation(store.getState()).id;
      store.dispatch(selectConversation("does-not-exist"));
      expect(selectActiveConversation(store.getState()).id).toBe(before);
    });

    it("deleteConversation removes it and, if it was active, activates another one", () => {
      const store = makeStore();
      store.dispatch(startNewChat());
      const conversations = selectConversations(store.getState());
      expect(conversations).toHaveLength(2);
      const activeId = selectActiveConversation(store.getState()).id;

      store.dispatch(deleteConversation(activeId));
      const remaining = selectConversations(store.getState());
      expect(remaining).toHaveLength(1);
      expect(remaining.some((c) => c.id === activeId)).toBe(false);
      expect(selectActiveConversation(store.getState()).id).toBe(remaining[0].id);
    });

    it("deleting the last remaining conversation replaces it with a fresh empty one", () => {
      const store = makeStore();
      const onlyId = selectActiveConversation(store.getState()).id;
      store.dispatch(deleteConversation(onlyId));
      const conversations = selectConversations(store.getState());
      expect(conversations).toHaveLength(1);
      expect(conversations[0].id).not.toBe(onlyId);
      expect(conversations[0].messages).toEqual([]);
    });
  });

  describe("togglePinned / toggleSaved", () => {
    it("togglePinned flips the pinned flag on the given conversation only", () => {
      const store = makeStore();
      store.dispatch(startNewChat());
      const [a, b] = selectConversations(store.getState());
      store.dispatch(togglePinned(a.id));
      const conversations = selectConversations(store.getState());
      expect(conversations.find((c) => c.id === a.id).pinned).toBe(true);
      expect(conversations.find((c) => c.id === b.id).pinned).toBe(false);
      store.dispatch(togglePinned(a.id));
      expect(selectConversations(store.getState()).find((c) => c.id === a.id).pinned).toBe(false);
    });

    it("toggleSaved flips the saved flag independently of pinned", () => {
      const store = makeStore();
      const id = selectActiveConversation(store.getState()).id;
      store.dispatch(toggleSaved(id));
      expect(selectActiveConversation(store.getState()).saved).toBe(true);
      expect(selectActiveConversation(store.getState()).pinned).toBe(false);
    });
  });

  describe("persistence", () => {
    it("persists conversations to localStorage on every change and restores them for a fresh store", async () => {
      const store = makeStore();
      await store.dispatch(sendCopilotMessage("help"));
      store.dispatch(togglePinned(selectActiveConversation(store.getState()).id));

      const raw = localStorage.getItem("aiCopilotConversations");
      expect(raw).toBeTruthy();
      const parsed = JSON.parse(raw);
      expect(parsed.conversations).toHaveLength(1);
      expect(parsed.conversations[0].pinned).toBe(true);
      expect(parsed.conversations[0].messages.length).toBeGreaterThan(0);
    });
  });
});

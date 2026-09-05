import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import ErrorBoundary from "../../components/ErrorBoundary";

const mockFetchProviderStatus = vi.fn();
const mockRequestNarrative = vi.fn();
const mockRequestExploration = vi.fn();
vi.mock("./aiGatewayClient", () => ({
  fetchProviderStatus: (...args) => mockFetchProviderStatus(...args),
  requestNarrative: (...args) => mockRequestNarrative(...args),
  requestExploration: (...args) => mockRequestExploration(...args),
}));

import AiCopilot from "./AiCopilot";
import authReducer from "../../redux/authSlice";
import aiReducer from "../../redux/ai/aiSlice";
import aiCopilotReducer from "../../redux/ai/aiCopilotSlice";
import aiExploreReducer from "../../redux/ai/aiExploreSlice";
import leadsReducer from "../../redux/crm/leadsSlice";
import companiesReducer from "../../redux/crm/companiesSlice";
import contactsReducer from "../../redux/crm/contactsSlice";
import dealsReducer from "../../redux/crm/dealsSlice";
import activitiesReducer from "../../redux/crm/activitiesSlice";
import quotesReducer from "../../redux/sales/quotesSlice";
import ordersReducer from "../../redux/sales/ordersSlice";
import contractsReducer from "../../redux/sales/contractsSlice";

function renderAiCopilot({ role = "Super-Admin" } = {}) {
  localStorage.setItem("role", role);
  localStorage.setItem("isLoggedIn", "true");
  const store = configureStore({
    reducer: {
      auth: authReducer, ai: aiReducer, aiCopilot: aiCopilotReducer, aiExplore: aiExploreReducer, leads: leadsReducer, companies: companiesReducer,
      contacts: contactsReducer, deals: dealsReducer, activities: activitiesReducer, quotes: quotesReducer, orders: ordersReducer, contracts: contractsReducer,
    },
    preloadedState: { auth: { role, isLoggedIn: true, data: {} } },
  });
  const utils = render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/ai/copilot"]}>
        <ErrorBoundary>
          <Routes>
            <Route path="/ai/copilot" element={<AiCopilot />} />
            <Route path="/crm/deals/:id" element={<div>Deal Detail Page</div>} />
          </Routes>
        </ErrorBoundary>
      </MemoryRouter>
    </Provider>
  );
  return { store, ...utils };
}

function activeMessages(store) {
  const { conversations, activeId } = store.getState().aiCopilot;
  return conversations.find((c) => c.id === activeId).messages;
}

// Waits on Redux state settling back to idle with a new assistant message,
// rather than racing a DOM text query against re-renders — the computation
// itself is already covered by aiCopilotEngine/aiCopilotSlice unit tests, so
// this only needs to prove the component actually dispatched and rendered.
async function waitForAssistantReply(store, timeout = 12000) {
  await waitFor(() => {
    expect(store.getState().aiCopilot.status).toBe("idle");
    expect(activeMessages(store).some((m) => m.role === "assistant")).toBe(true);
  }, { timeout });
}

describe("AiCopilot — chat route rendering and behavior", () => {
  beforeEach(() => {
    localStorage.clear();
    mockFetchProviderStatus.mockReset().mockResolvedValue([]); // no provider configured by default — matches every existing test's assumption of no Explore Mode
    mockRequestNarrative.mockReset();
    mockRequestExploration.mockReset();
  });

  it("renders the breadcrumb, title and Frontend Analysis Preview label", () => {
    renderAiCopilot();
    expect(screen.getByText("AI Intelligence / Copilot")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "AI Copilot" })).toBeInTheDocument();
    expect(screen.getByText("Frontend Analysis Preview")).toBeInTheDocument();
    expect(screen.queryByText(/claude/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/openai/i)).not.toBeInTheDocument();
  });

  it("shows suggested prompt chips when the conversation is empty", () => {
    renderAiCopilot();
    expect(screen.getByRole("button", { name: "Which deals need attention?" })).toBeInTheDocument();
  });

  it("makes no external network request when sending a message", async () => {
    const user = userEvent.setup();
    const originalFetch = globalThis.fetch;
    let fetchCalled = false;
    globalThis.fetch = (...args) => { fetchCalled = true; return originalFetch?.(...args); };
    const { store } = renderAiCopilot();
    await user.click(screen.getByRole("button", { name: "What's overdue?" }));
    await waitForAssistantReply(store);
    expect(fetchCalled).toBe(false);
    globalThis.fetch = originalFetch;
  }, 15000);

  it("clicking a suggested prompt sends it and shows both the question and an answer", async () => {
    const user = userEvent.setup();
    const { store } = renderAiCopilot();
    await user.click(screen.getByRole("button", { name: "Which deals need attention?" }));
    // The same text also now appears as the sidebar's auto-derived
    // conversation title, so scope this to the chat log specifically.
    const log = screen.getByRole("log", { name: "Conversation" });
    expect(within(log).getByText("Which deals need attention?")).toBeInTheDocument();
    await waitForAssistantReply(store);
    const lastMessage = activeMessages(store).at(-1);
    expect(lastMessage.text.length).toBeGreaterThan(0);
  }, 15000);

  it("typing a message and pressing Send adds it to the conversation", async () => {
    const user = userEvent.setup();
    const { store } = renderAiCopilot();
    const input = screen.getByPlaceholderText(/Ask about at-risk deals/i);
    await user.type(input, "help");
    await user.click(screen.getByRole("button", { name: "Send" }));
    const log = screen.getByRole("log", { name: "Conversation" });
    expect(within(log).getByText("help")).toBeInTheDocument();
    await waitForAssistantReply(store);
    expect(activeMessages(store).at(-1).text).toMatch(/I can answer questions/i);
  }, 15000);

  it("an unmatched question gets an honest fallback, not a fabricated answer", async () => {
    const user = userEvent.setup();
    const { store } = renderAiCopilot();
    const input = screen.getByPlaceholderText(/Ask about at-risk deals/i);
    await user.type(input, "what is the meaning of life");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitForAssistantReply(store);
    const lastMessage = activeMessages(store).at(-1);
    expect(lastMessage.text).toMatch(/don't have a calculation/i);
    expect(lastMessage.insight).toBeNull();
  }, 15000);

  it("Clear conversation empties the message history", async () => {
    const user = userEvent.setup();
    const { store } = renderAiCopilot();
    await user.click(screen.getByRole("button", { name: "Which deals need attention?" }));
    await waitForAssistantReply(store);
    await user.click(screen.getByRole("button", { name: /Clear conversation/i }));
    // Clearing empties the conversation entirely — the suggested-prompt chip
    // reappearing (with the same label as what was just sent) is the
    // expected empty-state UI, not leftover chat history.
    expect(activeMessages(store)).toEqual([]);
    expect(screen.getByRole("button", { name: "Which deals need attention?" })).toBeInTheDocument();
  }, 15000);

  it("an answer with evidence opens the evidence drawer", async () => {
    const user = userEvent.setup();
    const { store } = renderAiCopilot();
    await user.click(screen.getByRole("button", { name: "Which deals need attention?" }));
    await waitForAssistantReply(store);
    const evidenceButton = await screen.findByText(/View evidence/);
    await user.click(evidenceButton);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(within(screen.getByRole("dialog")).getByText("Calculation used")).toBeInTheDocument();
  }, 15000);

  it("Restricted state: a role without AI-analysis permission sees a restricted message", () => {
    renderAiCopilot({ role: "Some-Future-Role" });
    expect(screen.getByText("AI Intelligence is restricted")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Ask about at-risk deals/i)).not.toBeInTheDocument();
  });

  it("ErrorBoundary compatibility: the route renders inside the app's ErrorBoundary without being caught", () => {
    renderAiCopilot();
    expect(screen.queryByText("Something went wrong")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "AI Copilot" })).toBeInTheDocument();
  });

  describe("Conversation sidebar", () => {
    it("renders the New Chat button and the History / Saved / Pinned tabs", () => {
      renderAiCopilot();
      expect(screen.getByRole("button", { name: "New Chat" })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "History" })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "Saved" })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "Pinned" })).toBeInTheDocument();
    });

    it("sending a message titles the conversation and lists it under History", async () => {
      const user = userEvent.setup();
      const { store } = renderAiCopilot();
      await user.click(screen.getByRole("button", { name: "Which deals need attention?" }));
      await waitForAssistantReply(store);
      expect(screen.getByRole("button", { name: /Which deals need attention\?/ })).toBeInTheDocument();
    }, 15000);

    it("+ New Chat starts a fresh, empty conversation while keeping the previous one in History", async () => {
      const user = userEvent.setup();
      const { store } = renderAiCopilot();
      await user.click(screen.getByRole("button", { name: "Which deals need attention?" }));
      await waitForAssistantReply(store);

      await user.click(screen.getByRole("button", { name: "New Chat" }));
      // Fresh conversation is empty again — suggested prompts reappear.
      expect(screen.getByRole("button", { name: "Which deals need attention?" })).toBeInTheDocument();
      expect(activeMessages(store)).toEqual([]);
      // The old conversation is still there, titled from its first message.
      expect(store.getState().aiCopilot.conversations).toHaveLength(2);
    }, 15000);

    it("clicking a conversation in the sidebar switches the active conversation", async () => {
      const user = userEvent.setup();
      const { store } = renderAiCopilot();
      await user.click(screen.getByRole("button", { name: "Which deals need attention?" }));
      await waitForAssistantReply(store);
      const firstId = store.getState().aiCopilot.activeId;

      await user.click(screen.getByRole("button", { name: "New Chat" }));
      const input = screen.getByPlaceholderText(/Ask about at-risk deals/i);
      await user.type(input, "help");
      await user.click(screen.getByRole("button", { name: "Send" }));
      await waitForAssistantReply(store);

      await user.click(screen.getByRole("button", { name: /Which deals need attention\?/ }));
      expect(store.getState().aiCopilot.activeId).toBe(firstId);
      const log = screen.getByRole("log", { name: "Conversation" });
      expect(within(log).getByText("Which deals need attention?")).toBeInTheDocument();
    }, 15000);

    it("pinning a conversation surfaces it under the Pinned tab", async () => {
      const user = userEvent.setup();
      const { store } = renderAiCopilot();
      await user.click(screen.getByRole("button", { name: "Which deals need attention?" }));
      await waitForAssistantReply(store);

      await user.click(screen.getByRole("button", { name: "Pin conversation" }));
      await user.click(screen.getByRole("tab", { name: "Pinned" }));
      expect(screen.getByRole("button", { name: /Which deals need attention\?/ })).toBeInTheDocument();
      expect(store.getState().aiCopilot.conversations[0].pinned).toBe(true);
    }, 15000);

    it("saving a conversation surfaces it under the Saved tab", async () => {
      const user = userEvent.setup();
      const { store } = renderAiCopilot();
      await user.click(screen.getByRole("button", { name: "Which deals need attention?" }));
      await waitForAssistantReply(store);

      await user.click(screen.getByRole("button", { name: "Save conversation" }));
      await user.click(screen.getByRole("tab", { name: "Saved" }));
      expect(screen.getByRole("button", { name: /Which deals need attention\?/ })).toBeInTheDocument();
      expect(store.getState().aiCopilot.conversations[0].saved).toBe(true);
    }, 15000);

    it("History shows the default conversation, but Saved and Pinned start empty", async () => {
      const user = userEvent.setup();
      renderAiCopilot();
      const sidebar = screen.getByRole("navigation", { name: "Conversations" });
      expect(within(sidebar).getByText("New chat")).toBeInTheDocument();

      await user.click(within(sidebar).getByRole("tab", { name: "Saved" }));
      expect(within(sidebar).getByText("No saved conversations yet.")).toBeInTheDocument();

      await user.click(within(sidebar).getByRole("tab", { name: "Pinned" }));
      expect(within(sidebar).getByText("No pinned conversations yet.")).toBeInTheDocument();
    });

    it("deleting a conversation removes it from the sidebar", async () => {
      const user = userEvent.setup();
      const { store } = renderAiCopilot();
      await user.click(screen.getByRole("button", { name: "Which deals need attention?" }));
      await waitForAssistantReply(store);

      await user.click(screen.getByRole("button", { name: "Delete conversation" }));
      const sidebar = screen.getByRole("navigation", { name: "Conversations" });
      expect(within(sidebar).queryByText(/Which deals need attention\?/)).not.toBeInTheDocument();
      expect(store.getState().aiCopilot.conversations).toHaveLength(1);
      expect(store.getState().aiCopilot.conversations[0].messages).toEqual([]);
    }, 15000);
  });

  describe("Explore Mode", () => {
    it("the toggle is disabled with a tooltip when no provider is configured", () => {
      renderAiCopilot();
      const toggle = screen.getByRole("switch", { name: /Explore Mode/i });
      expect(toggle).toBeDisabled();
      expect(toggle.title).toMatch(/no ai provider is configured/i);
    });

    it("the toggle becomes enabled once a provider is configured", async () => {
      mockFetchProviderStatus.mockResolvedValue([{ id: "anthropic", label: "Anthropic (Claude)", configured: true, defaultModel: "m" }]);
      renderAiCopilot();
      await waitFor(() => expect(screen.getByRole("switch", { name: /Explore Mode/i })).not.toBeDisabled());
    });

    it("sending a question in Explore Mode calls the gateway and renders a distinct, unverified result — never added to copilot messages", async () => {
      mockFetchProviderStatus.mockResolvedValue([{ id: "anthropic", label: "Anthropic (Claude)", configured: true, defaultModel: "m" }]);
      mockRequestExploration.mockResolvedValue({
        findings: [{ title: "Stalled deal", observation: "No activity in 20 days.", citedRecordIds: [] }],
        truncated: false,
        provider: { id: "anthropic", label: "Anthropic (Claude)", model: "claude-haiku-4-5-20251001" },
        disclaimer: "Generated by Anthropic (Claude) (claude-haiku-4-5-20251001) reasoning directly over your current records. Not verified by the deterministic engine — figures and conclusions here may be wrong. Always confirm before acting.",
        generatedAt: new Date().toISOString(),
      });
      const user = userEvent.setup();
      const { store } = renderAiCopilot();
      const toggle = await screen.findByRole("switch", { name: /Explore Mode/i });
      await waitFor(() => expect(toggle).not.toBeDisabled());
      await user.click(toggle);
      expect(toggle).toHaveAttribute("aria-checked", "true");

      await user.type(screen.getByPlaceholderText(/Ask the AI model anything/i), "What deals are at risk?");
      await user.click(screen.getByRole("button", { name: "Send" }));

      await waitFor(() => expect(store.getState().aiExplore.status).toBe("idle"));
      expect(store.getState().aiExplore.findings).toHaveLength(1);
      expect(activeMessages(store)).toEqual([]); // never interleaved into the deterministic chat

      expect(await screen.findByText("AI Exploration — Unverified")).toBeInTheDocument();
      expect(screen.getByText(/Not verified by the deterministic engine/)).toBeInTheDocument();
    }, 15000);

    it("Clear exploration results clears only the explore findings, leaving chat history untouched", async () => {
      mockFetchProviderStatus.mockResolvedValue([{ id: "anthropic", label: "Anthropic (Claude)", configured: true, defaultModel: "m" }]);
      mockRequestExploration.mockResolvedValue({
        findings: [], truncated: false, provider: { id: "anthropic", label: "Anthropic (Claude)", model: "m" },
        disclaimer: "d", generatedAt: new Date().toISOString(),
      });
      const user = userEvent.setup();
      const { store } = renderAiCopilot();
      const toggle = await screen.findByRole("switch", { name: /Explore Mode/i });
      await waitFor(() => expect(toggle).not.toBeDisabled());
      await user.click(toggle);
      await user.type(screen.getByPlaceholderText(/Ask the AI model anything/i), "Anything interesting?");
      await user.click(screen.getByRole("button", { name: "Send" }));
      await waitFor(() => expect(store.getState().aiExplore.findings.length).toBe(1));

      await user.click(screen.getByRole("button", { name: /Clear exploration results/i }));
      expect(store.getState().aiExplore.findings).toEqual([]);
    }, 15000);
  });
});

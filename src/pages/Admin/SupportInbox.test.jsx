import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import ErrorBoundary from "../../components/ErrorBoundary";
import SupportInbox from "./SupportInbox";
import authReducer from "../../redux/authSlice";
import integrationsReducer from "../../redux/admin/integrationsSlice";

function renderInbox({ role = "Super-Admin", initialPath = "/admin/integrations/support-communication/inbox" } = {}) {
  localStorage.setItem("role", role);
  localStorage.setItem("isLoggedIn", "true");
  const store = configureStore({
    reducer: { auth: authReducer, integrations: integrationsReducer },
    preloadedState: { auth: { role, isLoggedIn: true, data: {} } },
  });
  const utils = render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[initialPath]}>
        <ErrorBoundary>
          <Routes>
            <Route path="/admin/integrations/support-communication" element={<div>Overview Page</div>} />
            <Route path="/admin/integrations/support-communication/inbox" element={<SupportInbox />} />
          </Routes>
        </ErrorBoundary>
      </MemoryRouter>
    </Provider>
  );
  return { store, ...utils };
}

describe("SupportInbox", () => {
  beforeEach(() => localStorage.clear());

  it("renders the breadcrumb, title and Frontend Preview badge", async () => {
    renderInbox();
    expect(await screen.findByText("Inbox")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Omnichannel Inbox" })).toBeInTheDocument();
    expect(screen.getByText("Frontend Preview")).toBeInTheDocument();
  });

  it("lists conversations and selects the first one by default", async () => {
    renderInbox();
    const list = await screen.findByRole("list", { name: "Conversations" });
    await waitFor(() => expect(within(list).getAllByRole("button").length).toBeGreaterThan(0));
    expect(await screen.findByText("Conversation History")).toBeInTheDocument();
  });

  it("filters conversations by search text", async () => {
    const user = userEvent.setup();
    renderInbox();
    await screen.findByRole("list", { name: "Conversations" });
    const search = screen.getByLabelText("Search conversations");
    await user.type(search, "Noah Brennan");
    const list = screen.getByRole("list", { name: "Conversations" });
    await waitFor(() => expect(within(list).getByText("Noah Brennan")).toBeInTheDocument());
  });

  it("filters conversations by unread only", async () => {
    const user = userEvent.setup();
    renderInbox();
    await screen.findByRole("list", { name: "Conversations" });
    await user.click(screen.getByLabelText("Unread only"));
    const list = screen.getByRole("list", { name: "Conversations" });
    await waitFor(() => expect(within(list).queryByText("Elena Torres")).not.toBeInTheDocument());
  });

  it("shows the conversation detail with customer identity, provider reference and conversation history", async () => {
    renderInbox();
    await screen.findByText("Conversation History");
    expect(screen.getAllByText(/Reference:/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Data freshness:/i)).toBeInTheDocument();
  });

  it("shows two clearly separated composer modes", async () => {
    renderInbox();
    await screen.findByText("Conversation History");
    expect(screen.getByRole("tab", { name: /Public Reply Preview/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Internal Note Preview/i })).toBeInTheDocument();
  });

  it("the primary composer action is never labelled only 'Send'", async () => {
    renderInbox();
    await screen.findByText("Conversation History");
    expect(screen.queryByRole("button", { name: /^Send$/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm Reply Preview" })).toBeInTheDocument();
  });

  it("sending a Public Reply Preview never claims a provider message was sent, and allows Undo", async () => {
    const user = userEvent.setup();
    renderInbox();
    await screen.findByText("Conversation History");
    const textarea = screen.getByPlaceholderText("Write a reply preview…");
    await user.type(textarea, "Testing the reply preview flow.");
    await user.click(screen.getByRole("button", { name: "Confirm Reply Preview" }));
    expect(await screen.findByText(/No provider message was sent/i)).toBeInTheDocument();
    expect(await screen.findByText("Testing the reply preview flow.")).toBeInTheDocument();
    const undoButton = await screen.findByRole("button", { name: /Undo/i });
    await user.click(undoButton);
    await waitFor(() => expect(screen.queryByText("Testing the reply preview flow.")).not.toBeInTheDocument());
  });

  it("switching to Internal Note Preview keeps it visually and textually distinct from a public reply", async () => {
    const user = userEvent.setup();
    renderInbox();
    await screen.findByText("Conversation History");
    await user.click(screen.getByRole("tab", { name: /Internal Note Preview/i }));
    expect(screen.getByRole("button", { name: "Confirm Internal Note Preview" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Write an internal note preview…")).toBeInTheDocument();
  });

  it("Organization Administrator sees a fixed organization scope instead of a selector", async () => {
    renderInbox({ role: "Admin" });
    await screen.findByText("Conversation History");
    expect(screen.queryByLabelText("Organization")).not.toBeInTheDocument();
  });

  it("a role with no support_inbox grant (Standard Employee) cannot view the Inbox", async () => {
    renderInbox({ role: "User" });
    await waitFor(() => expect(screen.getByText(/You do not have permission to view the Support Inbox/i)).toBeInTheDocument());
  });
});

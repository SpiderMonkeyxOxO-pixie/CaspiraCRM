import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import ErrorBoundary from "../../components/ErrorBoundary";
import SupportChannels from "./SupportChannels";
import authReducer from "../../redux/authSlice";
import integrationsReducer from "../../redux/admin/integrationsSlice";

function renderChannels({ role = "Super-Admin" } = {}) {
  localStorage.setItem("role", role);
  localStorage.setItem("isLoggedIn", "true");
  const store = configureStore({
    reducer: { auth: authReducer, integrations: integrationsReducer },
    preloadedState: { auth: { role, isLoggedIn: true, data: {} } },
  });
  const utils = render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/admin/integrations/support-communication/channels"]}>
        <ErrorBoundary>
          <Routes>
            <Route path="/admin/integrations/support-communication" element={<div>Overview Page</div>} />
            <Route path="/admin/integrations/support-communication/channels" element={<SupportChannels />} />
          </Routes>
        </ErrorBoundary>
      </MemoryRouter>
    </Provider>
  );
  return { store, ...utils };
}

describe("SupportChannels", () => {
  beforeEach(() => localStorage.clear());

  it("renders the breadcrumb, title and Frontend Preview badge", async () => {
    renderChannels();
    expect(await screen.findByText("Channels")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Support Channels" })).toBeInTheDocument();
    expect(screen.getByText("Frontend Preview")).toBeInTheDocument();
  });

  it("lists connected channels with queue and team mapping", async () => {
    renderChannels();
    expect(await screen.findByText("Connected Channels")).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText("Tier 1 Support").length).toBeGreaterThan(0));
  });

  it("shows queue mapping and agent mapping tables", async () => {
    renderChannels();
    expect(await screen.findByText("Queue Mapping")).toBeInTheDocument();
    expect(screen.getByText("Agent Mapping")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Billing Queue")).toBeInTheDocument());
    expect(screen.getByText("Liam O'Connor")).toBeInTheDocument();
  });

  it("flags an unmapped agent as requiring review, never guessed by display name", async () => {
    renderChannels();
    await waitFor(() => expect(screen.getByText("Unknown Contractor")).toBeInTheDocument());
    expect(screen.getAllByText("Unmapped").length).toBeGreaterThan(0);
  });

  it("opens the customer reviews drawer from a Customer Review channel row and never auto-posts a reply", async () => {
    const user = userEvent.setup();
    renderChannels();
    await waitFor(() => expect(screen.getByText("Customer Review")).toBeInTheDocument());
    await user.click(screen.getByText("Customer Review"));
    const drawer = await screen.findByRole("dialog", { name: "Customer reviews" });
    expect(within(drawer).getByText(/reply drafts are saved as preview state only/i)).toBeInTheDocument();
  });

  it("a role with no support_channels grant (Standard Employee) cannot view Channels", async () => {
    renderChannels({ role: "User" });
    await waitFor(() => expect(screen.getByText(/You do not have permission to view Support Channels/i)).toBeInTheDocument());
  });
});

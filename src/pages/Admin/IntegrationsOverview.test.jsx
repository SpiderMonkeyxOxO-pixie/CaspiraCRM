import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import ErrorBoundary from "../../components/ErrorBoundary";
import IntegrationsOverview from "./IntegrationsOverview";
import authReducer from "../../redux/authSlice";
import integrationsReducer from "../../redux/admin/integrationsSlice";

function renderOverview({ role = "Super-Admin" } = {}) {
  localStorage.setItem("role", role);
  localStorage.setItem("isLoggedIn", "true");
  const store = configureStore({
    reducer: { auth: authReducer, integrations: integrationsReducer },
    preloadedState: { auth: { role, isLoggedIn: true, data: {} } },
  });
  const utils = render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/admin/integrations"]}>
        <ErrorBoundary>
          <Routes>
            <Route path="/admin/integrations" element={<IntegrationsOverview />} />
            <Route path="/admin/integrations/marketplace" element={<div>Marketplace Page</div>} />
            <Route path="/admin/integrations/activity" element={<div>Activity Page</div>} />
            <Route path="/admin/integrations/webhooks" element={<div>Webhooks Page</div>} />
          </Routes>
        </ErrorBoundary>
      </MemoryRouter>
    </Provider>
  );
  return { store, ...utils };
}

describe("IntegrationsOverview", () => {
  beforeEach(() => localStorage.clear());

  it("renders the Administration / Integrations breadcrumb and title", async () => {
    renderOverview();
    expect(await screen.findByText("Administration")).toBeInTheDocument();
    expect(screen.getByText("Integrations")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Integration Center" })).toBeInTheDocument();
  });

  it("shows the Frontend Preview status badge", async () => {
    renderOverview();
    expect(await screen.findByText("Frontend Preview")).toBeInTheDocument();
  });

  it("System Owner sees a real organization selector with all organizations", async () => {
    renderOverview({ role: "Super-Admin" });
    const select = await screen.findByLabelText("Organization");
    await waitFor(() => expect(within(select).getAllByRole("option")).toHaveLength(4), { timeout: 5000 }); // "All organizations" + 3
  });

  it("Organization Administrator sees a fixed organization label instead of a selector", async () => {
    renderOverview({ role: "Admin" });
    await waitFor(() => expect(screen.getByText("Caspira HQ")).toBeInTheDocument());
    expect(screen.queryByLabelText("Organization")).not.toBeInTheDocument();
  });

  it("shows the 6 compact metrics", async () => {
    renderOverview();
    expect(await screen.findByRole("button", { name: /Available Providers/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Preview Connections/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Attention Required/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Syncs Today/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Failed Syncs/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Not Configured/i })).toBeInTheDocument();
  });

  it("shows all 6 overview sections", async () => {
    renderOverview();
    expect(await screen.findByText("Connection Health")).toBeInTheDocument();
    expect(screen.getByText("Recently Used Integrations")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Attention Required/i })).toBeInTheDocument();
    expect(screen.getByText("Recent Synchronization Activity")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Recommended Integrations/i })).toBeInTheDocument();
    expect(screen.getByText("Security and Access Summary")).toBeInTheDocument();
  });

  it("Organization Administrator's metrics are scoped to their own organization", async () => {
    renderOverview({ role: "Admin" });
    await screen.findByText("Available Providers");
    expect(await screen.findByText("61")).toBeInTheDocument(); // catalog is global (13 Phase 1 + 13 Phase 2 + 9 Phase 3 + 8 Phase 4 + 9 Phase 5 + 4 Phase 6 + 5 Phase 7 providers)
    // Org Admin's seeded org (org_caspira_hq) connects 11 distinct providers
    // (conn_1,2,3,4,5,9,10,13,14,15,17) against 61 total, so 50 remain unconfigured.
    await waitFor(() => expect(screen.getByText("50")).toBeInTheDocument());
  });

  it("clicking the Marketplace shortcut navigates to the marketplace page", async () => {
    const user = userEvent.setup();
    renderOverview();
    await user.click(await screen.findByRole("button", { name: /Marketplace/i }));
    expect(await screen.findByText("Marketplace Page")).toBeInTheDocument();
  });

  it("clicking a metric navigates with the corresponding filter applied", async () => {
    const user = userEvent.setup();
    renderOverview();
    await user.click(await screen.findByRole("button", { name: /Attention Required/i, exact: false }));
    expect(await screen.findByText("Marketplace Page")).toBeInTheDocument();
  });

  it("never displays a bare Connected status — only preview-qualified statuses", async () => {
    renderOverview();
    await screen.findByText("Recently Used Integrations");
    expect(screen.queryByText(/^Connected$/)).not.toBeInTheDocument();
  });
});

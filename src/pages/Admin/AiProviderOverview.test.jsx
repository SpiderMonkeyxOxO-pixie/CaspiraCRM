import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import ErrorBoundary from "../../components/ErrorBoundary";
import AiProviderOverview from "./AiProviderOverview";
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
      <MemoryRouter initialEntries={["/admin/integrations/ai-providers"]}>
        <ErrorBoundary>
          <Routes>
            <Route path="/admin/integrations/ai-providers" element={<AiProviderOverview />} />
            <Route path="/admin/integrations/ai-providers/providers" element={<div>Providers Page</div>} />
          </Routes>
        </ErrorBoundary>
      </MemoryRouter>
    </Provider>
  );
  return { store, ...utils };
}

describe("AiProviderOverview", () => {
  beforeEach(() => localStorage.clear());

  it("renders the breadcrumb and title with the Frontend Preview badge", async () => {
    renderOverview();
    expect(await screen.findByText("Administration")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "AI Provider and Intelligence Integrations" })).toBeInTheDocument();
    expect(screen.getByText("Frontend Preview")).toBeInTheDocument();
  });

  it("System Owner sees a real organization selector with all organizations", async () => {
    renderOverview({ role: "Super-Admin" });
    const select = await screen.findByLabelText("Organization");
    await waitFor(() => expect(select.querySelectorAll("option").length).toBe(4), { timeout: 5000 });
  });

  it("shows the 12 named deterministic metrics", async () => {
    renderOverview();
    expect(await screen.findByRole("button", { name: /Available Provider Previews/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Preview-Configured Providers/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Active Routing Policies/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Use Cases Without a Provider/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Use Cases Requiring Approval/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Restricted Data Policies/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Evaluation Scenarios/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Failed Evaluation Checks/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Estimated Requests/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Estimated Usage Units/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Provider Health Warnings/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Audit Findings/i })).toBeInTheDocument();
  });

  it("displays the correct available provider preview count", async () => {
    renderOverview();
    await screen.findByRole("button", { name: /Available Provider Previews/i });
    await waitFor(() => expect(screen.getByRole("button", { name: /Available Provider Previews/i }).textContent).toMatch(/5/));
  });

  it("clicking a metric navigates to the corresponding route", async () => {
    const user = userEvent.setup();
    renderOverview();
    await user.click(await screen.findByRole("button", { name: /Available Provider Previews/i }));
    expect(await screen.findByText("Providers Page")).toBeInTheDocument();
  });

  it("clicking Preview Provider Setup navigates to the providers route", async () => {
    const user = userEvent.setup();
    renderOverview();
    await user.click(await screen.findByRole("button", { name: "Preview Provider Setup" }));
    expect(await screen.findByText("Providers Page")).toBeInTheDocument();
  });

  it("never claims a real provider was contacted or a credential was stored", async () => {
    renderOverview();
    await screen.findByText("Provider Health");
    expect(screen.queryByText(/provider was contacted/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/credential was stored/i)).not.toBeInTheDocument();
  });

  it("states usage figures are not provider billing records", async () => {
    renderOverview();
    expect(await screen.findByText(/not provider billing records/i)).toBeInTheDocument();
  });
});

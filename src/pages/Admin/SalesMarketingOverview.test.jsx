import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import ErrorBoundary from "../../components/ErrorBoundary";
import SalesMarketingOverview from "./SalesMarketingOverview";
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
      <MemoryRouter initialEntries={["/admin/integrations/sales-marketing"]}>
        <ErrorBoundary>
          <Routes>
            <Route path="/admin/integrations/sales-marketing" element={<SalesMarketingOverview />} />
            <Route path="/admin/integrations/sales-marketing/lead-capture" element={<div>Lead Capture Page</div>} />
          </Routes>
        </ErrorBoundary>
      </MemoryRouter>
    </Provider>
  );
  return { store, ...utils };
}

describe("SalesMarketingOverview", () => {
  beforeEach(() => localStorage.clear());

  it("renders the breadcrumb, title and Frontend Preview badge", async () => {
    renderOverview();
    expect(await screen.findByRole("heading", { name: "Sales and Marketing Integrations" })).toBeInTheDocument();
    expect(screen.getByText("Frontend Preview")).toBeInTheDocument();
  });

  it("shows the metric cards driven by live-computed overview metrics", async () => {
    renderOverview();
    await waitFor(() => expect(screen.getByText("Leads Needing Review")).toBeInTheDocument());
    expect(screen.getByText("Leads Ready to Create")).toBeInTheDocument();
    expect(screen.getByText("Active Suppressions")).toBeInTheDocument();
  });

  it("links to every sub-page", async () => {
    renderOverview();
    await waitFor(() => expect(screen.getByRole("button", { name: "Lead Capture" })).toBeInTheDocument());
    ["Audience Sync", "Suppression", "Email Delivery", "Attribution", "Forms"].forEach((label) => {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    });
  });
});

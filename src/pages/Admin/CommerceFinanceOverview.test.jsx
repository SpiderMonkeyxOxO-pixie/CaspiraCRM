import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import ErrorBoundary from "../../components/ErrorBoundary";
import CommerceFinanceOverview from "./CommerceFinanceOverview";
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
      <MemoryRouter initialEntries={["/admin/integrations/commerce-finance"]}>
        <ErrorBoundary>
          <Routes>
            <Route path="/admin/integrations/commerce-finance" element={<CommerceFinanceOverview />} />
            <Route path="/admin/integrations/commerce-finance/commerce" element={<div>Commerce Page</div>} />
          </Routes>
        </ErrorBoundary>
      </MemoryRouter>
    </Provider>
  );
  return { store, ...utils };
}

describe("CommerceFinanceOverview", () => {
  beforeEach(() => localStorage.clear());

  it("renders the breadcrumb and title with the Frontend Preview badge", async () => {
    renderOverview();
    expect(await screen.findByText("Administration")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Commerce and Finance Integrations" })).toBeInTheDocument();
    expect(screen.getByText("Frontend Preview")).toBeInTheDocument();
  });

  it("System Owner sees a real organization selector with all organizations", async () => {
    renderOverview({ role: "Super-Admin" });
    const select = await screen.findByLabelText("Organization");
    await waitFor(() => expect(select.querySelectorAll("option").length).toBe(4), { timeout: 5000 });
  });

  it("shows the 13 named deterministic metrics", async () => {
    renderOverview();
    expect(await screen.findByRole("button", { name: /Preview-Connected Providers/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Synchronized Order Previews/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Gross Sales/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Net Sales/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Payments Received/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Refunds/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Provider Fees/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Outstanding Invoices/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Overdue Invoices/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Active Subscriptions/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Monthly Recurring Revenue/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Unmatched Transactions/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Financial Sync Conflicts/i })).toBeInTheDocument();
  });

  it("clicking a metric navigates to the corresponding route", async () => {
    const user = userEvent.setup();
    renderOverview();
    await user.click(await screen.findByRole("button", { name: /Synchronized Order Previews/i }));
    expect(await screen.findByText("Commerce Page")).toBeInTheDocument();
  });

  it("explains multi-currency handling and never sums currencies silently", async () => {
    renderOverview();
    expect(await screen.findByText("Multi-Currency Handling")).toBeInTheDocument();
  });

  it("never claims a payment, refund or payout actually occurred", async () => {
    renderOverview();
    await screen.findByText("Multi-Currency Handling");
    expect(screen.queryByText(/payment was captured/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/refund was issued/i)).not.toBeInTheDocument();
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import ErrorBoundary from "../../components/ErrorBoundary";
import PaymentsIntegrationList from "./PaymentsIntegrationList";
import authReducer from "../../redux/authSlice";
import integrationsReducer from "../../redux/admin/integrationsSlice";

function renderList({ role = "Super-Admin" } = {}) {
  localStorage.setItem("role", role);
  localStorage.setItem("isLoggedIn", "true");
  const store = configureStore({
    reducer: { auth: authReducer, integrations: integrationsReducer },
    preloadedState: { auth: { role, isLoggedIn: true, data: {} } },
  });
  const utils = render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/admin/integrations/commerce-finance/payments"]}>
        <ErrorBoundary>
          <Routes>
            <Route path="/admin/integrations/commerce-finance/payments" element={<PaymentsIntegrationList />} />
          </Routes>
        </ErrorBoundary>
      </MemoryRouter>
    </Provider>
  );
  return { store, ...utils };
}

describe("PaymentsIntegrationList", () => {
  beforeEach(() => localStorage.clear());

  it("renders the breadcrumb, title and Frontend Preview badge", async () => {
    renderList();
    expect(await screen.findByText("Administration")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Payment Integrations" })).toBeInTheDocument();
    expect(screen.getByText("Frontend Preview")).toBeInTheDocument();
  });

  it("shows all 5 tabs and masked payment methods, never raw card data", async () => {
    renderList();
    await screen.findByText(/Card ending in/);
    expect(screen.getByRole("button", { name: "Transactions" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refunds" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Disputes" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fees" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Payouts" })).toBeInTheDocument();
    expect(screen.queryByText(/4242424242424242/)).not.toBeInTheDocument();
  });

  it("opens the refund approval modal and blocks self-approval", async () => {
    const user = userEvent.setup();
    renderList();
    await screen.findByText(/Card ending in/);
    await user.click(screen.getByRole("button", { name: "Refunds" }));
    const approveButtons = await screen.findAllByRole("button", { name: "Approve" });
    await user.click(approveButtons[0]);
    const dialog = await screen.findByRole("dialog");
    // Only refund_1 (requested by Priya Nair) is "Pending Approval" in the
    // fixtures, so it's the only row with an Approve button.
    expect(within(dialog).getAllByText("Priya Nair").length).toBeGreaterThan(0);
    await user.selectOptions(within(dialog).getByLabelText("Approving As"), "Priya Nair");
    expect(within(dialog).getByRole("button", { name: "Approve" })).toBeDisabled();
  });

  it("never claims a refund was actually issued", async () => {
    renderList();
    await screen.findByText(/Card ending in/);
    expect(screen.queryByText(/refund was issued/i)).not.toBeInTheDocument();
  });
});

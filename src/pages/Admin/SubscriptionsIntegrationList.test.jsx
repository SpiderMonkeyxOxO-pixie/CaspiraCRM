import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import ErrorBoundary from "../../components/ErrorBoundary";
import SubscriptionsIntegrationList from "./SubscriptionsIntegrationList";
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
      <MemoryRouter initialEntries={["/admin/integrations/commerce-finance/subscriptions"]}>
        <ErrorBoundary>
          <Routes>
            <Route path="/admin/integrations/commerce-finance/subscriptions" element={<SubscriptionsIntegrationList />} />
          </Routes>
        </ErrorBoundary>
      </MemoryRouter>
    </Provider>
  );
  return { store, ...utils };
}

describe("SubscriptionsIntegrationList", () => {
  beforeEach(() => localStorage.clear());

  it("renders the breadcrumb, title and Frontend Preview badge", async () => {
    renderList();
    expect(await screen.findByText("Administration")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Subscription Integrations" })).toBeInTheDocument();
    expect(screen.getByText("Frontend Preview")).toBeInTheDocument();
  });

  it("shows MRR, ARR and churned-revenue cards", async () => {
    renderList();
    await screen.findByText("Growth Plan");
    expect(screen.getByText("Monthly Recurring Revenue")).toBeInTheDocument();
    expect(screen.getByText("Annual Recurring Revenue")).toBeInTheDocument();
    expect(screen.getByText("Churned Recurring Revenue")).toBeInTheDocument();
  });

  it("cancel action enforces separation of duties", async () => {
    const user = userEvent.setup();
    renderList();
    await screen.findByText("Growth Plan");
    const cancelButtons = screen.getAllByRole("button", { name: "Cancel" });
    await user.click(cancelButtons[0]);
    const dialog = await screen.findByRole("dialog");
    await user.selectOptions(within(dialog).getByLabelText("Requester"), "Dominic Wuckert");
    await user.selectOptions(within(dialog).getByLabelText("Approver"), "Dominic Wuckert");
    expect(within(dialog).getByRole("button", { name: "Cancel Subscription" })).toBeDisabled();
  });

  it("never claims a real subscription was modified or cancelled", async () => {
    renderList();
    await screen.findByText("Growth Plan");
    expect(screen.queryByText(/subscription was cancelled in Chargebee/i)).not.toBeInTheDocument();
  });
});

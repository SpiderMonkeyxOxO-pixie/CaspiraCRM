import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import ErrorBoundary from "../../components/ErrorBoundary";
import BankingIntegrationList from "./BankingIntegrationList";
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
      <MemoryRouter initialEntries={["/admin/integrations/commerce-finance/banking"]}>
        <ErrorBoundary>
          <Routes>
            <Route path="/admin/integrations/commerce-finance/banking" element={<BankingIntegrationList />} />
          </Routes>
        </ErrorBoundary>
      </MemoryRouter>
    </Provider>
  );
  return { store, ...utils };
}

describe("BankingIntegrationList", () => {
  beforeEach(() => localStorage.clear());

  it("renders the breadcrumb, title and Frontend Preview badge", async () => {
    renderList();
    expect(await screen.findByText("Administration")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Banking Integrations" })).toBeInTheDocument();
    expect(screen.getByText("Frontend Preview")).toBeInTheDocument();
  });

  it("shows masked account numbers only, never a full account number", async () => {
    renderList();
    expect((await screen.findAllByText(/••••/)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/\d{10,}/)).not.toBeInTheDocument();
  });

  it("never offers a transfer action", async () => {
    renderList();
    await screen.findAllByText(/••••/);
    expect(screen.queryByRole("button", { name: /transfer/i })).not.toBeInTheDocument();
  });

  it("shows the transaction feed with reconciliation status", async () => {
    renderList();
    await screen.findAllByText(/••••/);
    expect(screen.getAllByText(/Matched|Suggested Match|Unmatched|Partial Match/).length).toBeGreaterThan(0);
  });
});

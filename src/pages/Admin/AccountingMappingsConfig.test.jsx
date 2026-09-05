import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import ErrorBoundary from "../../components/ErrorBoundary";
import AccountingMappingsConfig from "./AccountingMappingsConfig";
import authReducer from "../../redux/authSlice";
import integrationsReducer from "../../redux/admin/integrationsSlice";

function renderPage({ role = "Super-Admin" } = {}) {
  localStorage.setItem("role", role);
  localStorage.setItem("isLoggedIn", "true");
  const store = configureStore({
    reducer: { auth: authReducer, integrations: integrationsReducer },
    preloadedState: { auth: { role, isLoggedIn: true, data: {} } },
  });
  const utils = render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/admin/integrations/commerce-finance/accounting"]}>
        <ErrorBoundary>
          <Routes>
            <Route path="/admin/integrations/commerce-finance/accounting" element={<AccountingMappingsConfig />} />
          </Routes>
        </ErrorBoundary>
      </MemoryRouter>
    </Provider>
  );
  return { store, ...utils };
}

describe("AccountingMappingsConfig", () => {
  beforeEach(() => localStorage.clear());

  it("renders the breadcrumb, title and Frontend Preview badge", async () => {
    renderPage();
    expect(await screen.findByText("Administration")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Accounting Integrations" })).toBeInTheDocument();
    expect(screen.getByText("Frontend Preview")).toBeInTheDocument();
  });

  it("shows all 8 mapping tabs", async () => {
    renderPage();
    await screen.findByRole("table");
    expect(screen.getByRole("button", { name: "Customer Mapping" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Product Mapping" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Invoice Mapping" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Payment Mapping" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tax Mapping" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ledger Mapping" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Credit Notes" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sync Conflicts" })).toBeInTheDocument();
  });

  it("switches to Ledger Mapping and opens the override modal with separation-of-duties enforced", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("table");
    await user.click(screen.getByRole("button", { name: "Ledger Mapping" }));
    const overrideButtons = await screen.findAllByRole("button", { name: "Override" });
    await user.click(overrideButtons[0]);
    const dialog = await screen.findByRole("dialog");
    await user.selectOptions(within(dialog).getByLabelText("Requester"), "Dominic Wuckert");
    await user.selectOptions(within(dialog).getByLabelText("Approver"), "Dominic Wuckert");
    expect(within(dialog).getByRole("button", { name: "Override" })).toBeDisabled();
    expect(within(dialog).getByText(/separation of duties/i)).toBeInTheDocument();
  });

  it("switches to Sync Conflicts and resolves an open conflict", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("table");
    await user.click(screen.getByRole("button", { name: "Sync Conflicts" }));
    const resolveButtons = await screen.findAllByRole("button", { name: "Resolve" });
    await user.click(resolveButtons[0]);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Resolve" })).toBeDisabled();
  });

  it("never posts a journal entry or claims an accounting record was created", async () => {
    renderPage();
    await screen.findByRole("table");
    expect(screen.queryByText(/journal entry was posted/i)).not.toBeInTheDocument();
  });
});

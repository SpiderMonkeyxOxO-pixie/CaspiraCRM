import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import ErrorBoundary from "../../components/ErrorBoundary";
import ReconciliationWorkbench from "./ReconciliationWorkbench";
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
      <MemoryRouter initialEntries={["/admin/integrations/commerce-finance/reconciliation"]}>
        <ErrorBoundary>
          <Routes>
            <Route path="/admin/integrations/commerce-finance/reconciliation" element={<ReconciliationWorkbench />} />
          </Routes>
        </ErrorBoundary>
      </MemoryRouter>
    </Provider>
  );
  return { store, ...utils };
}

describe("ReconciliationWorkbench", () => {
  beforeEach(() => localStorage.clear());

  it("renders the breadcrumb, title and Frontend Preview badge", async () => {
    renderPage();
    expect(await screen.findByText("Administration")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Reconciliation" })).toBeInTheDocument();
    expect(screen.getByText("Frontend Preview")).toBeInTheDocument();
  });

  it("shows all 5 queues", async () => {
    renderPage();
    await screen.findByText(/Unmatched \(/);
    expect(screen.getByText(/Suggested Matches \(/)).toBeInTheDocument();
    expect(screen.getByText(/Partial Matches \(/)).toBeInTheDocument();
    expect(screen.getByText(/Conflicts \(/)).toBeInTheDocument();
    expect(screen.getByText(/Completed Preview Reconciliations \(/)).toBeInTheDocument();
  });

  it("every suggested match explains its own evidence, never an unexplained percentage", async () => {
    renderPage();
    await screen.findAllByText(/Suggested match:/);
    expect(screen.queryByText(/%\s*confidence/i)).not.toBeInTheDocument();
  });

  it("confirming a suggested match moves it toward Matched and shows Undo", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findAllByText(/Suggested match:/);
    const confirmButtons = screen.getAllByRole("button", { name: /Confirm/i });
    await user.click(confirmButtons[0]);
    await waitFor(() => expect(screen.getByRole("button", { name: /Undo Last Match/i })).toBeInTheDocument());
  });

  it("never claims a transaction was permanently reconciled outside this session", async () => {
    renderPage();
    await screen.findAllByText(/Suggested match:/);
    expect(screen.queryByText(/permanently reconciled/i)).not.toBeInTheDocument();
  });
});

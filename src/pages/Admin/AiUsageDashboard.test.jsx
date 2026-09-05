import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import ErrorBoundary from "../../components/ErrorBoundary";
import AiUsageDashboard from "./AiUsageDashboard";
import authReducer from "../../redux/authSlice";
import integrationsReducer from "../../redux/admin/integrationsSlice";

function renderPage({ role = "Super-Admin" } = {}) {
  localStorage.setItem("role", role);
  localStorage.setItem("isLoggedIn", "true");
  const store = configureStore({
    reducer: { auth: authReducer, integrations: integrationsReducer },
    preloadedState: { auth: { role, isLoggedIn: true, data: {} } },
  });
  return render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/admin/integrations/ai-providers/usage"]}>
        <ErrorBoundary><AiUsageDashboard /></ErrorBoundary>
      </MemoryRouter>
    </Provider>
  );
}

describe("AiUsageDashboard", () => {
  beforeEach(() => localStorage.clear());

  it("renders the title and states these are not provider billing records", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { name: "Usage and Budget" })).toBeInTheDocument();
    expect(screen.getByText(/not provider billing records/i)).toBeInTheDocument();
  });

  it("shows seeded usage estimate rows", async () => {
    renderPage({ role: "Super-Admin" });
    expect(await screen.findByText("Balanced")).toBeInTheDocument();
  });

  it("System Owner can edit budget thresholds via a preview-only modal", async () => {
    const user = userEvent.setup();
    renderPage({ role: "Super-Admin" });
    await user.click(await screen.findByRole("button", { name: "Edit Thresholds" }));
    expect(await screen.findByRole("heading", { name: "Edit Budget Policy Preview" })).toBeInTheDocument();
    expect(screen.getByText(/No provider account is billed or capped/i)).toBeInTheDocument();
  });

  it("a member without ai_budgets.manage never sees the edit action", async () => {
    renderPage({ role: "User" });
    await screen.findByRole("heading", { name: "Usage and Budget" });
    expect(screen.queryByRole("button", { name: "Edit Thresholds" })).not.toBeInTheDocument();
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import ErrorBoundary from "../../components/ErrorBoundary";
import AiAuditLog from "./AiAuditLog";
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
      <MemoryRouter initialEntries={["/admin/integrations/ai-providers/audit"]}>
        <ErrorBoundary><AiAuditLog /></ErrorBoundary>
      </MemoryRouter>
    </Provider>
  );
}

describe("AiAuditLog", () => {
  beforeEach(() => localStorage.clear());

  it("renders the title and Frontend Preview badge", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { name: "AI Audit Log" })).toBeInTheDocument();
    expect(screen.getByText("Frontend Preview")).toBeInTheDocument();
  });

  it("System Owner sees seeded audit events with correlation IDs", async () => {
    renderPage({ role: "Super-Admin" });
    expect(await screen.findByText("corr-0001")).toBeInTheDocument();
  });

  it("clicking a row opens the detail drawer without a chain-of-thought field", async () => {
    const user = userEvent.setup();
    renderPage({ role: "Super-Admin" });
    const cell = await screen.findByText("corr-0001");
    await user.click(cell.closest("tr"));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("Audit Event Detail");
    expect(dialog.textContent).toMatch(/No internal reasoning or chain-of-thought/i);
    expect(screen.queryByText(/chain of thought:/i)).not.toBeInTheDocument();
  });
});

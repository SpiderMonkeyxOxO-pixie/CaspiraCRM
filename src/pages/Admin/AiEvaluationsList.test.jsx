import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import ErrorBoundary from "../../components/ErrorBoundary";
import AiEvaluationsList from "./AiEvaluationsList";
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
      <MemoryRouter initialEntries={["/admin/integrations/ai-providers/evaluations"]}>
        <ErrorBoundary><AiEvaluationsList /></ErrorBoundary>
      </MemoryRouter>
    </Provider>
  );
}

describe("AiEvaluationsList", () => {
  beforeEach(() => localStorage.clear());

  it("renders the title and Frontend Preview badge", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { name: "Evaluations" })).toBeInTheDocument();
    expect(screen.getByText("Frontend Preview")).toBeInTheDocument();
  });

  it("includes the prompt-injection resistance scenario", async () => {
    renderPage();
    expect(await screen.findByText("Prompt-injection resistance")).toBeInTheDocument();
  });

  it("includes the cross-organization leakage scenario", async () => {
    renderPage();
    expect(await screen.findByText("Cross-organization leakage")).toBeInTheDocument();
  });

  it("the hallucinated-value scenario shows Not Evaluated, not a fabricated Pass", async () => {
    renderPage();
    const row = (await screen.findByText("Hallucinated-value detection")).closest("tr");
    expect(row.textContent).toContain("Not Evaluated");
  });

  it("a manager can run an evaluation preview and it updates Last Run", async () => {
    const user = userEvent.setup();
    renderPage({ role: "Super-Admin" });
    const row = (await screen.findByText("Hallucinated-value detection")).closest("tr");
    expect(row.textContent).toContain("Not yet run");
    await user.click(row.querySelector("button"));
    await waitFor(() => {
      const updatedRow = screen.getByText("Hallucinated-value detection").closest("tr");
      expect(updatedRow.textContent).not.toContain("Not yet run");
    });
  });

  it("a member without ai_evaluations.run_preview never sees the run action", async () => {
    renderPage({ role: "User" });
    await screen.findByRole("heading", { name: "Evaluations" });
    expect(screen.queryByRole("button", { name: /Run Preview/i })).not.toBeInTheDocument();
  });
});

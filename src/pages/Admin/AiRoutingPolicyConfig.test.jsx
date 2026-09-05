import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import ErrorBoundary from "../../components/ErrorBoundary";
import AiRoutingPolicyConfig from "./AiRoutingPolicyConfig";
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
      <MemoryRouter initialEntries={["/admin/integrations/ai-providers/routing"]}>
        <ErrorBoundary><AiRoutingPolicyConfig /></ErrorBoundary>
      </MemoryRouter>
    </Provider>
  );
}

describe("AiRoutingPolicyConfig", () => {
  beforeEach(() => localStorage.clear());

  it("renders the title and Frontend Preview badge", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { name: "Routing and Fallback Policies" })).toBeInTheDocument();
    expect(screen.getByText("Frontend Preview")).toBeInTheDocument();
  });

  it("System Owner sees all seeded routing policies across organizations", async () => {
    renderPage({ role: "Super-Admin" });
    expect(await screen.findByText(/Executive summary routing|Executive CRM Summary/i)).toBeInTheDocument();
  });

  it("opens the fallback eligibility checklist and shows pass/fail rows", async () => {
    const user = userEvent.setup();
    renderPage({ role: "Super-Admin" });
    const buttons = await screen.findAllByRole("button", { name: /Check Fallback Eligibility/i });
    await user.click(buttons[1]);
    expect(await screen.findByRole("heading", { name: "Fallback Eligibility Checklist" })).toBeInTheDocument();
    expect(screen.getByText("Secondary provider is approved")).toBeInTheDocument();
  });

  it("a member without ai_routing.manage never sees the eligibility action", async () => {
    renderPage({ role: "User" });
    await screen.findByRole("heading", { name: "Routing and Fallback Policies" });
    expect(screen.queryByRole("button", { name: /Check Fallback Eligibility/i })).not.toBeInTheDocument();
  });
});

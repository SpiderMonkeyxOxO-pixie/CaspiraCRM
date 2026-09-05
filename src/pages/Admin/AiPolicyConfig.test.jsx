import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import ErrorBoundary from "../../components/ErrorBoundary";
import AiPolicyConfig from "./AiPolicyConfig";
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
      <MemoryRouter initialEntries={["/admin/integrations/ai-providers/policies"]}>
        <ErrorBoundary><AiPolicyConfig /></ErrorBoundary>
      </MemoryRouter>
    </Provider>
  );
}

describe("AiPolicyConfig", () => {
  beforeEach(() => localStorage.clear());

  it("renders the title and all 8 tabs", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { name: "AI Policies" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Use Cases" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Data Access" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Field Handling" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Human Approval" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Tool Permissions" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Retention" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Provider Restrictions" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Budget Limits" })).toBeInTheDocument();
  });

  it("Use Cases tab shows a Future Use Case tag for unfinished use cases", async () => {
    renderPage();
    expect(await screen.findByText("Email draft")).toBeInTheDocument();
    expect(screen.getAllByText("Future Use Case").length).toBeGreaterThan(0);
  });

  it("AI Copilot use case is shown as Active, not a Future Use Case", async () => {
    renderPage();
    const row = (await screen.findByText("AI Copilot")).closest("tr");
    expect(row.textContent).toContain("Active");
  });

  it("Tool Permissions tab shows delete_record as disallowed by default", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("tab", { name: "Tool Permissions" }));
    const row = (await screen.findByText("Delete record")).closest("tr");
    expect(row.textContent).toContain("Disallowed");
  });

  it("Human Approval tab lets a manager preview a separation-of-duties check that blocks self-approval", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("tab", { name: "Human Approval" }));
    const checkButtons = await screen.findAllByRole("button", { name: "Preview Approval Check" });
    await user.click(checkButtons[0]);
    const dialog = await screen.findByRole("dialog");
    const [requester, approver] = within(dialog).getAllByRole("combobox");
    const sameOption = within(requester).getAllByRole("option")[1];
    await user.selectOptions(requester, sameOption.value);
    await user.selectOptions(approver, sameOption.value);
    expect(dialog.textContent).toMatch(/Blocked/);
  });

  it("Retention tab shows the seeded AI Context Retention Policy", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("tab", { name: "Retention" }));
    expect(await screen.findByText("AI Context Retention Policy")).toBeInTheDocument();
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import ErrorBoundary from "../../components/ErrorBoundary";
import DevelopmentIntegration from "./DevelopmentIntegration";
import authReducer from "../../redux/authSlice";
import integrationsReducer from "../../redux/admin/integrationsSlice";

function renderPage({ role = "Super-Admin", initialEntry = "/admin/integrations/projects-development/development" } = {}) {
  localStorage.setItem("role", role);
  localStorage.setItem("isLoggedIn", "true");
  const store = configureStore({
    reducer: { auth: authReducer, integrations: integrationsReducer },
    preloadedState: { auth: { role, isLoggedIn: true, data: {} } },
  });
  const utils = render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <ErrorBoundary>
          <Routes>
            <Route path="/admin/integrations/projects-development/development" element={<DevelopmentIntegration />} />
          </Routes>
        </ErrorBoundary>
      </MemoryRouter>
    </Provider>
  );
  return { store, ...utils };
}

describe("DevelopmentIntegration", () => {
  beforeEach(() => localStorage.clear());

  it("renders the breadcrumb, title and Frontend Preview badge", async () => {
    renderPage();
    expect(await screen.findByText("Administration")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Development Integrations" })).toBeInTheDocument();
    expect(screen.getByText("Frontend Preview")).toBeInTheDocument();
  });

  it("shows all 6 sub-view tabs and defaults to Repositories", async () => {
    renderPage();
    await screen.findByRole("table");
    expect(screen.getByRole("button", { name: "Repositories" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Issues" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Code Reviews" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pipelines" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deployments" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Releases" })).toBeInTheDocument();
  });

  it("honors ?tab= to open a specific sub-view", async () => {
    renderPage({ initialEntry: "/admin/integrations/projects-development/development?tab=pipelines" });
    const table = await screen.findByRole("table");
    expect(within(table).getByText(/Pipeline/)).toBeInTheDocument();
  });

  it("opens the Create Development Issue Preview modal from the Issues tab", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("table");
    await user.click(screen.getByRole("button", { name: "Issues" }));
    await user.click(await screen.findByRole("button", { name: /Create Development Issue Preview/i }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Create Development Issue Preview")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Create Issue Preview" })).toBeDisabled();
  });

  it("never displays source code, diffs or credentials", async () => {
    renderPage();
    await screen.findByRole("table");
    expect(screen.queryByText(/^diff --git/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/clone url/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/https:\/\/github\.com\/.*\.git/i)).not.toBeInTheDocument();
  });
});

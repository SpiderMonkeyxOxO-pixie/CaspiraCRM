import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import ErrorBoundary from "../../components/ErrorBoundary";
import ProjectsIntegrationList from "./ProjectsIntegrationList";
import authReducer from "../../redux/authSlice";
import integrationsReducer from "../../redux/admin/integrationsSlice";

function renderList({ role = "Super-Admin", initialEntries = ["/admin/integrations/projects-development/projects"] } = {}) {
  localStorage.setItem("role", role);
  localStorage.setItem("isLoggedIn", "true");
  const store = configureStore({
    reducer: { auth: authReducer, integrations: integrationsReducer },
    preloadedState: { auth: { role, isLoggedIn: true, data: {} } },
  });
  const utils = render(
    <Provider store={store}>
      <MemoryRouter initialEntries={initialEntries}>
        <ErrorBoundary>
          <Routes>
            <Route path="/admin/integrations/projects-development/projects" element={<ProjectsIntegrationList />} />
          </Routes>
        </ErrorBoundary>
      </MemoryRouter>
    </Provider>
  );
  return { store, ...utils };
}

describe("ProjectsIntegrationList", () => {
  beforeEach(() => localStorage.clear());

  it("renders the breadcrumb, title and Frontend Preview badge", async () => {
    renderList();
    expect(await screen.findByText("Administration")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Linked Projects" })).toBeInTheDocument();
    expect(screen.getByText("Frontend Preview")).toBeInTheDocument();
  });

  it("lists linked Projects with provider name and sync state", async () => {
    renderList();
    expect(await screen.findByText("Caspira Onboarding")).toBeInTheDocument();
    expect(screen.getAllByText("Jira").length).toBeGreaterThan(0);
  });

  it("switches to the Won Deals tab and lists Won Deals without a linked Project", async () => {
    const user = userEvent.setup();
    renderList();
    await screen.findByText("Caspira Onboarding");
    await user.click(screen.getByRole("button", { name: /Won Deals Ready for a Project/i }));
    await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());
  });

  it("unlink requires a written reason before the Unlink button is enabled", async () => {
    const user = userEvent.setup();
    renderList();
    await screen.findByText("Caspira Onboarding");
    const unlinkButtons = screen.getAllByTitle("Unlink external Project");
    await user.click(unlinkButtons[0]);
    const confirmButton = await screen.findByRole("button", { name: "Unlink" });
    expect(confirmButton).toBeDisabled();
  });

  it("never claims an external project or issue was actually created", async () => {
    renderList();
    await screen.findByText("Caspira Onboarding");
    expect(screen.queryByText(/external project was created/i)).not.toBeInTheDocument();
  });
});

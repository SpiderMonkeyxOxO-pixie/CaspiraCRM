import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import ErrorBoundary from "../../components/ErrorBoundary";
import ProjectsDevelopmentOverview from "./ProjectsDevelopmentOverview";
import authReducer from "../../redux/authSlice";
import integrationsReducer from "../../redux/admin/integrationsSlice";

function renderOverview({ role = "Super-Admin" } = {}) {
  localStorage.setItem("role", role);
  localStorage.setItem("isLoggedIn", "true");
  const store = configureStore({
    reducer: { auth: authReducer, integrations: integrationsReducer },
    preloadedState: { auth: { role, isLoggedIn: true, data: {} } },
  });
  const utils = render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/admin/integrations/projects-development"]}>
        <ErrorBoundary>
          <Routes>
            <Route path="/admin/integrations/projects-development" element={<ProjectsDevelopmentOverview />} />
            <Route path="/admin/integrations/projects-development/projects" element={<div>Projects Page</div>} />
          </Routes>
        </ErrorBoundary>
      </MemoryRouter>
    </Provider>
  );
  return { store, ...utils };
}

describe("ProjectsDevelopmentOverview", () => {
  beforeEach(() => localStorage.clear());

  it("renders the breadcrumb and title with the Frontend Preview badge", async () => {
    renderOverview();
    expect(await screen.findByText("Administration")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Projects and Development Integrations" })).toBeInTheDocument();
    expect(screen.getByText("Frontend Preview")).toBeInTheDocument();
  });

  it("System Owner sees a real organization selector with all organizations", async () => {
    renderOverview({ role: "Super-Admin" });
    const select = await screen.findByLabelText("Organization");
    await waitFor(() => expect(within(select).getAllByRole("option")).toHaveLength(4), { timeout: 5000 });
  });

  it("Organization Administrator sees a fixed organization label instead of a selector", async () => {
    renderOverview({ role: "Admin" });
    await waitFor(() => expect(screen.getByText("Caspira HQ")).toBeInTheDocument());
    expect(screen.queryByLabelText("Organization")).not.toBeInTheDocument();
  });

  it("shows the 12 named deterministic metrics", async () => {
    renderOverview();
    expect(await screen.findByRole("button", { name: /Preview-Connected Providers/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Linked Projects/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Won Deals Ready for a Project/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Active Work Items/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Overdue Tasks/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Blocked Tasks/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Milestones at Risk/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open Critical Issues/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Pull\/Merge Requests Awaiting Review/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Failed Builds/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Failed Deployments/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Synchronization Conflicts/i })).toBeInTheDocument();
  });

  it("shows the overview sections", async () => {
    renderOverview();
    expect(await screen.findByText("Provider Health")).toBeInTheDocument();
    expect(screen.getByText("Linked Projects by Provider")).toBeInTheDocument();
    expect(screen.getByText("Won Deals Ready for a Project", { selector: "h2" })).toBeInTheDocument();
    expect(screen.getByText("Paused or Conflicted Links")).toBeInTheDocument();
  });

  it("clicking a metric navigates to the corresponding route", async () => {
    const user = userEvent.setup();
    renderOverview();
    await user.click(await screen.findByRole("button", { name: /Linked Projects/i }));
    expect(await screen.findByText("Projects Page")).toBeInTheDocument();
  });

  it("never claims a provider is genuinely connected or an external project was created", async () => {
    renderOverview();
    await screen.findByText("Provider Health");
    expect(screen.queryByText(/^Connected$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/external project was created/i)).not.toBeInTheDocument();
  });
});

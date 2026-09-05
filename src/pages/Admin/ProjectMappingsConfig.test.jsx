import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import ErrorBoundary from "../../components/ErrorBoundary";
import ProjectMappingsConfig from "./ProjectMappingsConfig";
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
      <MemoryRouter initialEntries={["/admin/integrations/projects-development/mappings"]}>
        <ErrorBoundary>
          <Routes>
            <Route path="/admin/integrations/projects-development/mappings" element={<ProjectMappingsConfig />} />
          </Routes>
        </ErrorBoundary>
      </MemoryRouter>
    </Provider>
  );
  return { store, ...utils };
}

describe("ProjectMappingsConfig", () => {
  beforeEach(() => localStorage.clear());

  it("renders the breadcrumb, title and Frontend Preview badge", async () => {
    renderPage();
    expect(await screen.findByText("Administration")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Field & Status Mappings" })).toBeInTheDocument();
    expect(screen.getByText("Frontend Preview")).toBeInTheDocument();
  });

  it("shows all 7 mapping tabs", async () => {
    renderPage();
    await screen.findByRole("table");
    expect(screen.getByRole("button", { name: "Project Status" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Task Status" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Priority" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Work Item Type" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Users" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Teams" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sync Conflicts" })).toBeInTheDocument();
  });

  it("switches to the Sync Conflicts tab and shows a resolution modal on Resolve", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("table");
    await user.click(screen.getByRole("button", { name: "Sync Conflicts" }));
    const resolveButtons = await screen.findAllByRole("button", { name: "Resolve" });
    await user.click(resolveButtons[0]);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Resolve Synchronization Conflict")).toBeInTheDocument();
    const confirmButton = within(dialog).getByRole("button", { name: "Resolve" });
    expect(confirmButton).toBeDisabled();
  });
});

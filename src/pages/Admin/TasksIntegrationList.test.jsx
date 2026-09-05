import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import ErrorBoundary from "../../components/ErrorBoundary";
import TasksIntegrationList from "./TasksIntegrationList";
import authReducer from "../../redux/authSlice";
import integrationsReducer from "../../redux/admin/integrationsSlice";

function renderList({ role = "Super-Admin" } = {}) {
  localStorage.setItem("role", role);
  localStorage.setItem("isLoggedIn", "true");
  const store = configureStore({
    reducer: { auth: authReducer, integrations: integrationsReducer },
    preloadedState: { auth: { role, isLoggedIn: true, data: {} } },
  });
  const utils = render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/admin/integrations/projects-development/tasks"]}>
        <ErrorBoundary>
          <Routes>
            <Route path="/admin/integrations/projects-development/tasks" element={<TasksIntegrationList />} />
          </Routes>
        </ErrorBoundary>
      </MemoryRouter>
    </Provider>
  );
  return { store, ...utils };
}

describe("TasksIntegrationList", () => {
  beforeEach(() => localStorage.clear());

  it("renders the breadcrumb, title and Frontend Preview badge", async () => {
    renderList();
    expect(await screen.findByText("Administration")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Work Item Synchronization" })).toBeInTheDocument();
    expect(screen.getByText("Frontend Preview")).toBeInTheDocument();
  });

  it("lists work item previews with provider, type and canonical status", async () => {
    renderList();
    const table = await screen.findByRole("table");
    expect(table).toBeInTheDocument();
    expect(screen.getByLabelText("Canonical status")).toBeInTheDocument();
    expect(screen.getByLabelText("Canonical priority")).toBeInTheDocument();
  });

  it("never claims a real provider task was modified", async () => {
    renderList();
    await screen.findByRole("table");
    expect(screen.queryByText(/task was updated in/i)).not.toBeInTheDocument();
  });
});

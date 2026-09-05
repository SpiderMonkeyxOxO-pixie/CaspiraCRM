import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import ErrorBoundary from "../../components/ErrorBoundary";
import AccessAudit from "./AccessAudit";
import authReducer from "../../redux/authSlice";
import accessManagementReducer from "../../redux/admin/accessManagementSlice";

function renderAudit({ role = "Super-Admin" } = {}) {
  localStorage.setItem("role", role);
  localStorage.setItem("isLoggedIn", "true");
  const store = configureStore({
    reducer: { auth: authReducer, accessManagement: accessManagementReducer },
    preloadedState: { auth: { role, isLoggedIn: true, data: {} } },
  });
  const utils = render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/admin/access-audit"]}>
        <ErrorBoundary>
          <Routes>
            <Route path="/admin/access-audit" element={<AccessAudit />} />
          </Routes>
        </ErrorBoundary>
      </MemoryRouter>
    </Provider>
  );
  return { store, ...utils };
}

describe("AccessAudit", () => {
  beforeEach(() => localStorage.clear());

  it("renders the Users & Access breadcrumb and title", async () => {
    renderAudit();
    expect(await screen.findByText("Users & Access")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Access Audit" })).toBeInTheDocument();
  });

  it("System Owner sees the Organization column and events from every organization", async () => {
    renderAudit({ role: "Super-Admin" });
    expect(await screen.findByText("new.admin.candidate@nimbusretail.example")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Organization" })).toBeInTheDocument();
    expect(screen.getByLabelText("Organization")).toBeInTheDocument();
  });

  it("Organization Administrator only sees their own organization's events, no Organization column or selector", async () => {
    renderAudit({ role: "Admin" });
    await screen.findByRole("table", {}, { timeout: 5000 });
    expect(screen.queryByText("new.admin.candidate@nimbusretail.example")).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Organization" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Organization")).not.toBeInTheDocument();
  });

  it("shows compact metrics", async () => {
    renderAudit();
    expect(await screen.findByText("Total Events")).toBeInTheDocument();
    expect(screen.getByText("High-Risk Events")).toBeInTheDocument();
    expect(screen.getByText("Distinct Actors")).toBeInTheDocument();
  });

  it("filters by event type", async () => {
    const user = userEvent.setup();
    renderAudit({ role: "Super-Admin" });
    await screen.findByRole("table", {}, { timeout: 5000 });
    await user.selectOptions(screen.getByLabelText("Event type"), "Member suspended");
    await waitFor(() => expect(screen.queryAllByText("new.hire@caspira.example")).toHaveLength(0), { timeout: 5000 });
    expect(screen.getByText("Tobias Reyes")).toBeInTheDocument();
  });

  it("filters by search text across actor and target", async () => {
    const user = userEvent.setup();
    renderAudit({ role: "Super-Admin" });
    await screen.findByRole("table", {}, { timeout: 5000 });
    await user.type(screen.getByLabelText("Search actor or target"), "Tobias Reyes");
    await waitFor(() => expect(screen.queryAllByText("Amara Okafor")).toHaveLength(0), { timeout: 5000 });
    expect(screen.getByText("Tobias Reyes")).toBeInTheDocument();
  });

  it("opens the read-only detail view for an event", async () => {
    const user = userEvent.setup();
    renderAudit({ role: "Super-Admin" });
    await screen.findByRole("table", {}, { timeout: 5000 });
    const row = screen.getAllByText("Priya Nair")[0].closest("tr");
    await user.click(within(row).getByRole("button", { name: "View" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/frontend-only preview log and cannot be edited or deleted/i)).toBeInTheDocument();
  });
});

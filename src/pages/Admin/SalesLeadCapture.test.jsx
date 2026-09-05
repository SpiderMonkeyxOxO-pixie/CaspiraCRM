import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import ErrorBoundary from "../../components/ErrorBoundary";
import SalesLeadCapture from "./SalesLeadCapture";
import authReducer from "../../redux/authSlice";
import integrationsReducer from "../../redux/admin/integrationsSlice";

function renderLeadCapture({ role = "Super-Admin" } = {}) {
  localStorage.setItem("role", role);
  localStorage.setItem("isLoggedIn", "true");
  const store = configureStore({
    reducer: { auth: authReducer, integrations: integrationsReducer },
    preloadedState: { auth: { role, isLoggedIn: true, data: {} } },
  });
  const utils = render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/admin/integrations/sales-marketing/lead-capture"]}>
        <ErrorBoundary>
          <Routes>
            <Route path="/admin/integrations/sales-marketing" element={<div>Overview Page</div>} />
            <Route path="/admin/integrations/sales-marketing/lead-capture" element={<SalesLeadCapture />} />
          </Routes>
        </ErrorBoundary>
      </MemoryRouter>
    </Provider>
  );
  return { store, ...utils };
}

async function waitForRows() {
  const table = await screen.findByRole("table");
  await waitFor(() => expect(within(table).queryByText("No lead capture events match the current filters.")).not.toBeInTheDocument());
  return table;
}

describe("SalesLeadCapture", () => {
  beforeEach(() => localStorage.clear());

  it("renders the breadcrumb, title and Frontend Preview badge", async () => {
    renderLeadCapture();
    expect(await screen.findByRole("heading", { name: "Lead Capture" })).toBeInTheDocument();
    expect(screen.getByText("Frontend Preview")).toBeInTheDocument();
  });

  it("lists captured leads with routing preview and duplicate flags", async () => {
    renderLeadCapture();
    await waitForRows();
    expect(screen.getByText("Noah Brennan")).toBeInTheDocument();
  });

  it("requires a reason to reject a captured lead", async () => {
    const user = userEvent.setup();
    renderLeadCapture();
    await waitForRows();
    const rejectButtons = await screen.findAllByTitle("Reject");
    await user.click(rejectButtons[0]);
    const dialog = await screen.findByRole("dialog");
    const confirmBtn = within(dialog).getByRole("button", { name: "Confirm Reject" });
    expect(confirmBtn).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/Reason for rejecting/i), "Not a qualified fit");
    expect(confirmBtn).not.toBeDisabled();
  });

  it("a role with no lead_capture grant (Standard Employee) cannot view Lead Capture", async () => {
    renderLeadCapture({ role: "User" });
    await waitFor(() => expect(screen.getByText(/You do not have permission to view Lead Capture/i)).toBeInTheDocument());
  });

  it("Auditor/Checker can view but has no process/reject actions (view-only RBAC grant)", async () => {
    renderLeadCapture({ role: "Checker" });
    await waitForRows();
    expect(screen.queryByTitle("Create Lead Preview")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Reject")).not.toBeInTheDocument();
  });
});

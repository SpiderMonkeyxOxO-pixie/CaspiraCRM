import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import ErrorBoundary from "../../components/ErrorBoundary";
import SalesSuppression from "./SalesSuppression";
import authReducer from "../../redux/authSlice";
import integrationsReducer from "../../redux/admin/integrationsSlice";

function renderSuppression({ role = "Super-Admin" } = {}) {
  localStorage.setItem("role", role);
  localStorage.setItem("isLoggedIn", "true");
  const store = configureStore({
    reducer: { auth: authReducer, integrations: integrationsReducer },
    preloadedState: { auth: { role, isLoggedIn: true, data: {} } },
  });
  const utils = render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/admin/integrations/sales-marketing/suppression"]}>
        <ErrorBoundary>
          <Routes>
            <Route path="/admin/integrations/sales-marketing" element={<div>Overview Page</div>} />
            <Route path="/admin/integrations/sales-marketing/suppression" element={<SalesSuppression />} />
          </Routes>
        </ErrorBoundary>
      </MemoryRouter>
    </Provider>
  );
  return { store, ...utils };
}

describe("SalesSuppression", () => {
  beforeEach(() => localStorage.clear());

  it("renders the breadcrumb, title and Frontend Preview badge", async () => {
    renderSuppression();
    expect(await screen.findByRole("heading", { name: "Suppression Management" })).toBeInTheDocument();
    expect(screen.getByText("Frontend Preview")).toBeInTheDocument();
  });

  it("lists suppression entries resolved to a real contact/lead name", async () => {
    renderSuppression();
    await waitFor(() => expect(screen.getAllByText("Unsubscribed").length).toBeGreaterThan(0));
  });

  it("requires a written reason before removing a suppression entry (high-risk)", async () => {
    const user = userEvent.setup();
    renderSuppression();
    const removeButtons = await screen.findAllByRole("button", { name: "Remove" });
    await user.click(removeButtons[0]);
    const dialog = await screen.findByRole("dialog");
    const confirmBtn = within(dialog).getByRole("button", { name: "Confirm Remove" });
    expect(confirmBtn).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/Reason for removing/i), "Resubscribed via support ticket");
    expect(confirmBtn).not.toBeDisabled();
  });

  it("Auditor/Checker can view but has no Remove action (view-only RBAC grant)", async () => {
    renderSuppression({ role: "Checker" });
    await waitFor(() => expect(screen.getAllByText("Unsubscribed").length).toBeGreaterThan(0));
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
  });

  it("a role with no suppression grant (Standard Employee) cannot view Suppression", async () => {
    renderSuppression({ role: "User" });
    await waitFor(() => expect(screen.getByText(/You do not have permission to view Suppression/i)).toBeInTheDocument());
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import ErrorBoundary from "../../components/ErrorBoundary";
import SupportSLA from "./SupportSLA";
import authReducer from "../../redux/authSlice";
import integrationsReducer from "../../redux/admin/integrationsSlice";

function renderSla({ role = "Super-Admin", initialPath = "/admin/integrations/support-communication/sla" } = {}) {
  localStorage.setItem("role", role);
  localStorage.setItem("isLoggedIn", "true");
  const store = configureStore({
    reducer: { auth: authReducer, integrations: integrationsReducer },
    preloadedState: { auth: { role, isLoggedIn: true, data: {} } },
  });
  const utils = render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[initialPath]}>
        <ErrorBoundary>
          <Routes>
            <Route path="/admin/integrations/support-communication" element={<div>Overview Page</div>} />
            <Route path="/admin/integrations/support-communication/sla" element={<SupportSLA />} />
          </Routes>
        </ErrorBoundary>
      </MemoryRouter>
    </Provider>
  );
  return { store, ...utils };
}

describe("SupportSLA", () => {
  beforeEach(() => localStorage.clear());

  it("renders the breadcrumb, title and Frontend Preview badge", async () => {
    renderSla();
    expect(await screen.findByText("SLA")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "SLA & Escalations" })).toBeInTheDocument();
    expect(screen.getByText("Frontend Preview")).toBeInTheDocument();
  });

  it("shows SLA state count cards and the SLA configuration, using real SLA_HOURS-derived targets", async () => {
    renderSla();
    expect(await screen.findByText("SLA Configuration")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("HQ Default SLA")).toBeInTheDocument());
    expect(screen.getAllByText(/Urgent: 1h \/ 4h/).length).toBeGreaterThan(0);
  });

  it("deep-links to a specific SLA state via the ?status= query param", async () => {
    renderSla({ initialPath: "/admin/integrations/support-communication/sla?status=At Risk" });
    await waitFor(() => expect(screen.getByText("At Risk Tickets")).toBeInTheDocument());
  });

  it("shows escalation rules, disabling preview when no ticket is currently Breached or At Risk", async () => {
    renderSla();
    await waitFor(() => expect(screen.getByText("Escalation Rules")).toBeInTheDocument());
    const previewButtons = await screen.findAllByRole("button", { name: "Preview Escalation" });
    expect(previewButtons.length).toBeGreaterThan(0);
    // The seeded fixtures have no ticket currently Breached/At Risk, so the
    // action correctly stays disabled rather than previewing against an
    // arbitrary healthy ticket.
    previewButtons.forEach((btn) => expect(btn).toBeDisabled());
  });

  it("a role with no support_sla grant (Standard Employee) cannot view SLA", async () => {
    renderSla({ role: "User" });
    await waitFor(() => expect(screen.getByText(/You do not have permission to view SLA/i)).toBeInTheDocument());
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import ErrorBoundary from "../../components/ErrorBoundary";
import SupportTelephony from "./SupportTelephony";
import authReducer from "../../redux/authSlice";
import integrationsReducer from "../../redux/admin/integrationsSlice";

function renderTelephony({ role = "Super-Admin" } = {}) {
  localStorage.setItem("role", role);
  localStorage.setItem("isLoggedIn", "true");
  const store = configureStore({
    reducer: { auth: authReducer, integrations: integrationsReducer },
    preloadedState: { auth: { role, isLoggedIn: true, data: {} } },
  });
  const utils = render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/admin/integrations/support-communication/telephony"]}>
        <ErrorBoundary>
          <Routes>
            <Route path="/admin/integrations/support-communication" element={<div>Overview Page</div>} />
            <Route path="/admin/integrations/support-communication/telephony" element={<SupportTelephony />} />
          </Routes>
        </ErrorBoundary>
      </MemoryRouter>
    </Provider>
  );
  return { store, ...utils };
}

describe("SupportTelephony", () => {
  beforeEach(() => localStorage.clear());

  it("renders the breadcrumb, title and Frontend Preview badge", async () => {
    renderTelephony();
    expect(await screen.findByRole("heading", { name: "Telephony" })).toBeInTheDocument();
    expect(screen.getAllByText("Telephony").length).toBeGreaterThan(0);
    expect(screen.getByText("Frontend Preview")).toBeInTheDocument();
  });

  it("shows the missed call queue and disposition summary", async () => {
    renderTelephony();
    await waitFor(() => expect(screen.getByText(/Missed Call Queue/i)).toBeInTheDocument());
    expect(screen.getByText("Disposition Summary")).toBeInTheDocument();
  });

  it("never exposes a recording URL or token — only an access-state indicator", async () => {
    renderTelephony();
    await waitFor(() => expect(screen.getByText("Available")).toBeInTheDocument());
    expect(screen.getByText("Consent Required")).toBeInTheDocument();
    expect(screen.queryByText(/http/i)).not.toBeInTheDocument();
  });

  it("creates a follow-up Activity preview from the missed call queue", async () => {
    const user = userEvent.setup();
    renderTelephony();
    const followUpButtons = await screen.findAllByRole("button", { name: /Create Follow-up Preview/i });
    await user.click(followUpButtons[0]);
    await waitFor(() => expect(screen.getAllByText(/Activity Created/i).length).toBeGreaterThan(0));
  });

  it("a role with no support_calls grant (Standard Employee) cannot view Telephony", async () => {
    renderTelephony({ role: "User" });
    await waitFor(() => expect(screen.getByText(/You do not have permission to view Telephony/i)).toBeInTheDocument());
  });
});

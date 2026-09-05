import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import ErrorBoundary from "../../components/ErrorBoundary";
import IntegrationActivity from "./IntegrationActivity";
import authReducer from "../../redux/authSlice";
import integrationsReducer from "../../redux/admin/integrationsSlice";

function renderActivity({ role = "Super-Admin" } = {}) {
  localStorage.setItem("role", role);
  localStorage.setItem("isLoggedIn", "true");
  const store = configureStore({
    reducer: { auth: authReducer, integrations: integrationsReducer },
    preloadedState: { auth: { role, isLoggedIn: true, data: {} } },
  });
  const utils = render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/admin/integrations/activity"]}>
        <ErrorBoundary>
          <Routes>
            <Route path="/admin/integrations/activity" element={<IntegrationActivity />} />
          </Routes>
        </ErrorBoundary>
      </MemoryRouter>
    </Provider>
  );
  return { store, ...utils };
}

describe("IntegrationActivity", () => {
  beforeEach(() => localStorage.clear());

  it("renders the breadcrumb and title", async () => {
    renderActivity();
    expect(await screen.findByText("Activity")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Integration Activity" })).toBeInTheDocument();
  });

  it("renders every required column", async () => {
    renderActivity();
    await screen.findByRole("table");
    ["Date & Time", "Provider", "Organization", "Connection", "Event", "Initiated By", "Result", "Records Affected", "Duration", "Action"].forEach((col) => {
      expect(screen.getByRole("columnheader", { name: col })).toBeInTheDocument();
    });
  });

  it("System Owner sees an organization selector and cross-org events", async () => {
    renderActivity({ role: "Super-Admin" });
    expect(await screen.findByLabelText("Organization")).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText("Nimbus Retail Group").length).toBeGreaterThan(0), { timeout: 5000 });
  });

  it("Organization Administrator only sees their own organization's activity, no org column or selector", async () => {
    renderActivity({ role: "Admin" });
    await screen.findByRole("table");
    expect(screen.queryByLabelText("Organization")).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Organization" })).not.toBeInTheDocument();
    expect(screen.queryByText("Nimbus Retail Group")).not.toBeInTheDocument();
  });

  it("filters by event type", async () => {
    const user = userEvent.setup();
    renderActivity({ role: "Super-Admin" });
    await screen.findByRole("table");
    await user.selectOptions(screen.getByLabelText("Event type"), "Preview connection paused");
    await waitFor(() => {
      const rows = screen.getAllByRole("row").slice(1); // skip header
      expect(rows.length).toBeGreaterThan(0);
      rows.forEach((row) => expect(within(row).getByText("Preview connection paused")).toBeInTheDocument());
    }, { timeout: 5000 });
  });

  it("filters by search text", async () => {
    const user = userEvent.setup();
    renderActivity({ role: "Super-Admin" });
    const table = await screen.findByRole("table");
    await user.type(screen.getByLabelText("Search"), "Slack");
    await waitFor(() => expect(within(table).queryByText("Stripe")).not.toBeInTheDocument(), { timeout: 5000 });
  }, 15000);

  it("opens the detail drawer without exposing secrets or credential metadata", async () => {
    const user = userEvent.setup();
    renderActivity({ role: "Super-Admin" });
    await screen.findByRole("table");
    await user.click(screen.getAllByRole("button", { name: "View" })[0]);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(/No secrets, API keys or credential metadata are ever shown here/i);
    expect(dialog).not.toHaveTextContent(/sk_live|sk_test|Bearer /);
  });

  it("shows a no-results empty state", async () => {
    const user = userEvent.setup();
    renderActivity({ role: "Super-Admin" });
    await screen.findByRole("table");
    await user.type(screen.getByLabelText("Search"), "not-a-real-search-term-xyz");
    await waitFor(() => expect(screen.getByText(/No integration activity matches this view/i)).toBeInTheDocument(), { timeout: 5000 });
  });
});

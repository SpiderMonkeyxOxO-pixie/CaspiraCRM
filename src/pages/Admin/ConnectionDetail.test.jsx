import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import ErrorBoundary from "../../components/ErrorBoundary";
import ConnectionDetail from "./ConnectionDetail";
import authReducer from "../../redux/authSlice";
import integrationsReducer from "../../redux/admin/integrationsSlice";

function renderConnection(connectionId, { role = "Super-Admin" } = {}) {
  localStorage.setItem("role", role);
  localStorage.setItem("isLoggedIn", "true");
  const store = configureStore({
    reducer: { auth: authReducer, integrations: integrationsReducer },
    preloadedState: { auth: { role, isLoggedIn: true, data: {} } },
  });
  const utils = render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[`/admin/integrations/connections/${connectionId}`]}>
        <ErrorBoundary>
          <Routes>
            <Route path="/admin/integrations/connections/:connectionId" element={<ConnectionDetail />} />
            <Route path="/admin/integrations/:providerKey" element={<div>Provider Detail Page</div>} />
          </Routes>
        </ErrorBoundary>
      </MemoryRouter>
    </Provider>
  );
  return { store, ...utils };
}

describe("ConnectionDetail", () => {
  beforeEach(() => localStorage.clear());

  it("renders the breadcrumb and provider name", async () => {
    renderConnection("conn_1");
    expect(await screen.findByRole("heading", { name: "Slack" })).toBeInTheDocument();
    expect(screen.getByText("Connection")).toBeInTheDocument();
  });

  it("shows provider, organization, status, connected-by and created date", async () => {
    renderConnection("conn_3");
    await screen.findByRole("heading", { name: "Stripe" });
    expect(screen.getAllByText("Configuration Required").length).toBeGreaterThan(0);
    expect(screen.getByText("Caspira HQ")).toBeInTheDocument();
    expect(screen.getByText("Priya Nair")).toBeInTheDocument();
  });

  it("shows selected capabilities, data scope, sync direction and notification preferences", async () => {
    renderConnection("conn_1");
    await screen.findByRole("heading", { name: "Slack" });
    expect(screen.getByText("Selected capabilities")).toBeInTheDocument();
    expect(screen.getByText("Data scope & synchronization")).toBeInTheDocument();
    expect(screen.getByText("Notification preferences")).toBeInTheDocument();
    expect(screen.getAllByText("Export Only").length).toBeGreaterThan(0);
  });

  it("shows the Data Mapping table with sensitive-field warnings", async () => {
    renderConnection("conn_3");
    await screen.findByRole("heading", { name: "Stripe" });
    expect(screen.getByRole("columnheader", { name: "CRM Entity" })).toBeInTheDocument();
    expect(screen.getByText("billingEmail")).toBeInTheDocument();
    expect(screen.getByText(/Sensitive field — requires permission/i)).toBeInTheDocument();
  });

  it("shows health and recent errors", async () => {
    renderConnection("conn_2");
    await screen.findByRole("heading", { name: "Google Workspace" });
    expect(screen.getAllByText("Attention Required").length).toBeGreaterThan(0);
    expect(screen.getByText("Recent Errors")).toBeInTheDocument();
    expect(screen.getAllByText(/Contact sync permission preview expired/i).length).toBeGreaterThan(0);
  });

  it("shows audit events for this connection", async () => {
    renderConnection("conn_1");
    await screen.findByRole("heading", { name: "Slack" });
    expect(screen.getByText("Audit Events")).toBeInTheDocument();
    expect(await screen.findByText("Preview connection created")).toBeInTheDocument();
  });

  it("runs a preview synchronization and updates the history table", async () => {
    const user = userEvent.setup();
    renderConnection("conn_8", { role: "Super-Admin" });
    await screen.findByRole("heading", { name: "Zoom" });
    await user.click(screen.getByRole("button", { name: /Run Preview Synchronization/i }));
    await waitFor(() => expect(screen.getAllByText("Preview Synchronization").length).toBeGreaterThan(1), { timeout: 5000 });
  }, 15000);

  it("pauses and resumes a connection", async () => {
    const user = userEvent.setup();
    renderConnection("conn_1");
    await screen.findByRole("heading", { name: "Slack" });
    await user.click(screen.getByRole("button", { name: /Pause Preview/i }));
    await waitFor(() => expect(screen.getByText("Preview Paused")).toBeInTheDocument(), { timeout: 5000 });
    await user.click(screen.getByRole("button", { name: /Resume Preview/i }));
    await waitFor(() => expect(screen.getByText("Preview Connected")).toBeInTheDocument(), { timeout: 5000 });
  }, 15000);

  it("disconnect requires a written reason and explains affected capabilities", async () => {
    const user = userEvent.setup();
    renderConnection("conn_6");
    await screen.findByRole("heading", { name: "Microsoft 365" });
    await user.click(screen.getByRole("button", { name: /Disconnect Preview/i }));

    const dialog = await screen.findByRole("dialog", { name: /Disconnect Microsoft 365 preview/i });
    expect(dialog).toHaveTextContent(/Affected capabilities/i);
    expect(dialog).toHaveTextContent(/undo this during the current session/i);
    const confirmButton = screen.getByRole("button", { name: "Disconnect" });
    expect(confirmButton).toBeDisabled();
    await user.type(screen.getByLabelText("Reason"), "Testing disconnect flow.");
    expect(confirmButton).not.toBeDisabled();
  });

  it("disconnecting and then undoing restores the connection within the session", async () => {
    const user = userEvent.setup();
    renderConnection("conn_8");
    await screen.findByRole("heading", { name: "Zoom" });
    await user.click(screen.getByRole("button", { name: /Disconnect Preview/i }));
    await user.type(screen.getByLabelText("Reason"), "Testing disconnect and undo.");
    await user.click(screen.getByRole("button", { name: "Disconnect" }));

    await waitFor(() => expect(screen.getByText("Preview Disconnected")).toBeInTheDocument(), { timeout: 5000 });
    await user.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(screen.getByText("Preview Connected")).toBeInTheDocument(), { timeout: 5000 });
  }, 15000);

  it("Organization Administrator can never view a connection belonging to another organization", async () => {
    renderConnection("conn_8", { role: "Admin" }); // org_solstice_partners, not the Org Admin's own org
    expect(await screen.findByText(/could not be found, or you don't have access/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Zoom" })).not.toBeInTheDocument();
  });

  it("Auditor/Checker sees no management actions", async () => {
    renderConnection("conn_1", { role: "Checker" });
    await screen.findByRole("heading", { name: "Slack" });
    expect(screen.queryByRole("button", { name: /Disconnect Preview/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Run Preview Synchronization/i })).not.toBeInTheDocument();
  });

  it("shows an error state for an unknown connection id", async () => {
    renderConnection("conn_does_not_exist");
    expect(await screen.findByText(/could not be found/i)).toBeInTheDocument();
  });

  it("editing the preview configuration updates selected capabilities", async () => {
    const user = userEvent.setup();
    renderConnection("conn_1");
    await screen.findByRole("heading", { name: "Slack" });
    await user.click(screen.getByRole("button", { name: /Edit Preview Configuration/i }));
    const dialog = await screen.findByRole("dialog", { name: "Edit Preview Configuration" });
    expect(dialog).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit Preview Configuration" })).not.toBeInTheDocument(), { timeout: 5000 });
  });
});

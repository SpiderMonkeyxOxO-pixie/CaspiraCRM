import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import ErrorBoundary from "../../components/ErrorBoundary";
import SupportCommunicationOverview from "./SupportCommunicationOverview";
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
      <MemoryRouter initialEntries={["/admin/integrations/support-communication"]}>
        <ErrorBoundary>
          <Routes>
            <Route path="/admin/integrations/support-communication" element={<SupportCommunicationOverview />} />
            <Route path="/admin/integrations/support-communication/channels" element={<div>Channels Page</div>} />
            <Route path="/admin/integrations/support-communication/tickets" element={<div>Tickets Page</div>} />
            <Route path="/admin/integrations/support-communication/inbox" element={<div>Inbox Page</div>} />
            <Route path="/admin/integrations/support-communication/sla" element={<div>SLA Page</div>} />
            <Route path="/admin/integrations/support-communication/telephony" element={<div>Telephony Page</div>} />
          </Routes>
        </ErrorBoundary>
      </MemoryRouter>
    </Provider>
  );
  return { store, ...utils };
}

describe("SupportCommunicationOverview", () => {
  beforeEach(() => localStorage.clear());

  it("renders the Administration / Integrations / Support & Communication breadcrumb and title", async () => {
    renderOverview();
    expect(await screen.findByText("Administration")).toBeInTheDocument();
    expect(screen.getByText("Support & Communication")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Support and Communication Integrations" })).toBeInTheDocument();
  });

  it("shows the Frontend Preview status badge", async () => {
    renderOverview();
    expect(await screen.findByText("Frontend Preview")).toBeInTheDocument();
  });

  it("System Owner sees a real organization selector with all organizations", async () => {
    renderOverview({ role: "Super-Admin" });
    const select = await screen.findByLabelText("Organization");
    await waitFor(() => expect(within(select).getAllByRole("option")).toHaveLength(4), { timeout: 5000 }); // "All organizations" + 3
  });

  it("Organization Administrator sees a fixed organization label instead of a selector", async () => {
    renderOverview({ role: "Admin" });
    await waitFor(() => expect(screen.getByText("Caspira HQ")).toBeInTheDocument());
    expect(screen.queryByLabelText("Organization")).not.toBeInTheDocument();
  });

  it("shows the 10 named deterministic metrics", async () => {
    renderOverview();
    expect(await screen.findByRole("button", { name: /Preview-Connected Providers/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open Ticket Previews/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Unassigned Tickets/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Unread Conversations/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Waiting on Customer/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /SLA At Risk/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /SLA Breached/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Missed Calls/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Identity Matches to Review/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Synchronization Errors/i })).toBeInTheDocument();
  });

  it("shows the 9 named overview sections", async () => {
    renderOverview();
    expect(await screen.findByText("Support Health")).toBeInTheDocument();
    expect(screen.getByText("Omnichannel Workload")).toBeInTheDocument();
    expect(screen.getByText("SLA Risks")).toBeInTheDocument();
    expect(screen.getByText("Unassigned Work")).toBeInTheDocument();
    expect(screen.getByText("Recent Conversations")).toBeInTheDocument();
    expect(screen.getByText("Recent Calls")).toBeInTheDocument();
    expect(screen.getByText("Identity-Matching Issues")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /^Synchronization Errors/i })).toBeInTheDocument();
    expect(screen.getByText("Internal Escalations")).toBeInTheDocument();
  });

  it("shows the filter controls (date range, provider, channel, ticket status, SLA status)", async () => {
    renderOverview();
    await screen.findByText("Support Health");
    expect(screen.getByLabelText("From date")).toBeInTheDocument();
    expect(screen.getByLabelText("To date")).toBeInTheDocument();
    expect(screen.getByLabelText("Provider")).toBeInTheDocument();
    expect(screen.getByLabelText("Channel")).toBeInTheDocument();
    expect(screen.getByLabelText("Ticket status")).toBeInTheDocument();
    expect(screen.getByLabelText("SLA status")).toBeInTheDocument();
  });

  it("clicking a metric navigates to the corresponding route", async () => {
    const user = userEvent.setup();
    renderOverview();
    await user.click(await screen.findByRole("button", { name: /Preview-Connected Providers/i }));
    expect(await screen.findByText("Channels Page")).toBeInTheDocument();
  });

  it("never displays a bare Connected status — only preview-qualified statuses", async () => {
    renderOverview();
    await screen.findByText("Support Health");
    expect(screen.queryByText(/^Connected$/)).not.toBeInTheDocument();
  });

  it("never claims a real message, call or reply was sent", async () => {
    renderOverview();
    await screen.findByText("Identity-Matching Issues");
    expect(screen.queryByText(/message was sent/i)).not.toBeInTheDocument();
  });
});

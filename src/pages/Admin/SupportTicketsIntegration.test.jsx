import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import ErrorBoundary from "../../components/ErrorBoundary";
import SupportTicketsIntegration from "./SupportTicketsIntegration";
import authReducer from "../../redux/authSlice";
import integrationsReducer from "../../redux/admin/integrationsSlice";

function renderTickets({ role = "Super-Admin" } = {}) {
  localStorage.setItem("role", role);
  localStorage.setItem("isLoggedIn", "true");
  const store = configureStore({
    reducer: { auth: authReducer, integrations: integrationsReducer },
    preloadedState: { auth: { role, isLoggedIn: true, data: {} } },
  });
  const utils = render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/admin/integrations/support-communication/tickets"]}>
        <ErrorBoundary>
          <Routes>
            <Route path="/admin/integrations/support-communication" element={<div>Overview Page</div>} />
            <Route path="/admin/integrations/support-communication/tickets" element={<SupportTicketsIntegration />} />
            <Route path="/support/tickets/:id" element={<div>Internal Ticket Detail Page</div>} />
          </Routes>
        </ErrorBoundary>
      </MemoryRouter>
    </Provider>
  );
  return { store, ...utils };
}

async function waitForRows() {
  const table = await screen.findByRole("table");
  await waitFor(() => expect(within(table).queryByText("No tickets match the current filters.")).not.toBeInTheDocument());
  await waitFor(() => expect(within(table).getAllByRole("row").length).toBeGreaterThan(1));
  return table;
}

describe("SupportTicketsIntegration", () => {
  beforeEach(() => localStorage.clear());

  it("renders the breadcrumb, title and Frontend Preview badge", async () => {
    renderTickets();
    expect(await screen.findByText("Tickets")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Support Tickets" })).toBeInTheDocument();
    expect(screen.getByText("Frontend Preview")).toBeInTheDocument();
  });

  it("shows the table with all required columns", async () => {
    renderTickets();
    const table = await waitForRows();
    ["Ticket", "Customer", "Company", "Provider", "Channel", "Status", "Priority", "Queue", "Assignee", "SLA", "Updated", "Sync", "Actions"].forEach((col) => {
      expect(within(table).getByText(col)).toBeInTheDocument();
    });
  });

  it("filters tickets by search text", async () => {
    const user = userEvent.setup();
    renderTickets();
    const table = await waitForRows();
    await user.type(screen.getByLabelText("Search tickets"), "Recurring sync failures");
    await waitFor(() => expect(within(table).getAllByRole("row").length).toBe(2)); // header + 1 match
  });

  it("switches between table and board view", async () => {
    const user = userEvent.setup();
    renderTickets();
    await waitForRows();
    await user.click(screen.getByLabelText("Board view"));
    expect(screen.getByText((_, el) => el.tagName === "H3" && el.textContent.startsWith("New"))).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("opens the ticket detail drawer with a link to the authorized CRM record", async () => {
    const user = userEvent.setup();
    renderTickets();
    const table = await waitForRows();
    const firstTicketLink = within(table).getAllByRole("button").find((b) => /^TCK-/.test(b.textContent));
    await user.click(firstTicketLink);
    const dialog = await screen.findByRole("dialog", { name: "Ticket detail" });
    expect(within(dialog).getByRole("link", { name: /Open Authorized CRM Record/i })).toHaveAttribute("href", expect.stringMatching(/^\/support\/tickets\//));
  });

  it("shows the Synchronization Conflicts panel with resolution options", async () => {
    const user = userEvent.setup();
    renderTickets();
    await waitForRows();
    await user.click(screen.getByRole("button", { name: /Sync Conflicts/i }));
    expect(await screen.findByText("Synchronization Conflicts")).toBeInTheDocument();
  });

  it("selecting tickets reveals a Bulk Close action that requires a written reason", async () => {
    const user = userEvent.setup();
    renderTickets();
    const table = await waitForRows();
    const checkboxes = within(table).getAllByRole("checkbox");
    await user.click(checkboxes[0]);
    const bulkCloseButton = await screen.findByRole("button", { name: "Bulk Close" });
    await user.click(bulkCloseButton);
    const confirmButton = await screen.findByRole("button", { name: "Confirm Bulk Close" });
    expect(confirmButton).toBeDisabled();
  });

  it("Organization Administrator does not see an organization-switching selector", async () => {
    renderTickets({ role: "Admin" });
    await waitForRows();
    expect(screen.queryByText("All organizations")).not.toBeInTheDocument();
  });

  it("a role with no support_tickets grant cannot view the route", async () => {
    localStorage.setItem("role", "User");
    localStorage.setItem("isLoggedIn", "true");
    renderTickets({ role: "User" });
    await waitFor(() => expect(screen.getByText(/You do not have permission to view Support Tickets/i)).toBeInTheDocument());
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import ErrorBoundary from "../../components/ErrorBoundary";
import InvitationsList from "./InvitationsList";
import authReducer from "../../redux/authSlice";
import accessManagementReducer from "../../redux/admin/accessManagementSlice";

function renderInvitations({ role = "Super-Admin" } = {}) {
  localStorage.setItem("role", role);
  localStorage.setItem("isLoggedIn", "true");
  const store = configureStore({
    reducer: { auth: authReducer, accessManagement: accessManagementReducer },
    preloadedState: { auth: { role, isLoggedIn: true, data: {} } },
  });
  const utils = render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/admin/invitations"]}>
        <ErrorBoundary>
          <Routes>
            <Route path="/admin/invitations" element={<InvitationsList />} />
          </Routes>
        </ErrorBoundary>
      </MemoryRouter>
    </Provider>
  );
  return { store, ...utils };
}

describe("InvitationsList", () => {
  beforeEach(() => localStorage.clear());

  it("renders the Users & Access breadcrumb and title", async () => {
    renderInvitations();
    expect(await screen.findByText("Users & Access")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Invitations" })).toBeInTheDocument();
  });

  it("System Owner sees the Organization column and cross-org invitations", async () => {
    renderInvitations({ role: "Super-Admin" });
    expect(await screen.findByText("new.admin.candidate@nimbusretail.example")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Organization" })).toBeInTheDocument();
  });

  it("Organization Administrator only sees their own organization's invitations, no Organization column", async () => {
    renderInvitations({ role: "Admin" });
    await screen.findByText("new.hire@caspira.example");
    expect(screen.queryByText("new.admin.candidate@nimbusretail.example")).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Organization" })).not.toBeInTheDocument();
  });

  it("shows compact metrics", async () => {
    renderInvitations();
    expect(await screen.findByText("Pending")).toBeInTheDocument();
    expect(screen.getByText("Approval Required")).toBeInTheDocument();
    expect(screen.getByText("Expiring Soon")).toBeInTheDocument();
    expect(screen.getByText("Expired")).toBeInTheDocument();
  });

  it("clicking the Approval Required metric filters the table and shows the review hint", async () => {
    const user = userEvent.setup();
    renderInvitations({ role: "Super-Admin" });
    await screen.findByText("pending.approval@caspira.example");
    await user.click(screen.getByRole("button", { name: /Approval Required/ }));
    await waitFor(() => expect(screen.queryByText("new.hire@caspira.example")).not.toBeInTheDocument(), { timeout: 5000 });
    expect(screen.getByText("pending.approval@caspira.example")).toBeInTheDocument();
    expect(screen.getByText(/awaiting your review/i)).toBeInTheDocument();
  });

  it("opens the detail drawer with a frontend-only preview notice", async () => {
    const user = userEvent.setup();
    renderInvitations({ role: "Super-Admin" });
    await user.click(await screen.findByText("new.hire@caspira.example"));
    const dialog = screen.getByRole("dialog", { name: /Invitation details/i });
    expect(within(dialog).getByText(/frontend-only preview/i)).toBeInTheDocument();
  });

  it("rejecting a request requires a written reason", async () => {
    const user = userEvent.setup();
    renderInvitations({ role: "Super-Admin" });
    await screen.findByText("pending.approval@caspira.example");
    const row = screen.getByText("pending.approval@caspira.example").closest("tr");
    await user.click(within(row).getByRole("button", { name: /Row actions/i }));
    await user.click(within(row).getByRole("menuitem", { name: "Reject" }));

    const dialog = screen.getByRole("dialog", { name: /Reject membership request/i });
    const rejectButton = within(dialog).getByRole("button", { name: "Reject" });
    expect(rejectButton).toBeDisabled();
    await user.type(within(dialog).getByLabelText("Reason"), "Role scope does not match approved headcount.");
    expect(rejectButton).not.toBeDisabled();
  });

  it("approving a request in the Approval Required queue moves it out of the queue", async () => {
    const user = userEvent.setup();
    const { store } = renderInvitations({ role: "Super-Admin" });
    await screen.findByText("pending.approval@caspira.example");
    const row = screen.getByText("pending.approval@caspira.example").closest("tr");
    await user.click(within(row).getByRole("button", { name: /Row actions/i }));
    await user.click(within(row).getByRole("menuitem", { name: /Approve Frontend Membership/i }));

    await waitFor(() => {
      const updated = store.getState().accessManagement.invitations.find((i) => i.id === "invite_3");
      expect(updated.status).toBe("Accepted Preview");
    }, { timeout: 5000 });
  }, 15000);

  it("revoking an invitation requires a written reason and invalidates it", async () => {
    const user = userEvent.setup();
    const { store } = renderInvitations({ role: "Super-Admin" });
    await screen.findByText("new.hire@caspira.example");
    const row = screen.getByText("new.hire@caspira.example").closest("tr");
    await user.click(within(row).getByRole("button", { name: /Row actions/i }));
    await user.click(within(row).getByRole("menuitem", { name: "Revoke" }));

    const dialog = screen.getByRole("dialog", { name: /Revoke invitation/i });
    const revokeButton = within(dialog).getByRole("button", { name: "Revoke" });
    expect(revokeButton).toBeDisabled();
    await user.type(within(dialog).getByLabelText("Reason"), "Position has been filled internally.");
    expect(revokeButton).not.toBeDisabled();
    await user.click(revokeButton);

    await waitFor(() => {
      const updated = store.getState().accessManagement.invitations.find((i) => i.id === "invite_1");
      expect(updated.status).toBe("Revoked");
    }, { timeout: 5000 });
  }, 15000);

  it("shows the Invite Member button for privileged roles and opens the wizard", async () => {
    const user = userEvent.setup();
    renderInvitations({ role: "Admin" });
    const inviteButton = await screen.findByRole("button", { name: /Invite Member/i });
    await user.click(inviteButton);
    expect(screen.getByRole("dialog", { name: "Invite Member" })).toBeInTheDocument();
  });
});

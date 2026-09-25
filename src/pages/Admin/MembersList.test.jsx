import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import ErrorBoundary from "../../components/ErrorBoundary";
import MembersList from "./MembersList";
import authReducer from "../../redux/authSlice";
import accessManagementReducer from "../../redux/admin/accessManagementSlice";

function renderMembers({ role = "Super-Admin" } = {}) {
  localStorage.setItem("role", role);
  localStorage.setItem("isLoggedIn", "true");
  const store = configureStore({
    reducer: { auth: authReducer, accessManagement: accessManagementReducer },
    preloadedState: { auth: { role, isLoggedIn: true, data: {} } },
  });
  const utils = render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/admin/users"]}>
        <ErrorBoundary>
          <Routes>
            <Route path="/admin/users" element={<MembersList />} />
            <Route path="/admin/invite-links" element={<div>Invite Links Page</div>} />
          </Routes>
        </ErrorBoundary>
      </MemoryRouter>
    </Provider>
  );
  return { store, ...utils };
}

describe("MembersList", () => {
  beforeEach(() => localStorage.clear());

  it("renders the Users & Access breadcrumb and title", async () => {
    renderMembers();
    expect(await screen.findByText("Users & Access")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Members" })).toBeInTheDocument();
  });

  it("System Owner sees an organization selector with all three organizations", async () => {
    renderMembers({ role: "Super-Admin" });
    const select = await screen.findByLabelText("Organization");
    expect(within(select).getAllByRole("option")).toHaveLength(4); // "All organizations" + 3
  });

  it("Organization Administrator sees a fixed, non-editable organization label instead", async () => {
    renderMembers({ role: "Admin" });
    await waitFor(() => expect(screen.getByText("Caspira HQ")).toBeInTheDocument());
    expect(screen.queryByLabelText("Organization")).not.toBeInTheDocument();
  });

  it("Organization Administrator never sees another organization's members, and the Organization column is hidden", async () => {
    const { store } = renderMembers({ role: "Admin" });
    await waitFor(() => expect(store.getState().accessManagement.members.length).toBeGreaterThan(0));
    const members = store.getState().accessManagement.members;
    expect(members.every((m) => m.organizationId === "org_caspira_hq")).toBe(true);
    expect(screen.queryByRole("columnheader", { name: "Organization" })).not.toBeInTheDocument();
  });

  it("shows the Invite Member button for System Owner and Organization Administrator", async () => {
    renderMembers({ role: "Super-Admin" });
    expect(await screen.findByRole("button", { name: /Invite Member/i })).toBeInTheDocument();
  });

  it("shows compact metrics", async () => {
    renderMembers();
    expect(await screen.findByText("Active Members")).toBeInTheDocument();
    expect(screen.getByText("Pending Invitations")).toBeInTheDocument();
    expect(screen.getByText("Suspended")).toBeInTheDocument();
    expect(screen.getByText("High-Privilege")).toBeInTheDocument();
  });

  it("clicking the Suspended metric filters the table to suspended members only", async () => {
    const user = userEvent.setup();
    renderMembers({ role: "Super-Admin" });
    await screen.findByText("Tobias Reyes"); // a seeded Suspended member, visible before filtering
    await user.click(screen.getByRole("button", { name: /Suspended/ }));
    await waitFor(() => expect(screen.getByText("Tobias Reyes")).toBeInTheDocument());
    expect(screen.queryByText("Amara Okafor")).not.toBeInTheDocument(); // an Active member, filtered out
  });

  it("suspending a member requires a written reason before Confirm is enabled", async () => {
    const user = userEvent.setup();
    renderMembers({ role: "Super-Admin" });
    await screen.findByText("Marcus Chen");
    const row = screen.getByText("Marcus Chen").closest("tr");
    await user.click(within(row).getByRole("button", { name: /Row actions/i }));
    await user.click(within(row).getByRole("menuitem", { name: "Suspend" }));

    const dialog = screen.getByRole("dialog", { name: /Suspend Marcus Chen/i });
    const confirmButton = within(dialog).getByRole("button", { name: "Confirm" });
    expect(confirmButton).toBeDisabled();
    await user.type(within(dialog).getByLabelText("Reason"), "Policy violation under review.");
    expect(confirmButton).not.toBeDisabled();
  });

  describe("Invite Member wizard", () => {
    it("completes the full email invitation flow end-to-end", async () => {
      const user = userEvent.setup();
      const { store } = renderMembers({ role: "Admin" });
      await user.click(await screen.findByRole("button", { name: /Invite Member/i }));

      const dialog = screen.getByRole("dialog", { name: "Invite Member" });
      await user.click(within(dialog).getByText("Invite by Email"));

      await user.type(within(dialog).getByLabelText("Email address"), "brand.new.person@caspira.example");
      await waitFor(() => expect(within(dialog).getByRole("button", { name: "Continue" })).not.toBeDisabled(), { timeout: 5000 });
      await user.click(within(dialog).getByRole("button", { name: "Continue" }));

      // Each step's Continue enables asynchronously (validation); on slower CI
      // machines a click before that is ignored, so wait for it every time.
      const continueWhenEnabled = async () => {
        await waitFor(() => expect(within(dialog).getByRole("button", { name: "Continue" })).not.toBeDisabled(), { timeout: 5000 });
        await user.click(within(dialog).getByRole("button", { name: "Continue" }));
      };
      await user.selectOptions(await within(dialog).findByLabelText("Role"), "standard_employee");
      await continueWhenEnabled(); // Organization & Access -> Review
      await continueWhenEnabled(); // Review -> Email Preview

      expect(await within(dialog).findByText(/No email will be sent during this frontend phase/, {}, { timeout: 5000 })).toBeInTheDocument();
      await user.click(within(dialog).getByRole("button", { name: "Generate Email Invitation Preview" }));

      await within(dialog).findByText(/Invitation preview generated/);
      await user.click(within(dialog).getByRole("button", { name: "Done" }));

      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Invite Member" })).not.toBeInTheDocument());
      expect(store.getState().accessManagement.invitations.some((i) => i.email === "brand.new.person@caspira.example")).toBe(true);
    }, 15000);

    it("Organization Administrator does not see System Owner or Organization Administrator as assignable roles", async () => {
      const user = userEvent.setup();
      renderMembers({ role: "Admin" });
      await user.click(await screen.findByRole("button", { name: /Invite Member/i }));
      const dialog = screen.getByRole("dialog", { name: "Invite Member" });
      await user.click(within(dialog).getByText("Invite by Email"));
      await user.type(within(dialog).getByLabelText("Email address"), "candidate@caspira.example");
      await waitFor(() => expect(within(dialog).getByRole("button", { name: "Continue" })).not.toBeDisabled(), { timeout: 5000 });
      await user.click(within(dialog).getByRole("button", { name: "Continue" }));

      const roleOptions = within(within(dialog).getByLabelText("Role")).getAllByRole("option").map((o) => o.textContent);
      expect(roleOptions).not.toContain("System Owner");
      expect(roleOptions).not.toContain("Organization Administrator");
      expect(roleOptions).not.toContain("Finance Manager");
      expect(roleOptions).toContain("Standard Employee");
    }, 15000);

    it("blocks proceeding when the email already belongs to an active member", async () => {
      const user = userEvent.setup();
      renderMembers({ role: "Admin" });
      await user.click(await screen.findByRole("button", { name: /Invite Member/i }));
      const dialog = screen.getByRole("dialog", { name: "Invite Member" });
      await user.click(within(dialog).getByText("Invite by Email"));
      await user.type(within(dialog).getByLabelText("Email address"), "amara.okafor@caspira.example");
      await within(dialog).findByText(/already belongs to an active member/i, {}, { timeout: 5000 });
      expect(within(dialog).getByRole("button", { name: "Continue" })).toBeDisabled();
    }, 15000);

    it("selecting Create Organization Invite Link redirects to the Invite Links page", async () => {
      const user = userEvent.setup();
      renderMembers({ role: "Super-Admin" });
      await user.click(await screen.findByRole("button", { name: /Invite Member/i }));
      const dialog = screen.getByRole("dialog", { name: "Invite Member" });
      await user.click(within(dialog).getByText("Create Organization Invite Link"));
      expect(await screen.findByText("Invite Links Page")).toBeInTheDocument();
    });
  });
});

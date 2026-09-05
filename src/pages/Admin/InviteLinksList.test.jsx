import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import ErrorBoundary from "../../components/ErrorBoundary";
import InviteLinksList from "./InviteLinksList";
import authReducer from "../../redux/authSlice";
import accessManagementReducer from "../../redux/admin/accessManagementSlice";

function renderInviteLinks({ role = "Super-Admin" } = {}) {
  localStorage.setItem("role", role);
  localStorage.setItem("isLoggedIn", "true");
  const store = configureStore({
    reducer: { auth: authReducer, accessManagement: accessManagementReducer },
    preloadedState: { auth: { role, isLoggedIn: true, data: {} } },
  });
  const utils = render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/admin/invite-links"]}>
        <ErrorBoundary>
          <Routes>
            <Route path="/admin/invite-links" element={<InviteLinksList />} />
          </Routes>
        </ErrorBoundary>
      </MemoryRouter>
    </Provider>
  );
  return { store, ...utils };
}

describe("InviteLinksList", () => {
  beforeEach(() => localStorage.clear());

  it("renders the Users & Access breadcrumb and title", async () => {
    renderInviteLinks();
    expect(await screen.findByText("Users & Access")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Invite Links" })).toBeInTheDocument();
  });

  it("System Owner sees the Organization column and links from every organization", async () => {
    renderInviteLinks({ role: "Super-Admin" });
    expect(await screen.findByText("Nimbus sales onboarding")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Organization" })).toBeInTheDocument();
  });

  it("Organization Administrator only sees their own organization's links, no Organization column", async () => {
    renderInviteLinks({ role: "Admin" });
    await screen.findByText("Sales onboarding");
    expect(screen.queryByText("Nimbus sales onboarding")).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Organization" })).not.toBeInTheDocument();
  });

  it("shows compact metrics", async () => {
    renderInviteLinks();
    expect(await screen.findByText("Active Links")).toBeInTheDocument();
    expect(screen.getByText("Expiring Soon")).toBeInTheDocument();
    expect(screen.getByText("Total Uses")).toBeInTheDocument();
    expect(screen.getByText("Domain Restricted")).toBeInTheDocument();
  });

  it("shows the Create Invite Link button for privileged roles", async () => {
    renderInviteLinks({ role: "Admin" });
    expect(await screen.findByRole("button", { name: /Create Invite Link/i })).toBeInTheDocument();
  });

  it("only offers link-safe roles when creating a link (never high-privilege)", async () => {
    const user = userEvent.setup();
    renderInviteLinks({ role: "Super-Admin" });
    await user.click(await screen.findByRole("button", { name: /Create Invite Link/i }));
    const dialog = screen.getByRole("dialog", { name: "Create Invite Link" });
    const roleOptions = within(dialog).getByLabelText("Default role");
    const optionLabels = within(roleOptions).getAllByRole("option").map((o) => o.textContent);
    expect(optionLabels).toContain("Standard Employee");
    expect(optionLabels).not.toContain("System Owner");
    expect(optionLabels).not.toContain("Organization Administrator");
    expect(optionLabels).not.toContain("Finance Manager");
  });

  it("warns when approval is disabled or domains are unrestricted", async () => {
    const user = userEvent.setup();
    renderInviteLinks({ role: "Super-Admin" });
    await user.click(await screen.findByRole("button", { name: /Create Invite Link/i }));
    const dialog = screen.getByRole("dialog", { name: "Create Invite Link" });
    expect(within(dialog).getByText(/increases the risk of unintended sign-ups/i)).toBeInTheDocument();
  });

  it("creates an invite link end-to-end for Organization Administrator", async () => {
    const user = userEvent.setup();
    const { store } = renderInviteLinks({ role: "Admin" });
    await user.click(await screen.findByRole("button", { name: /Create Invite Link/i }));
    const dialog = screen.getByRole("dialog", { name: "Create Invite Link" });

    await user.type(within(dialog).getByLabelText("Link name"), "Marketing interns onboarding");
    await user.selectOptions(within(dialog).getByLabelText("Default role"), "marketing_specialist");
    await user.type(within(dialog).getByLabelText(/Allowed email domains/i), "caspira.example");

    await user.click(within(dialog).getByRole("button", { name: "Create Invite Link" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Create Invite Link" })).not.toBeInTheDocument(), { timeout: 5000 });
    expect(store.getState().accessManagement.inviteLinks.some((l) => l.name === "Marketing interns onboarding")).toBe(true);
  }, 15000);

  it("opens the usage details popover", async () => {
    const user = userEvent.setup();
    renderInviteLinks({ role: "Super-Admin" });
    await user.click(await screen.findByText("6/25"));
    const dialog = screen.getByRole("dialog", { name: /Usage for Sales onboarding/i });
    expect(within(dialog).getByText(/6 of 25/)).toBeInTheDocument();
  });

  it("revoking a link requires a written reason", async () => {
    const user = userEvent.setup();
    renderInviteLinks({ role: "Super-Admin" });
    await screen.findByText("Sales onboarding");
    const row = screen.getByText("Sales onboarding").closest("tr");
    await user.click(within(row).getByRole("button", { name: /Row actions/i }));
    await user.click(within(row).getByRole("menuitem", { name: "Revoke" }));

    const dialog = screen.getByRole("dialog", { name: /Revoke Sales onboarding/i });
    const revokeButton = within(dialog).getByRole("button", { name: "Revoke" });
    expect(revokeButton).toBeDisabled();
    await user.type(within(dialog).getByLabelText("Reason"), "Onboarding program restructured.");
    expect(revokeButton).not.toBeDisabled();
  });

  it("rotating a link resets its usage count", async () => {
    const user = userEvent.setup();
    const { store } = renderInviteLinks({ role: "Super-Admin" });
    await screen.findByText("Sales onboarding");
    const row = screen.getByText("Sales onboarding").closest("tr");
    await user.click(within(row).getByRole("button", { name: /Row actions/i }));
    await user.click(within(row).getByRole("menuitem", { name: "Rotate" }));

    await waitFor(() => {
      const updated = store.getState().accessManagement.inviteLinks.find((l) => l.id === "link_1");
      expect(updated.currentUses).toBe(0);
    }, { timeout: 5000 });
  }, 15000);
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../../../Helpers/crmBackendCommon", () => ({ orgId: () => "org1" }));
vi.mock("react-hot-toast", () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../../../Helpers/backendAuthClient", () => ({
  listMembers: vi.fn(),
  listOrgRoles: vi.fn(),
  updateMember: vi.fn(async () => ({})),
  removeMember: vi.fn(async () => ({})),
  assignMemberRole: vi.fn(async () => ({})),
  revokeMemberRole: vi.fn(async () => ({})),
  listInvitations: vi.fn(),
  createInvitation: vi.fn(),
  resendInvitation: vi.fn(),
  revokeInvitation: vi.fn(),
  validateInvitationToken: vi.fn(),
  acceptInvitation: vi.fn(),
  validateJoinToken: vi.fn(),
  acceptJoinToken: vi.fn(),
}));

const api = await import("../../../Helpers/backendAuthClient");
const { default: MembersBackend } = await import("./MembersBackend");
const { default: InvitationsBackend } = await import("./InvitationsBackend");
const { default: AcceptBackend } = await import("../../Invite/AcceptBackend");

const ROLES = [{ _id: "rSales", name: "Sales Rep" }, { _id: "rSupport", name: "Support Agent" }];
const MEMBERS = [
  { _id: "m1", status: "Active", user: { _id: "u1", name: "Me Admin", email: "me@acme.com" }, roles: [] },
  { _id: "m2", status: "Active", user: { _id: "u2", name: "Sam Seller", email: "sam@acme.com" }, roles: [ROLES[0]] },
  { _id: "m3", status: "Invited", user: { _id: "u3", name: "New Joiner", email: "new@acme.com" }, roles: [ROLES[1]] },
];

const store = () => configureStore({ reducer: { auth: () => ({ data: { _id: "u1" } }) } });
const at = (path, pattern, element) => render(
  <Provider store={store()}><MemoryRouter initialEntries={[path]}><Routes><Route path={pattern} element={element} /></Routes></MemoryRouter></Provider>
);

beforeEach(() => {
  vi.clearAllMocks();
  api.listMembers.mockResolvedValue({ members: MEMBERS, pagination: { total: MEMBERS.length } });
  api.listOrgRoles.mockResolvedValue({ roles: ROLES });
});

describe("Members (live)", () => {
  it("lists real members, approves a waiting one, and never offers to remove yourself", async () => {
    const user = userEvent.setup();
    at("/admin/users", "/admin/users", <MembersBackend />);
    expect(await screen.findByText("Sam Seller")).toBeInTheDocument();
    expect(screen.getByText("Waiting for approval", { selector: "span" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Remove" })).toHaveLength(2); // not for "you"
    await user.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(api.updateMember).toHaveBeenCalledWith("org1", "m3", "Active"));
  });

  it("changes roles by assigning and revoking only the differences", async () => {
    const user = userEvent.setup();
    at("/admin/users", "/admin/users", <MembersBackend />);
    await screen.findByText("Sam Seller");
    await user.click(screen.getAllByRole("button", { name: "Roles" })[1]);
    await user.click(screen.getByLabelText("Sales Rep"));
    await user.click(screen.getByLabelText("Support Agent"));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.assignMemberRole).toHaveBeenCalledWith("org1", "m2", "rSupport"));
    expect(api.revokeMemberRole).toHaveBeenCalledWith("org1", "m2", "rSales");
  });
});

describe("Invitations (live)", () => {
  it("creates an invitation and shows the accept link once to copy", async () => {
    const user = userEvent.setup();
    api.listInvitations.mockResolvedValue({ invitations: [] });
    api.createInvitation.mockResolvedValue({ invitation: { email: "pat@acme.com" }, acceptUrl: "https://crm.example/invitations/tok123/accept" });
    at("/admin/invitations", "/admin/invitations", <InvitationsBackend />);
    await user.click(await screen.findByRole("button", { name: "Invite someone" }));
    await user.type(screen.getByLabelText(/Email/), "pat@acme.com");
    await user.click(screen.getByRole("button", { name: "Create invitation" }));
    await waitFor(() => expect(api.createInvitation).toHaveBeenCalledWith("org1", expect.objectContaining({ email: "pat@acme.com", roleId: "rSales" })));
    expect(await screen.findByDisplayValue("https://crm.example/invitations/tok123/accept")).toBeInTheDocument();
    expect(screen.getByText(/isn't shown again/)).toBeInTheDocument();
  });
});

describe("Accepting an invitation (live)", () => {
  it("creates the account and tells the person to sign in", async () => {
    const user = userEvent.setup();
    api.validateInvitationToken.mockResolvedValue({ organizationName: "Acme", roleName: "Sales Rep", email: "pat@acme.com" });
    api.acceptInvitation.mockResolvedValue({ message: "Invitation accepted." });
    at("/invitations/tok123/accept", "/invitations/:token/accept", <AcceptBackend kind="invitation" />);
    expect(await screen.findByText("Join Acme")).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Your name/), "Pat Lee");
    await user.type(screen.getByLabelText(/^Password/), "Harbour2026x");
    await user.type(screen.getByLabelText(/Repeat password/), "Harbour2026x");
    await user.click(screen.getByRole("button", { name: /Create account/ }));
    await waitFor(() => expect(api.acceptInvitation).toHaveBeenCalledWith("tok123", { name: "Pat Lee", password: "Harbour2026x" }));
    expect(await screen.findByText("Welcome to Acme")).toBeInTheDocument();
  });

  it("shows a clear message for a used or expired link", async () => {
    api.validateJoinToken.mockRejectedValue(new Error("404"));
    at("/join/bad", "/join/:token", <AcceptBackend kind="join" />);
    expect(await screen.findByText("This link doesn't work")).toBeInTheDocument();
  });
});

describe("default role for new people", () => {
  it("is the ordinary employee role when it exists, otherwise the first role", async () => {
    const { defaultRoleId } = await import("./accessKit");
    expect(defaultRoleId([{ _id: "rAi", key: "ai_governance_admin" }, { _id: "rUser", key: "user" }])).toBe("rUser");
    expect(defaultRoleId([{ _id: "rOnly", key: "team_leader" }])).toBe("rOnly");
    expect(defaultRoleId([])).toBe("");
  });
});

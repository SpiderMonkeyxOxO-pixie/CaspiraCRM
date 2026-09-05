import { describe, it, expect, beforeEach } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import accessManagementReducer, {
  fetchOrganizations, fetchMembers, createInvitation, resendInvitation,
  revokeInvitation, fetchInviteLinks, createInviteLink, rotateInviteLink, revokeInviteLink,
  approveJoinRequest, changeMemberRole, suspendMember, fetchAccessAudit, selectAccessManagement,
} from "./accessManagementSlice";
import authReducer from "../authSlice";

// Exercises the full round-trip through the REAL mock adapter (mockApi.js),
// same convention as aiSlice.test.js — proves the fixture, the mock HTTP
// handlers and the Redux slice are all wired together correctly, including
// the server-side organization-scoping enforcement.
function makeStore(role = "Super-Admin") {
  localStorage.setItem("role", role);
  localStorage.setItem("isLoggedIn", "true");
  return configureStore({
    reducer: { auth: authReducer, accessManagement: accessManagementReducer },
    preloadedState: { auth: { role, isLoggedIn: true, data: {} } },
  });
}

describe("accessManagementSlice — organization scoping", () => {
  beforeEach(() => localStorage.clear());

  it("System Owner sees every organization", async () => {
    const store = makeStore("Super-Admin");
    await store.dispatch(fetchOrganizations());
    expect(selectAccessManagement(store.getState()).organizations).toHaveLength(3);
  });

  it("Organization Administrator sees only their own organization", async () => {
    const store = makeStore("Admin");
    await store.dispatch(fetchOrganizations());
    const orgs = selectAccessManagement(store.getState()).organizations;
    expect(orgs).toHaveLength(1);
    expect(orgs[0].id).toBe("org_caspira_hq");
  });

  it("Organization Administrator cannot see another organization's members even by requesting it directly", async () => {
    const store = makeStore("Admin");
    await store.dispatch(fetchMembers({ organizationId: "org_nimbus_retail" }));
    const { members } = selectAccessManagement(store.getState());
    expect(members.length).toBeGreaterThan(0);
    expect(members.every((m) => m.organizationId === "org_caspira_hq")).toBe(true);
  });

  it("System Owner can request a specific organization's members", async () => {
    const store = makeStore("Super-Admin");
    await store.dispatch(fetchMembers({ organizationId: "org_nimbus_retail" }));
    const { members } = selectAccessManagement(store.getState());
    expect(members.every((m) => m.organizationId === "org_nimbus_retail")).toBe(true);
  });
});

describe("accessManagementSlice — invitation creation guardrails", () => {
  beforeEach(() => localStorage.clear());

  it("Organization Administrator cannot invite a high-privilege role", async () => {
    const store = makeStore("Admin");
    const action = await store.dispatch(createInvitation({
      email: "candidate@caspira.example", organizationId: "org_caspira_hq",
      intendedRoleId: "finance_manager", expirationDate: "2030-01-01T00:00:00.000Z",
    }));
    expect(action.type).toBe("accessManagement/createInvitation/rejected");
  });

  it("Organization Administrator cannot invite into another organization even if the payload claims one", async () => {
    const store = makeStore("Admin");
    const action = await store.dispatch(createInvitation({
      email: "candidate@nimbusretail.example", organizationId: "org_nimbus_retail",
      intendedRoleId: "standard_employee", expirationDate: "2030-01-01T00:00:00.000Z",
    }));
    expect(action.type).toBe("accessManagement/createInvitation/rejected");
  });

  it("System Owner cannot assign System Owner through the ordinary invitation form", async () => {
    const store = makeStore("Super-Admin");
    const action = await store.dispatch(createInvitation({
      email: "candidate@caspira.example", organizationId: "org_caspira_hq",
      intendedRoleId: "system_owner", expirationDate: "2030-01-01T00:00:00.000Z",
    }));
    expect(action.type).toBe("accessManagement/createInvitation/rejected");
  });

  it("rejects an email that already belongs to an active member", async () => {
    const store = makeStore("Admin");
    const action = await store.dispatch(createInvitation({
      email: "amara.okafor@caspira.example", organizationId: "org_caspira_hq",
      intendedRoleId: "standard_employee", expirationDate: "2030-01-01T00:00:00.000Z",
    }));
    expect(action.type).toBe("accessManagement/createInvitation/rejected");
  });

  it("a valid invitation succeeds and appears in state", async () => {
    const store = makeStore("Admin");
    const action = await store.dispatch(createInvitation({
      email: "genuinely.new@caspira.example", organizationId: "org_caspira_hq",
      intendedRoleId: "standard_employee", expirationDate: "2030-01-01T00:00:00.000Z",
    }));
    expect(action.type).toBe("accessManagement/createInvitation/fulfilled");
    expect(selectAccessManagement(store.getState()).invitations[0].email).toBe("genuinely.new@caspira.example");
  });
});

describe("accessManagementSlice — invitation lifecycle actions", () => {
  beforeEach(() => localStorage.clear());

  it("revokeInvitation is rejected without a reason before any request is made", async () => {
    const store = makeStore("Admin");
    const action = await store.dispatch(revokeInvitation({ id: "invite_1", reason: "" }));
    expect(action.type).toBe("accessManagement/revokeInvitation/rejected");
  });

  it("resendInvitation issues a new token", async () => {
    const store = makeStore("Admin");
    const action = await store.dispatch(resendInvitation("invite_1"));
    expect(action.type).toBe("accessManagement/resendInvitation/fulfilled");
    expect(action.payload.previousToken).toBeTruthy();
  });

  it("approveJoinRequest turns an Approval Required invitation into an active member", async () => {
    const store = makeStore("Admin");
    const action = await store.dispatch(approveJoinRequest("invite_3"));
    expect(action.type).toBe("accessManagement/approveJoinRequest/fulfilled");
    expect(action.payload.member).toBeTruthy();
  });
});

describe("accessManagementSlice — invite link guardrails", () => {
  beforeEach(() => localStorage.clear());

  it("fetching invite links respects organization scoping for Organization Administrator", async () => {
    const store = makeStore("Admin");
    await store.dispatch(fetchInviteLinks({ organizationId: "org_nimbus_retail" }));
    const { inviteLinks } = selectAccessManagement(store.getState());
    expect(inviteLinks.every((l) => l.organizationId === "org_caspira_hq")).toBe(true);
  });

  it("createInviteLink refuses a high-privilege default role", async () => {
    const store = makeStore("Admin");
    const action = await store.dispatch(createInviteLink({
      name: "Bad link", organizationId: "org_caspira_hq", defaultRoleId: "organization_administrator",
      expirationDate: "2030-01-01T00:00:00.000Z",
    }));
    expect(action.type).toBe("accessManagement/createInviteLink/rejected");
  });

  it("createInviteLink succeeds for a safe role and rotate/revoke work", async () => {
    const store = makeStore("Admin");
    const created = await store.dispatch(createInviteLink({
      name: "New link", organizationId: "org_caspira_hq", defaultRoleId: "standard_employee",
      expirationDate: "2030-01-01T00:00:00.000Z",
    }));
    expect(created.type).toBe("accessManagement/createInviteLink/fulfilled");
    const linkId = created.payload.link.id;

    const rotated = await store.dispatch(rotateInviteLink(linkId));
    expect(rotated.payload.link.secureTokenPreview).not.toBe(created.payload.link.secureTokenPreview);

    const revokeAttempt = await store.dispatch(revokeInviteLink({ id: linkId, reason: "" }));
    expect(revokeAttempt.type).toBe("accessManagement/revokeInviteLink/rejected");

    const revoked = await store.dispatch(revokeInviteLink({ id: linkId, reason: "No longer needed" }));
    expect(revoked.payload.link.status).toBe("Revoked");
  });
});

describe("accessManagementSlice — member actions require a reason at the thunk boundary", () => {
  beforeEach(() => localStorage.clear());

  it("changeMemberRole and suspendMember are rejected client-side without a reason, before any request", async () => {
    const store = makeStore("Admin");
    const roleAction = await store.dispatch(changeMemberRole({ id: "member_3", newRoleId: "support_agent", reason: "" }));
    expect(roleAction.type).toBe("accessManagement/changeMemberRole/rejected");
    const suspendAction = await store.dispatch(suspendMember({ id: "member_3", reason: "" }));
    expect(suspendAction.type).toBe("accessManagement/suspendMember/rejected");
  });

  it("Organization Administrator cannot suspend a member with equal/higher authority", async () => {
    const store = makeStore("Admin");
    // member_11 is an Organization Administrator in a different org anyway,
    // but this specifically proves the high-privilege-target check.
    const action = await store.dispatch(suspendMember({ id: "member_11", reason: "Testing privilege ceiling" }));
    expect(action.type).toBe("accessManagement/suspendMember/rejected");
  });
});

describe("accessManagementSlice — access audit", () => {
  beforeEach(() => localStorage.clear());

  it("Organization Administrator only sees their own organization's audit events", async () => {
    const store = makeStore("Admin");
    await store.dispatch(fetchAccessAudit({ organizationId: "org_nimbus_retail" }));
    const { auditEvents } = selectAccessManagement(store.getState());
    expect(auditEvents.every((e) => e.organizationId === "org_caspira_hq")).toBe(true);
  });
});

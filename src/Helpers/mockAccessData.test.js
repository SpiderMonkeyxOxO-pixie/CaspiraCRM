import { describe, it, expect } from "vitest";
import {
  ORGANIZATIONS, DEFAULT_ORGANIZATION_ID, TEAMS, MEMBERS, INVITATIONS, INVITE_LINKS,
  HIGH_PRIVILEGE_ROLE_IDS, LINK_SAFE_ROLE_IDS, isHighPrivilegeRoleId, isRoleAssignableViaLink,
  queryMembersLocal, queryInvitationsLocal, queryInviteLinksLocal, queryAccessAuditLocal,
  validateInvitationRecipient, createInvitation, resendInvitation, revokeInvitation,
  createInviteLink, rotateInviteLink, revokeInviteLink, approveJoinRequest,
  findInvitationByToken, findInviteLinkByToken, acceptEmailInvitationPreview, acceptInviteLinkPreview,
  changeMemberRole, suspendMember, reactivateMember, removeMember,
  computeMemberMetrics, computeInvitationMetrics, computeInviteLinkMetrics, findMember,
} from "./mockAccessData";

describe("mockAccessData: fixtures", () => {
  it("has three seeded organizations with a default", () => {
    expect(ORGANIZATIONS.length).toBeGreaterThanOrEqual(3);
    expect(ORGANIZATIONS.some((o) => o.id === DEFAULT_ORGANIZATION_ID)).toBe(true);
  });

  it("every team belongs to a real organization", () => {
    const orgIds = new Set(ORGANIZATIONS.map((o) => o.id));
    for (const team of TEAMS) expect(orgIds.has(team.organizationId)).toBe(true);
  });

  it("no seeded invite link assigns a high-privilege role", () => {
    for (const link of INVITE_LINKS) expect(isHighPrivilegeRoleId(link.defaultRoleId)).toBe(false);
  });

  it("high-privilege and link-safe role lists don't overlap", () => {
    for (const id of LINK_SAFE_ROLE_IDS) expect(HIGH_PRIVILEGE_ROLE_IDS).not.toContain(id);
  });

  it("isRoleAssignableViaLink matches the safe-role list exactly", () => {
    expect(isRoleAssignableViaLink("standard_employee")).toBe(true);
    expect(isRoleAssignableViaLink("organization_administrator")).toBe(false);
  });
});

describe("mockAccessData: query helpers", () => {
  it("queryMembersLocal filters by organization", () => {
    const results = queryMembersLocal({ organizationId: "org_nimbus_retail" });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((m) => m.organizationId === "org_nimbus_retail")).toBe(true);
  });

  it("queryInvitationsLocal filters by status", () => {
    const results = queryInvitationsLocal({ status: "Revoked" });
    expect(results.every((i) => i.status === "Revoked")).toBe(true);
  });

  it("queryInviteLinksLocal filters by organization", () => {
    const results = queryInviteLinksLocal({ organizationId: "org_caspira_hq" });
    expect(results.every((l) => l.organizationId === "org_caspira_hq")).toBe(true);
  });

  it("queryAccessAuditLocal returns events newest first", () => {
    const events = queryAccessAuditLocal({ organizationId: "org_caspira_hq" });
    for (let i = 1; i < events.length; i++) {
      expect(new Date(events[i - 1].occurredAt).getTime()).toBeGreaterThanOrEqual(new Date(events[i].occurredAt).getTime());
    }
  });
});

describe("mockAccessData: invitation recipient validation", () => {
  it("rejects an email that already belongs to an active member", () => {
    const result = validateInvitationRecipient("amara.okafor@caspira.example", "org_caspira_hq");
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("already_member");
  });

  it("rejects an email with an existing pending invitation", () => {
    const result = validateInvitationRecipient("new.hire@caspira.example", "org_caspira_hq");
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("pending_invitation");
  });

  it("warns, but allows, an email whose only prior invitation was revoked", () => {
    const result = validateInvitationRecipient("revoked.person@caspira.example", "org_caspira_hq");
    expect(result.valid).toBe(true);
    expect(result.warning).toBe("previously_revoked");
  });

  it("allows a genuinely new email", () => {
    const result = validateInvitationRecipient("brand.new.person@caspira.example", "org_caspira_hq");
    expect(result.valid).toBe(true);
    expect(result.warning).toBeUndefined();
  });
});

describe("mockAccessData: invitation lifecycle", () => {
  it("createInvitation adds it to INVITATIONS and records two audit events", () => {
    const before = INVITATIONS.length;
    const invitation = createInvitation({
      email: "lifecycle.test@caspira.example", organizationId: "org_caspira_hq",
      intendedRoleId: "standard_employee", invitedBy: "member_2", invitedByName: "Priya Nair",
      expirationDate: "2026-12-01T00:00:00.000Z",
    });
    expect(INVITATIONS.length).toBe(before + 1);
    expect(invitation.status).toBe("Pending");
    expect(invitation.frontendToken).toBeTruthy();
    const recentEvents = queryAccessAuditLocal({ organizationId: "org_caspira_hq" }).slice(0, 2).map((e) => e.event);
    expect(recentEvents).toEqual(expect.arrayContaining(["Email preview generated", "Invitation created"]));
  });

  it("resendInvitation invalidates the previous token and increments resend count", () => {
    const before = findInvitationByToken("preview_tok_inv1");
    const previousToken = before.frontendToken;
    const { invitation, previousToken: returnedPrevious } = resendInvitation("invite_1", "Priya Nair");
    expect(returnedPrevious).toBe(previousToken);
    expect(invitation.frontendToken).not.toBe(previousToken);
    expect(findInvitationByToken(previousToken)).toBeNull();
    expect(invitation.resendCount).toBeGreaterThan(0);
  });

  it("revokeInvitation requires a reason", () => {
    const result = revokeInvitation("invite_9", "", "Priya Nair");
    expect(result.error).toBeTruthy();
  });

  it("revokeInvitation with a reason makes the invitation unusable", () => {
    const { invitation } = revokeInvitation("invite_9", "No longer needed", "Priya Nair");
    expect(invitation.status).toBe("Revoked");
    const acceptance = acceptEmailInvitationPreview(invitation.frontendToken, { name: "X" });
    expect(acceptance.error).toBe("revoked");
  });

  it("acceptEmailInvitationPreview creates a member and updates the invitation, never for an unknown token", () => {
    expect(acceptEmailInvitationPreview("not-a-real-token", {}).error).toBe("invalid_token");
    const memberCountBefore = MEMBERS.length;
    const result = acceptEmailInvitationPreview("preview_tok_inv2", { name: "Opened Preview Person" });
    expect(result.member).toBeTruthy();
    expect(MEMBERS.length).toBe(memberCountBefore + 1);
    expect(findInvitationByToken("preview_tok_inv2").status).toBe("Accepted Preview");
  });

  it("an approval-required invitation moves to Approval Required instead of creating a member immediately", () => {
    const memberCountBefore = MEMBERS.length;
    const result = acceptEmailInvitationPreview("preview_tok_inv3", { name: "X" });
    expect(result.pendingApproval).toBe(true);
    expect(MEMBERS.length).toBe(memberCountBefore);
  });

  it("approveJoinRequest finalizes an Approval Required invitation into a real member", () => {
    acceptEmailInvitationPreview("preview_tok_inv3", { name: "X" });
    const memberCountBefore = MEMBERS.length;
    const result = approveJoinRequest("invite_3", "invitation", "Priya Nair");
    expect(result.member).toBeTruthy();
    expect(MEMBERS.length).toBe(memberCountBefore + 1);
    expect(findInvitationByToken("preview_tok_inv3").status).toBe("Accepted Preview");
  });

  it("approveJoinRequest refuses an invitation that isn't awaiting approval", () => {
    const result = approveJoinRequest("invite_1", "invitation", "Priya Nair");
    expect(result.error).toBeTruthy();
  });
});

describe("mockAccessData: invite link lifecycle", () => {
  it("createInviteLink refuses a high-privilege default role", () => {
    const result = createInviteLink({
      name: "Bad link", organizationId: "org_caspira_hq", defaultRoleId: "organization_administrator",
      expirationDate: "2026-12-01T00:00:00.000Z", createdBy: "member_2",
    });
    expect(result.error).toBeTruthy();
    expect(result.link).toBeUndefined();
  });

  it("createInviteLink succeeds for a safe role", () => {
    const { link } = createInviteLink({
      name: "New link", organizationId: "org_caspira_hq", defaultRoleId: "standard_employee",
      expirationDate: "2026-12-01T00:00:00.000Z", createdBy: "member_2",
    });
    expect(link.status).toBe("Active Preview");
    expect(link.secureTokenPreview).toBeTruthy();
  });

  it("rotateInviteLink invalidates the previous token", () => {
    const before = findInviteLinkByToken("preview_link_nimbus_sales");
    const previousToken = before.secureTokenPreview;
    const { link } = rotateInviteLink("link_5", "Jonah Fields");
    expect(link.secureTokenPreview).not.toBe(previousToken);
    expect(findInviteLinkByToken(previousToken)).toBeNull();
  });

  it("revokeInviteLink requires a reason and makes the link unusable", () => {
    expect(revokeInviteLink("link_1", "", "Priya Nair").error).toBeTruthy();
    const { link } = revokeInviteLink("link_1", "No longer needed", "Priya Nair");
    expect(link.status).toBe("Revoked");
    expect(acceptInviteLinkPreview(link.secureTokenPreview, { name: "X", email: "x@caspira.example" }).error).toBe("revoked");
  });

  it("acceptInviteLinkPreview enforces domain restriction and usage limits", () => {
    expect(acceptInviteLinkPreview("preview_link_support_core", { name: "X", email: "x@notallowed.example" }).error).toBe("domain_not_allowed");
    expect(acceptInviteLinkPreview("preview_link_general", { name: "X", email: "x@caspira.example" }).error).toBe("usage_limit_reached");
    expect(acceptInviteLinkPreview("not-a-real-token", {}).error).toBe("invalid_token");
  });
});

describe("mockAccessData: member lifecycle actions require a written reason", () => {
  it("suspendMember / reactivateMember / removeMember / changeMemberRole all require a reason", () => {
    expect(suspendMember("member_3", "", "Priya Nair").error).toBeTruthy();
    expect(reactivateMember("member_9", "", "Priya Nair").error).toBeTruthy();
    expect(removeMember("member_3", "", "Priya Nair").error).toBeTruthy();
    expect(changeMemberRole("member_3", "support_agent", "", "Priya Nair").error).toBeTruthy();
  });

  it("suspendMember with a reason updates status and records an audit event", () => {
    const { member } = suspendMember("member_4", "Policy violation under review.", "Priya Nair");
    expect(member.status).toBe("Suspended");
    expect(findMember("member_4").status).toBe("Suspended");
  });

  it("reactivateMember restores an active status", () => {
    const { member } = reactivateMember("member_9", "Investigation concluded, cleared.", "Priya Nair");
    expect(member.status).toBe("Active");
  });
});

describe("mockAccessData: compact metrics", () => {
  it("computeMemberMetrics counts active/suspended members", () => {
    const metrics = computeMemberMetrics(queryMembersLocal({ organizationId: "org_solstice_partners" }));
    expect(metrics.active).toBeGreaterThan(0);
  });

  it("computeInvitationMetrics counts revoked invitations", () => {
    const metrics = computeInvitationMetrics(queryInvitationsLocal({ organizationId: "org_caspira_hq" }));
    expect(metrics.revoked).toBeGreaterThan(0);
  });

  it("computeInviteLinkMetrics counts revoked links", () => {
    const metrics = computeInviteLinkMetrics(queryInviteLinksLocal({ organizationId: "org_caspira_hq" }));
    expect(metrics.revoked).toBeGreaterThan(0);
  });
});

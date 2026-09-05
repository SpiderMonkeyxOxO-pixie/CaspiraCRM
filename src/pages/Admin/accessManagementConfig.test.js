import { describe, it, expect } from "vitest";
import {
  isSystemOwner, isOrganizationAdministrator, canInviteMembers, canViewMembers,
  canManageInviteLinks, canViewAccessAudit, hasAnyAccessManagementCapability,
  getAuthorizedOrganizationIds, getInvitableRoleTemplates, requiresHighPrivilegeConfirmation,
  canModifyMember, isRoleAssignableViaLink, isHighPrivilegeRoleId,
} from "./accessManagementConfig";

describe("accessManagementConfig: role identity", () => {
  it("identifies System Owner and Organization Administrator from the real auth role", () => {
    expect(isSystemOwner("Super-Admin")).toBe(true);
    expect(isSystemOwner("Admin")).toBe(false);
    expect(isOrganizationAdministrator("Admin")).toBe(true);
    expect(isOrganizationAdministrator("Super-Admin")).toBe(false);
  });
});

describe("accessManagementConfig: capability gates", () => {
  it("System Owner and Organization Administrator can invite/view members and manage links", () => {
    for (const role of ["Super-Admin", "Admin"]) {
      expect(canViewMembers(role)).toBe(true);
      expect(canInviteMembers(role)).toBe(true);
      expect(canManageInviteLinks(role)).toBe(true);
      expect(canViewAccessAudit(role)).toBe(true);
      expect(hasAnyAccessManagementCapability(role)).toBe(true);
    }
  });

  it("Team-Leader, User and Checker have no Access Management capability by default", () => {
    for (const role of ["Team-Leader", "User", "Checker"]) {
      expect(canViewMembers(role)).toBe(false);
      expect(canInviteMembers(role)).toBe(false);
      expect(canManageInviteLinks(role)).toBe(false);
      expect(canViewAccessAudit(role)).toBe(false);
      expect(hasAnyAccessManagementCapability(role)).toBe(false);
    }
  });

  it("an unrecognized role has no capability", () => {
    expect(hasAnyAccessManagementCapability("Some-Future-Role")).toBe(false);
  });
});

describe("accessManagementConfig: organization scoping", () => {
  it("System Owner is authorized for all organizations (null = no restriction)", () => {
    expect(getAuthorizedOrganizationIds("Super-Admin", null)).toBeNull();
  });

  it("Organization Administrator is fixed to their own member record's organization", () => {
    const member = { organizationId: "org_caspira_hq" };
    expect(getAuthorizedOrganizationIds("Admin", member)).toEqual(["org_caspira_hq"]);
  });

  it("a role with no member record and no System Owner status gets no organizations", () => {
    expect(getAuthorizedOrganizationIds("Admin", null)).toEqual([]);
  });
});

describe("accessManagementConfig: invitable role ceiling", () => {
  it("System Owner may invite any role except System Owner itself", () => {
    const invitable = getInvitableRoleTemplates("Super-Admin").map((r) => r.id);
    expect(invitable).not.toContain("system_owner");
    expect(invitable).toContain("organization_administrator");
    expect(invitable).toContain("standard_employee");
  });

  it("Organization Administrator may never invite System Owner, another Organization Administrator, or any high-privilege role", () => {
    const invitable = getInvitableRoleTemplates("Admin").map((r) => r.id);
    expect(invitable).not.toContain("system_owner");
    expect(invitable).not.toContain("organization_administrator");
    expect(invitable).not.toContain("crm_administrator");
    expect(invitable).not.toContain("finance_manager");
    expect(invitable).not.toContain("hr_manager");
    expect(invitable).not.toContain("auditor_checker");
    expect(invitable).not.toContain("approver");
    expect(invitable).toContain("standard_employee");
    expect(invitable).toContain("sales_representative");
  });

  it("a role with no Access Management capability gets an empty invitable list", () => {
    expect(getInvitableRoleTemplates("User")).toEqual([]);
  });

  it("only System Owner inviting an Organization Administrator requires the high-privilege confirmation", () => {
    expect(requiresHighPrivilegeConfirmation("Super-Admin", "organization_administrator")).toBe(true);
    expect(requiresHighPrivilegeConfirmation("Super-Admin", "standard_employee")).toBe(false);
    expect(requiresHighPrivilegeConfirmation("Admin", "organization_administrator")).toBe(false);
  });
});

describe("accessManagementConfig: modifying members with equal/higher authority", () => {
  it("System Owner can modify anyone", () => {
    expect(canModifyMember("Super-Admin", { roleIds: ["system_owner"] })).toBe(true);
    expect(canModifyMember("Super-Admin", { roleIds: ["organization_administrator"] })).toBe(true);
  });

  it("Organization Administrator cannot modify a System Owner or another Organization Administrator", () => {
    expect(canModifyMember("Admin", { roleIds: ["system_owner"] })).toBe(false);
    expect(canModifyMember("Admin", { roleIds: ["organization_administrator"] })).toBe(false);
  });

  it("Organization Administrator can modify an ordinary member", () => {
    expect(canModifyMember("Admin", { roleIds: ["sales_representative"] })).toBe(true);
  });

  it("a role with no capability at all cannot modify anyone", () => {
    expect(canModifyMember("User", { roleIds: ["standard_employee"] })).toBe(false);
  });
});

describe("accessManagementConfig: link role safety re-exports", () => {
  it("re-exports the same high-privilege / link-safe checks as mockAccessData", () => {
    expect(isRoleAssignableViaLink("standard_employee")).toBe(true);
    expect(isRoleAssignableViaLink("organization_administrator")).toBe(false);
    expect(isHighPrivilegeRoleId("finance_manager")).toBe(true);
    expect(isHighPrivilegeRoleId("standard_employee")).toBe(false);
  });
});

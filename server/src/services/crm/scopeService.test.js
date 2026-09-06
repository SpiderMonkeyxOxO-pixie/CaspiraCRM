import { describe, it, expect } from "vitest";
import { resolveCrmScopeWhere } from "./scopeService.js";

function membershipWith(scope, moduleId = "leads") {
  return { id: "mem-1", roles: [{ role: { defaultScope: scope, permissionGrants: [{ moduleId, actions: ["view"] }] } }] };
}

describe("resolveCrmScopeWhere", () => {
  it("System Owner override gets no extra narrowing", () => {
    expect(resolveCrmScopeWhere({ isSystemOwnerOverride: true }, "leads")).toEqual({});
  });

  it("Organization-scoped role sees everything in the org (no owner filter)", () => {
    const ctx = { user: {}, membership: membershipWith("Organization"), isSystemOwnerOverride: false };
    expect(resolveCrmScopeWhere(ctx, "leads")).toEqual({});
  });

  it("Own-scoped role is restricted to records it owns", () => {
    const ctx = { user: {}, membership: membershipWith("Own"), isSystemOwnerOverride: false };
    expect(resolveCrmScopeWhere(ctx, "leads")).toEqual({ ownerMembershipId: "mem-1" });
  });

  it("Department-scoped role filters by the user's own department string", () => {
    const ctx = { user: { department: "Sales" }, membership: membershipWith("Department"), isSystemOwnerOverride: false };
    expect(resolveCrmScopeWhere(ctx, "leads")).toEqual({ department: "Sales" });
  });

  it("Department-scoped role with no department falls back to Own (most restrictive), never Organization-wide", () => {
    const ctx = { user: {}, membership: membershipWith("Department"), isSystemOwnerOverride: false };
    expect(resolveCrmScopeWhere(ctx, "leads")).toEqual({ ownerMembershipId: "mem-1" });
  });

  it("Assigned-scoped role with an assignedField sees owned OR assigned records", () => {
    const ctx = { user: {}, membership: membershipWith("Assigned"), isSystemOwnerOverride: false };
    expect(resolveCrmScopeWhere(ctx, "activities", { assignedField: "assignedMembershipId" })).toEqual({
      OR: [{ ownerMembershipId: "mem-1" }, { assignedMembershipId: "mem-1" }],
    });
  });

  it("takes the broadest scope across multiple granted roles for the module, never the narrowest", () => {
    const membership = {
      id: "mem-1",
      roles: [
        { role: { defaultScope: "Own", permissionGrants: [{ moduleId: "leads", actions: ["view"] }] } },
        { role: { defaultScope: "Organization", permissionGrants: [{ moduleId: "leads", actions: ["view"] }] } },
      ],
    };
    expect(resolveCrmScopeWhere({ user: {}, membership, isSystemOwnerOverride: false }, "leads")).toEqual({});
  });
});

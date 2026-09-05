import { describe, it, expect } from "vitest";
import { ROLE_LABELS, getRoleLabel, ROLE_TO_TEMPLATE_ID, getDefaultTemplateIdForRole } from "./roleLabels";

describe("roleLabels", () => {
  it("displays System Owner for the Super-Admin identifier", () => {
    expect(getRoleLabel("Super-Admin")).toBe("System Owner");
  });

  it("preserves the internal Super-Admin identifier as the map key", () => {
    // Regression guard: the rename must never touch the identifier itself —
    // RequireAuth, mockApi and localStorage all still compare against this
    // exact string.
    expect(Object.keys(ROLE_LABELS)).toContain("Super-Admin");
    expect(ROLE_LABELS["Super-Admin"]).not.toBe("Super-Admin");
    expect(ROLE_LABELS["Super-Admin"]).not.toMatch(/super/i);
  });

  it("maps Admin to Organization Administrator", () => {
    expect(getRoleLabel("Admin")).toBe("Organization Administrator");
  });

  it("maps Checker to Auditor / Checker", () => {
    expect(getRoleLabel("Checker")).toBe("Auditor / Checker");
  });

  it("maps Team-Leader and User to sensible labels", () => {
    expect(getRoleLabel("Team-Leader")).toBe("Department Manager");
    expect(getRoleLabel("User")).toBe("Standard Employee");
  });

  it("falls back to the raw value for an unknown role", () => {
    expect(getRoleLabel("Not-A-Role")).toBe("Not-A-Role");
  });

  it("covers exactly the five real roles", () => {
    expect(Object.keys(ROLE_LABELS).sort()).toEqual(
      ["Admin", "Checker", "Super-Admin", "Team-Leader", "User"].sort()
    );
  });

  it("maps every real role to a role-template id", () => {
    expect(getDefaultTemplateIdForRole("Super-Admin")).toBe("system_owner");
    expect(getDefaultTemplateIdForRole("Admin")).toBe("organization_administrator");
    expect(getDefaultTemplateIdForRole("Checker")).toBe("auditor_checker");
    expect(getDefaultTemplateIdForRole("Team-Leader")).toBe("department_manager");
    expect(getDefaultTemplateIdForRole("User")).toBe("standard_employee");
    expect(Object.keys(ROLE_TO_TEMPLATE_ID).sort()).toEqual(Object.keys(ROLE_LABELS).sort());
  });

  it("returns null for an unknown role's template id", () => {
    expect(getDefaultTemplateIdForRole("Not-A-Role")).toBeNull();
  });
});

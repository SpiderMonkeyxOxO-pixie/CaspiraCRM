import { describe, it, expect } from "vitest";
import { getHomePathForRole, ROLE_HOME_PATH } from "./roleRoutes";

describe("getHomePathForRole", () => {
  it("maps every known role to its dashboard route", () => {
    expect(getHomePathForRole("Super-Admin")).toBe("/crm/dashboard");
    expect(getHomePathForRole("Admin")).toBe("/crm/dashboard");
    expect(getHomePathForRole("Team-Leader")).toBe("/crm/dashboard");
    expect(getHomePathForRole("Checker")).toBe("/finance/dashboard");
    expect(getHomePathForRole("User")).toBe("/crm/dashboard");
  });

  it("returns null for an unknown or missing role instead of a wrong default", () => {
    // Regression test: Login.jsx used to hardcode `/dashboard` here, which
    // sent every non-Super-Admin role straight to Access Denied.
    expect(getHomePathForRole("Not-A-Role")).toBeNull();
    expect(getHomePathForRole(undefined)).toBeNull();
    expect(getHomePathForRole("")).toBeNull();
  });

  it("covers exactly the five roles the app routes for", () => {
    expect(Object.keys(ROLE_HOME_PATH).sort()).toEqual(
      ["Admin", "Checker", "Super-Admin", "Team-Leader", "User"].sort()
    );
  });
});

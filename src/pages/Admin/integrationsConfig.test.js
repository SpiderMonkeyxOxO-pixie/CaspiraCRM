import { describe, it, expect } from "vitest";
import {
  isSystemOwner, isOrganizationAdministrator, canViewIntegrations, canViewMarketplace,
  canCreateConnections, canUpdateConnections, canPauseConnections, canDisconnectConnections,
  canManageCapabilities, canViewMappings, canManageMappings, canViewSync, canRunSync,
  canRetryErrors, canViewWebhooks, canManageWebhooks, canViewActivity, canManagePolicies,
  hasAnyIntegrationsCapability, getAuthorizedOrganizationIds, canManageConnectionForOrganization,
} from "./integrationsConfig";

describe("integrationsConfig: role identity", () => {
  it("identifies System Owner and Organization Administrator correctly", () => {
    expect(isSystemOwner("Super-Admin")).toBe(true);
    expect(isSystemOwner("Admin")).toBe(false);
    expect(isOrganizationAdministrator("Admin")).toBe(true);
    expect(isOrganizationAdministrator("Super-Admin")).toBe(false);
  });
});

describe("integrationsConfig: System Owner has full capability", () => {
  const role = "Super-Admin";
  it("can do everything, including manage policies", () => {
    expect(canViewIntegrations(role)).toBe(true);
    expect(canViewMarketplace(role)).toBe(true);
    expect(canCreateConnections(role)).toBe(true);
    expect(canUpdateConnections(role)).toBe(true);
    expect(canPauseConnections(role)).toBe(true);
    expect(canDisconnectConnections(role)).toBe(true);
    expect(canManageCapabilities(role)).toBe(true);
    expect(canViewMappings(role)).toBe(true);
    expect(canManageMappings(role)).toBe(true);
    expect(canViewSync(role)).toBe(true);
    expect(canRunSync(role)).toBe(true);
    expect(canRetryErrors(role)).toBe(true);
    expect(canViewWebhooks(role)).toBe(true);
    expect(canManageWebhooks(role)).toBe(true);
    expect(canViewActivity(role)).toBe(true);
    expect(canManagePolicies(role)).toBe(true);
  });
});

describe("integrationsConfig: Organization Administrator has everything except manage policies", () => {
  const role = "Admin";
  it("can manage connections, mappings, sync and webhooks", () => {
    expect(canViewIntegrations(role)).toBe(true);
    expect(canCreateConnections(role)).toBe(true);
    expect(canDisconnectConnections(role)).toBe(true);
    expect(canManageMappings(role)).toBe(true);
    expect(canRunSync(role)).toBe(true);
    expect(canManageWebhooks(role)).toBe(true);
  });
  it("cannot manage organization-wide integration policies", () => {
    expect(canManagePolicies(role)).toBe(false);
  });
});

describe("integrationsConfig: Auditor/Checker is view-only", () => {
  const role = "Checker";
  it("can view but never connect, reconfigure, retry, pause or disconnect", () => {
    expect(canViewIntegrations(role)).toBe(true);
    expect(canViewMarketplace(role)).toBe(true);
    expect(canViewMappings(role)).toBe(true);
    expect(canViewSync(role)).toBe(true);
    expect(canViewWebhooks(role)).toBe(true);
    expect(canViewActivity(role)).toBe(true);
  });
  it("has no create/manage/pause/disconnect/retry capability", () => {
    expect(canCreateConnections(role)).toBe(false);
    expect(canUpdateConnections(role)).toBe(false);
    expect(canPauseConnections(role)).toBe(false);
    expect(canDisconnectConnections(role)).toBe(false);
    expect(canManageMappings(role)).toBe(false);
    expect(canRunSync(role)).toBe(false);
    expect(canRetryErrors(role)).toBe(false);
    expect(canManageWebhooks(role)).toBe(false);
    expect(canManagePolicies(role)).toBe(false);
  });
});

describe("integrationsConfig: Team-Leader and User have no default integration capability", () => {
  it("Team-Leader sees nothing by default", () => {
    expect(hasAnyIntegrationsCapability("Team-Leader")).toBe(false);
  });
  it("User (Standard Employee) sees nothing by default", () => {
    expect(hasAnyIntegrationsCapability("User")).toBe(false);
  });
});

describe("integrationsConfig: hasAnyIntegrationsCapability", () => {
  it("is true for System Owner and Organization Administrator, true for Checker (view-only still counts)", () => {
    expect(hasAnyIntegrationsCapability("Super-Admin")).toBe(true);
    expect(hasAnyIntegrationsCapability("Admin")).toBe(true);
    expect(hasAnyIntegrationsCapability("Checker")).toBe(true);
  });
});

describe("integrationsConfig: organization scoping", () => {
  it("System Owner is authorized for every organization (null = no restriction)", () => {
    expect(getAuthorizedOrganizationIds("Super-Admin", "org_caspira_hq")).toBeNull();
  });
  it("Organization Administrator is restricted to their own organization", () => {
    expect(getAuthorizedOrganizationIds("Admin", "org_caspira_hq")).toEqual(["org_caspira_hq"]);
  });
  it("canManageConnectionForOrganization allows System Owner across any organization", () => {
    expect(canManageConnectionForOrganization("Super-Admin", "org_nimbus_retail", "org_caspira_hq")).toBe(true);
  });
  it("canManageConnectionForOrganization restricts Organization Administrator to their own organization", () => {
    expect(canManageConnectionForOrganization("Admin", "org_caspira_hq", "org_caspira_hq")).toBe(true);
    expect(canManageConnectionForOrganization("Admin", "org_nimbus_retail", "org_caspira_hq")).toBe(false);
  });
  it("canManageConnectionForOrganization denies every other role", () => {
    expect(canManageConnectionForOrganization("Checker", "org_caspira_hq", "org_caspira_hq")).toBe(false);
  });
});

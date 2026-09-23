import { describe, it, expect } from "vitest";
import { toUiContact, toApiContact, BACKEND_ENABLED as CONTACTS_BACKEND } from "./crmContactsBackend";
import { toUiCompany, toApiCompany, BACKEND_ENABLED as COMPANIES_BACKEND } from "./crmCompaniesBackend";

describe("crmContactsBackend shape translation", () => {
  it("is off under test regardless of the developer's .env", () => {
    expect(CONTACTS_BACKEND).toBe(false);
    expect(COMPANIES_BACKEND).toBe(false);
  });

  it("maps API contact fields onto the Contacts UI's names", () => {
    const owners = new Map([["m1", { id: "m1", name: "Priya Nair" }]]);
    const ui = toUiContact(
      {
        _id: "c1", name: "Elena Vasquez", ownerMembershipId: "m1", nextActionDate: "2026-10-01T00:00:00.000Z", timeZone: "UTC",
        emailOptIn: true, phoneOptIn: false, smsOptIn: false, marketingOptIn: true, description: "VIP", companyId: "co1",
        company: { _id: "co1", name: "Northwind Analytics" }, createdAt: "2026-09-01T00:00:00.000Z",
      },
      owners,
    );
    expect(ui).toMatchObject({
      ownerId: "m1", ownerName: "Priya Nair", nextFollowUp: "2026-10-01T00:00:00.000Z", timezone: "UTC",
      emailAllowed: true, phoneAllowed: false, marketingAllowed: true, notes: "VIP", companyId: "co1", companyName: "Northwind Analytics",
    });
  });

  it("renames UI fields back and drops derived ones", () => {
    expect(toApiContact({ ownerId: "", emailAllowed: true, timezone: "UTC", notes: "x", companyName: "Acme", tags: ["a"], jobTitle: "CTO" })).toEqual({
      ownerMembershipId: null, emailOptIn: true, timeZone: "UTC", description: "x", jobTitle: "CTO",
    });
  });
});

describe("crmCompaniesBackend shape translation", () => {
  it("maps API company fields onto the Companies UI's names, including the primary contact", () => {
    const ui = toUiCompany({
      _id: "co1", name: "Northwind", size: "51-200", companyType: "Prospect", team: "Enterprise", addressLine1: "1 Main St",
      timeZone: "UTC", nextActionDate: null, normalizedDomain: "northwind.example", description: "", createdAt: "2026-09-01T00:00:00.000Z",
      contactRelationships: [{ contactId: "c1" }],
    });
    expect(ui).toMatchObject({
      companySize: "51-200", accountType: "Prospect", assignedTeam: "Enterprise", address: "1 Main St", timezone: "UTC",
      primaryDomain: "northwind.example", primaryContactId: "c1", ownerId: null,
    });
  });

  it("renames UI fields back and never sends derived primaryContactId/primaryDomain", () => {
    expect(toApiCompany({ companySize: "1-10", accountType: "Customer", assignedTeam: "SMB", primaryContactId: "c9", primaryDomain: "x.example", notes: "n" })).toEqual({
      size: "1-10", companyType: "Customer", team: "SMB", description: "n",
    });
  });
});

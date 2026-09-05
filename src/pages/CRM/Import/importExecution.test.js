import { describe, it, expect } from "vitest";
import { buildCreatePayload, buildUpdatePayload } from "./importExecution";
import { companies, contacts } from "../../../Helpers/mockCrmData";
import { CRM_TEAM } from "../../../Helpers/mockUsersData";

describe("importExecution — buildCreatePayload", () => {
  it("builds a Lead payload with the same duplicateOverride pattern already used by the live create endpoints", () => {
    const payload = buildCreatePayload("leads", { firstName: "Priya", lastName: "Anand", email: "priya@example.com" });
    expect(payload.duplicateOverride).toBe(true);
    expect(payload.overrideReason).toBeTruthy();
    expect(payload.firstName).toBe("Priya");
    expect(payload.source).toBe("Website");
    expect(payload.status).toBe("New");
    expect(payload.currency).toBe("USD");
  });

  it("resolves a Contact's companyName to a real companyId via the shared fixtures", () => {
    const co = companies.find((c) => c.name === "Northline Prospecting Co");
    const payload = buildCreatePayload("contacts", { firstName: "Priya", email: "priya@example.com", companyName: "Northline Prospecting Co" });
    expect(payload.companyId).toBe(co._id);
  });

  it("leaves companyId null for a Contact whose company doesn't resolve, rather than inventing one", () => {
    const payload = buildCreatePayload("contacts", { firstName: "Priya", email: "priya@example.com", companyName: "Nonexistent Co 12345" });
    expect(payload.companyId).toBeNull();
  });

  it("resolves an owner given by name to the matching team member's id", () => {
    const owner = CRM_TEAM[0];
    const payload = buildCreatePayload("leads", { firstName: "Priya", email: "priya@example.com", ownerId: owner.name });
    expect(payload.ownerId).toBe(owner.id);
  });

  it("resolves a Deal's company and primary contact by name/email, within the matched company when possible", () => {
    const co = companies.find((c) => c.name === "Northline Prospecting Co");
    const contact = contacts.find((c) => c.email === "elena.marsh@brightloop.example");
    const payload = buildCreatePayload("deals", {
      name: "Deal", companyName: "Northline Prospecting Co", currency: "USD", primaryContactEmail: "elena.marsh@brightloop.example",
    });
    expect(payload.companyId).toBe(co._id);
    expect(payload.primaryContactId).toBe(contact._id);
  });

  it("never sets duplicateOverride for a Deal payload (Deals have no client-side duplicate-override field)", () => {
    const payload = buildCreatePayload("deals", { name: "Deal", companyName: "Northline Prospecting Co", currency: "USD" });
    expect(payload.duplicateOverride).toBeUndefined();
  });
});

describe("importExecution — buildUpdatePayload never blanks existing data", () => {
  it("never includes duplicateOverride/overrideReason in an update payload", () => {
    const payload = buildUpdatePayload("leads", { firstName: "Priya", email: "priya@example.com" });
    expect(payload.duplicateOverride).toBeUndefined();
    expect(payload.overrideReason).toBeUndefined();
  });

  it("only includes fields the imported row actually provided a real value for", () => {
    const payload = buildUpdatePayload("leads", { firstName: "Priya" });
    expect(payload.firstName).toBe("Priya");
    expect(payload).not.toHaveProperty("email");
    expect(payload).not.toHaveProperty("phone");
    expect(payload).not.toHaveProperty("tags");
  });

  it("still includes fields that resolve to a real default (e.g. source, status), since those are real values to write", () => {
    const payload = buildUpdatePayload("leads", { firstName: "Priya" });
    expect(payload.source).toBe("Website");
    expect(payload.status).toBe("New");
  });
});

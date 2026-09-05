import { describe, it, expect } from "vitest";
import { findFixtureDuplicates, DUPLICATE_DECISIONS } from "./importDuplicates";
import { companies, contacts, leads, deals } from "../../../Helpers/mockCrmData";

describe("importDuplicates — findFixtureDuplicates compares against the SAME shared fixtures every CRM route reads, never a separate dataset", () => {
  it("matches a lead against the fixture leads array by email", () => {
    const existing = leads[0];
    const matches = findFixtureDuplicates("leads", { email: existing.email, firstName: "Someone", lastName: "Else" });
    const hit = matches.find((m) => m.existing === existing);
    expect(hit).toBeTruthy();
    expect(hit.matchingFields).toContain("Email");
    expect(hit.confidence).toBe("High");
  });

  it("matches a contact against the fixture contacts array by email", () => {
    const existing = contacts.find((c) => c.email === "elena.marsh@brightloop.example");
    expect(existing).toBeTruthy();
    const matches = findFixtureDuplicates("contacts", { email: "elena.marsh@brightloop.example" });
    const hit = matches.find((m) => m.existing === existing);
    expect(hit).toBeTruthy();
    expect(hit.matchingFields).toContain("Email");
  });

  it("matches a company against the fixture companies array by name", () => {
    const existing = companies.find((c) => c.name === "Northline Prospecting Co");
    expect(existing).toBeTruthy();
    const matches = findFixtureDuplicates("companies", { name: "Northline Prospecting Co" });
    const hit = matches.find((m) => m.existing === existing);
    expect(hit).toBeTruthy();
    expect(hit.matchingFields).toContain("Company Name");
  });

  it("reports field differences between the imported row and the matched fixture", () => {
    const existing = companies.find((c) => c.name === "Northline Prospecting Co");
    const matches = findFixtureDuplicates("companies", { name: "Northline Prospecting Co", phone: "+1-555-9999999" });
    const hit = matches.find((m) => m.existing === existing);
    expect(hit.differences.some((d) => d.field === "Phone")).toBe(true);
  });

  it("requires at least two matching signals for a Deal — a company match alone is not enough to flag it", () => {
    const co = companies.find((c) => c.name === "Northline Prospecting Co");
    const matches = findFixtureDuplicates("deals", { name: "Some Completely Different Deal Name 999", companyName: co.name });
    expect(matches.some((m) => m.existing.companyId === co._id)).toBe(false);
  });

  it("matches a deal once name and company both agree (two signals)", () => {
    const co = companies.find((c) => c.name === "Northline Prospecting Co");
    const existing = deals.find((d) => d.companyId === co._id && d.name === `${co.name} — Initial Discovery`);
    expect(existing).toBeTruthy();
    const matches = findFixtureDuplicates("deals", { name: existing.name, companyName: co.name });
    expect(matches.some((m) => m.existing === existing)).toBe(true);
  });

  it("returns no matches for a company name with no fixture overlap", () => {
    expect(findFixtureDuplicates("companies", { name: "Totally Unique Nonexistent Co 999999" })).toEqual([]);
  });
});

describe("importDuplicates — DUPLICATE_DECISIONS", () => {
  it("offers exactly the four required decisions: skip, create as new, preview update, review manually", () => {
    expect(DUPLICATE_DECISIONS.map((d) => d.key)).toEqual(["skip", "createNew", "previewUpdate", "reviewManually"]);
    for (const d of DUPLICATE_DECISIONS) expect(d.label).toBeTruthy();
  });
});

import { describe, it, expect } from "vitest";
import {
  normalizeEmail, normalizePhone, resolveEnumValue, resolveOwner, resolveCompanyByName, resolveContactByEmail,
  buildRowValues, computeRowIdentifier, validateRow, classifyRow, findInFileDuplicateRowIndexes,
  IGNORE_KEY, FULL_NAME_VIRTUAL_KEY,
} from "./importValidation";
import { CRM_TEAM } from "../../../Helpers/mockUsersData";
import { companies, contacts } from "../../../Helpers/mockCrmData";

describe("importValidation — normalization helpers", () => {
  it("normalizeEmail trims and lowercases", () => {
    expect(normalizeEmail("  Jane@Example.COM ")).toBe("jane@example.com");
    expect(normalizeEmail(undefined)).toBe("");
  });
  it("normalizePhone strips every non-digit character, including a leading +", () => {
    expect(normalizePhone("+1 (555) 013-4000")).toBe("15550134000");
  });
});

describe("importValidation — resolveEnumValue", () => {
  const values = ["New", "Contacted", "Qualified"];
  it("returns an exact match unchanged", () => {
    expect(resolveEnumValue("Contacted", values)).toEqual({ value: "Contacted", matched: true });
  });
  it("resolves a case-insensitive match to the canonical casing", () => {
    expect(resolveEnumValue("contacted", values)).toEqual({ value: "Contacted", matched: true });
  });
  it("reports unmatched for a value not in the list, keeping the raw text", () => {
    expect(resolveEnumValue("Bogus", values)).toEqual({ value: "Bogus", matched: false });
  });
  it("treats a blank value as trivially matched (nothing to validate)", () => {
    expect(resolveEnumValue("", values)).toEqual({ value: "", matched: true });
  });
});

describe("importValidation — resolveOwner", () => {
  it("resolves a real owner id directly", () => {
    const owner = CRM_TEAM[0];
    expect(resolveOwner(owner.id)).toEqual({ ownerId: owner.id, matched: true });
  });
  it("resolves a real owner by name, case-insensitively", () => {
    const owner = CRM_TEAM[0];
    expect(resolveOwner(owner.name.toUpperCase())).toEqual({ ownerId: owner.id, matched: true });
  });
  it("reports unmatched for an unknown owner", () => {
    expect(resolveOwner("Nobody Real")).toEqual({ ownerId: null, matched: false, raw: "Nobody Real" });
  });
  it("treats a blank owner as trivially matched", () => {
    expect(resolveOwner("")).toEqual({ ownerId: null, matched: true });
  });
});

describe("importValidation — resolveCompanyByName / resolveContactByEmail (shared fixtures, not a separate dataset)", () => {
  it("resolves an existing company by exact name", () => {
    const target = companies.find((c) => c.name === "Northline Prospecting Co");
    expect(resolveCompanyByName("Northline Prospecting Co")).toBe(target);
  });
  it("resolves an existing company case-insensitively and trims whitespace", () => {
    const target = companies.find((c) => c.name === "Northline Prospecting Co");
    expect(resolveCompanyByName("  northline prospecting co ")).toBe(target);
  });
  it("returns null for a company name with no fixture match", () => {
    expect(resolveCompanyByName("Totally Unknown Company Ltd 12345")).toBeNull();
  });
  it("resolves an existing contact by email", () => {
    const target = contacts.find((c) => c.email === "elena.marsh@brightloop.example");
    expect(resolveContactByEmail("elena.marsh@brightloop.example")).toBe(target);
  });
  it("returns null for an email with no fixture match", () => {
    expect(resolveContactByEmail("nobody@nowhere.example")).toBeNull();
  });
});

describe("importValidation — buildRowValues", () => {
  it("maps only mapped columns, skipping ones left unmapped or mapped to Ignore", () => {
    const headers = ["First", "Junk", "Email"];
    const mapping = { 0: "firstName", 1: IGNORE_KEY, 2: "email" };
    const values = buildRowValues("leads", ["Priya", "noise", "priya@example.com"], headers, mapping, {});
    expect(values).toEqual({ firstName: "Priya", email: "priya@example.com" });
  });

  it("applies a per-column transform before assigning the value", () => {
    const headers = ["Email"];
    const mapping = { 0: "email" };
    const transforms = { 0: "lowercaseEmail" };
    const values = buildRowValues("leads", ["PRIYA@EXAMPLE.COM"], headers, mapping, transforms);
    expect(values.email).toBe("priya@example.com");
  });

  it("splits a full-name virtual mapping into firstName/lastName", () => {
    const headers = ["Full Name"];
    const mapping = { 0: FULL_NAME_VIRTUAL_KEY };
    const values = buildRowValues("leads", ["Priya Anand"], headers, mapping, {});
    expect(values).toEqual({ firstName: "Priya", lastName: "Anand" });
  });

  it("when both a full-name column and an explicit last-name column are mapped, the column processed later wins for that field", () => {
    const headers = ["Full Name", "Last Name"];
    const mapping = { 0: FULL_NAME_VIRTUAL_KEY, 1: "lastName" };
    const values = buildRowValues("leads", ["Priya Anand", "Override"], headers, mapping, {});
    expect(values.firstName).toBe("Priya");
    expect(values.lastName).toBe("Override");
  });

  it("splits a multi-value (tags) field into an array", () => {
    const headers = ["Tags"];
    const mapping = { 0: "tags" };
    const values = buildRowValues("leads", ["trade-show, warm"], headers, mapping, {});
    expect(values.tags).toEqual(["trade-show", "warm"]);
  });
});

describe("importValidation — computeRowIdentifier", () => {
  it("uses the company name for companies, with a fallback label", () => {
    expect(computeRowIdentifier("companies", { name: "Acme Inc" })).toBe("Acme Inc");
    expect(computeRowIdentifier("companies", {})).toBe("(no company name)");
  });
  it("uses the deal name for deals, with a fallback label", () => {
    expect(computeRowIdentifier("deals", { name: "Acme — Renewal" })).toBe("Acme — Renewal");
    expect(computeRowIdentifier("deals", {})).toBe("(no deal name)");
  });
  it("combines first/last name for leads and contacts, falling back to email then phone then a label", () => {
    expect(computeRowIdentifier("leads", { firstName: "Priya", lastName: "Anand" })).toBe("Priya Anand");
    expect(computeRowIdentifier("leads", { email: "priya@example.com" })).toBe("priya@example.com");
    expect(computeRowIdentifier("leads", { phone: "5550134000" })).toBe("5550134000");
    expect(computeRowIdentifier("leads", {})).toBe("(no name)");
  });
});

describe('importValidation — validateRow("leads", ...) mirrors the live Lead form rules', () => {
  it("requires a person name or a company name", () => {
    const { errors } = validateRow("leads", { email: "a@example.com" });
    expect(errors.name).toBeTruthy();
  });
  it("accepts a lead identified only by company name", () => {
    const { errors } = validateRow("leads", { companyName: "Acme Inc", email: "a@example.com" });
    expect(errors.name).toBeUndefined();
  });
  it("requires an email or a phone", () => {
    const { errors } = validateRow("leads", { firstName: "Priya" });
    expect(errors.email).toBeTruthy();
    expect(errors.phone).toBeTruthy();
  });
  it("rejects a malformed email", () => {
    const { errors } = validateRow("leads", { firstName: "Priya", email: "not-an-email" });
    expect(errors.email).toBeTruthy();
  });
  it("warns (but doesn't error) on a suspiciously short phone number", () => {
    const { errors, warnings } = validateRow("leads", { firstName: "Priya", phone: "123" });
    expect(errors.phone).toBeUndefined();
    expect(warnings.phone).toBeTruthy();
  });
  it("rejects a negative estimated value", () => {
    const { errors } = validateRow("leads", { firstName: "Priya", email: "a@example.com", estimatedValue: "-5" });
    expect(errors.estimatedValue).toBeTruthy();
  });
  it("warns on an unrecognized status rather than rejecting the row", () => {
    const { errors, warnings } = validateRow("leads", { firstName: "Priya", email: "a@example.com", status: "Bogus Status" });
    expect(errors.status).toBeUndefined();
    expect(warnings.status).toBeTruthy();
  });
  it("warns on an unrecognized currency via the shared baseChecks", () => {
    const { warnings } = validateRow("leads", { firstName: "Priya", email: "a@example.com", currency: "ZZZ" });
    expect(warnings.currency).toBeTruthy();
  });
  it("warns on an unresolvable owner via the shared baseChecks", () => {
    const { warnings } = validateRow("leads", { firstName: "Priya", email: "a@example.com", ownerId: "nobody" });
    expect(warnings.ownerId).toBeTruthy();
  });
});

describe('importValidation — validateRow("contacts", ...) mirrors the live Contact form rules', () => {
  it("requires a first or last name", () => {
    const { errors } = validateRow("contacts", { email: "a@example.com" });
    expect(errors.name).toBeTruthy();
  });
  it("requires an email or a phone", () => {
    const { errors } = validateRow("contacts", { firstName: "Priya" });
    expect(errors.email).toBeTruthy();
    expect(errors.phone).toBeTruthy();
  });
  it("warns (does not error) when the referenced company doesn't match any fixture company", () => {
    const { errors, warnings } = validateRow("contacts", { firstName: "Priya", email: "a@example.com", companyName: "Nonexistent Co 12345" });
    expect(errors.companyName).toBeUndefined();
    expect(warnings.companyName).toBeTruthy();
  });
  it("raises no company warning when the company resolves to a real fixture", () => {
    const { warnings } = validateRow("contacts", { firstName: "Priya", email: "a@example.com", companyName: "Northline Prospecting Co" });
    expect(warnings.companyName).toBeUndefined();
  });
});

describe('importValidation — validateRow("companies", ...) mirrors the live Company form rules', () => {
  it("requires a company name", () => {
    const { errors } = validateRow("companies", {});
    expect(errors.name).toBeTruthy();
  });
  it("warns when a website is missing the https:// scheme", () => {
    const { errors, warnings } = validateRow("companies", { name: "Acme", website: "www.acme.example" });
    expect(errors.website).toBeUndefined();
    expect(warnings.website).toBeTruthy();
  });
  it("rejects a malformed email", () => {
    const { errors } = validateRow("companies", { name: "Acme", email: "not-an-email" });
    expect(errors.email).toBeTruthy();
  });
  it("rejects a negative estimated annual value", () => {
    const { errors } = validateRow("companies", { name: "Acme", estimatedAnnualValue: "-1" });
    expect(errors.estimatedAnnualValue).toBeTruthy();
  });
});

describe('importValidation — validateRow("deals", ...) mirrors the live Deal form rules', () => {
  it("requires a deal name", () => {
    const { errors } = validateRow("deals", { companyName: "Northline Prospecting Co", currency: "USD" });
    expect(errors.name).toBeTruthy();
  });
  it("requires a company, and rejects one that doesn't resolve to a fixture", () => {
    const { errors } = validateRow("deals", { name: "Deal", companyName: "Nonexistent Co 12345", currency: "USD" });
    expect(errors.companyName).toBeTruthy();
  });
  it("passes company validation once the name resolves to a real fixture", () => {
    const { errors } = validateRow("deals", { name: "Deal", companyName: "Northline Prospecting Co", currency: "USD" });
    expect(errors.companyName).toBeUndefined();
  });
  it("requires a currency", () => {
    const { errors } = validateRow("deals", { name: "Deal", companyName: "Northline Prospecting Co" });
    expect(errors.currency).toBeTruthy();
  });
  it("rejects a negative deal value", () => {
    const { errors } = validateRow("deals", { name: "Deal", companyName: "Northline Prospecting Co", currency: "USD", value: "-1" });
    expect(errors.value).toBeTruthy();
  });
  it("rejects a probability outside 0-100", () => {
    const { errors } = validateRow("deals", { name: "Deal", companyName: "Northline Prospecting Co", currency: "USD", probability: "150" });
    expect(errors.probability).toBeTruthy();
  });
  it("warns (does not error) when the primary contact email doesn't match any fixture contact", () => {
    const { errors, warnings } = validateRow("deals", {
      name: "Deal", companyName: "Northline Prospecting Co", currency: "USD", primaryContactEmail: "nobody@nowhere.example",
    });
    expect(errors.primaryContactEmail).toBeUndefined();
    expect(warnings.primaryContactEmail).toBeTruthy();
  });
  it("warns on an unrecognized stage rather than rejecting the row", () => {
    const { errors, warnings } = validateRow("deals", { name: "Deal", companyName: "Northline Prospecting Co", currency: "USD", stage: "Bogus Stage" });
    expect(errors.stage).toBeUndefined();
    expect(warnings.stage).toBeTruthy();
  });
});

describe("importValidation — classifyRow", () => {
  it("classifies as invalid when there is at least one error, regardless of warnings", () => {
    expect(classifyRow({ name: "bad" }, { phone: "short" })).toBe("invalid");
  });
  it("classifies as warning when there are warnings but no errors", () => {
    expect(classifyRow({}, { phone: "short" })).toBe("warning");
  });
  it("classifies as valid when there are neither errors nor warnings", () => {
    expect(classifyRow({}, {})).toBe("valid");
  });
});

describe("importValidation — findInFileDuplicateRowIndexes (within the same upload)", () => {
  it("flags leads sharing the same normalized email", () => {
    const rows = [{ email: "Priya@Example.com" }, { email: "priya@example.com" }, { email: "someone-else@example.com" }];
    expect(findInFileDuplicateRowIndexes("leads", rows)).toEqual(new Set([0, 1]));
  });

  it("flags leads sharing the same normalized phone when no email is present", () => {
    const rows = [{ phone: "(555) 013-4000" }, { phone: "555.013.4000" }, { phone: "555-999-8888" }];
    expect(findInFileDuplicateRowIndexes("leads", rows)).toEqual(new Set([0, 1]));
  });

  it("flags companies sharing the same normalized name", () => {
    const rows = [{ name: "Acme Inc" }, { name: "  acme inc  " }, { name: "Different Co" }];
    expect(findInFileDuplicateRowIndexes("companies", rows)).toEqual(new Set([0, 1]));
  });

  it("flags deals only when both name and company match", () => {
    const rows = [
      { name: "Renewal", companyName: "Acme Inc" },
      { name: "Renewal", companyName: "Acme Inc" },
      { name: "Renewal", companyName: "Different Co" },
    ];
    expect(findInFileDuplicateRowIndexes("deals", rows)).toEqual(new Set([0, 1]));
  });

  it("returns an empty set when nothing repeats", () => {
    const rows = [{ email: "a@example.com" }, { email: "b@example.com" }];
    expect(findInFileDuplicateRowIndexes("leads", rows).size).toBe(0);
  });
});

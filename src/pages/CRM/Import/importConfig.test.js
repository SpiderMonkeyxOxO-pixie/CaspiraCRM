import { describe, it, expect } from "vitest";
import { normalizeHeader, autoMapHeaders, getRecordTypeConfig, RECORD_TYPES, RECORD_TYPE_ORDER, IMPORT_LIMITS } from "./importConfig";

describe("importConfig — normalizeHeader", () => {
  it("lowercases, trims, and collapses whitespace/hyphens into underscores", () => {
    expect(normalizeHeader("First Name")).toBe("first_name");
    expect(normalizeHeader("  Deal-Amount  ")).toBe("deal_amount");
    expect(normalizeHeader("Assigned To")).toBe("assigned_to");
  });
  it("strips characters that aren't alphanumeric or underscore", () => {
    expect(normalizeHeader("E-mail (work)")).toBe("e_mail_work");
  });
  it("treats a blank/undefined header as an empty string", () => {
    expect(normalizeHeader(undefined)).toBe("");
    expect(normalizeHeader("")).toBe("");
  });
});

describe("importConfig — RECORD_TYPES / getRecordTypeConfig", () => {
  it("defines exactly the four supported record types, matching RECORD_TYPE_ORDER", () => {
    expect(RECORD_TYPE_ORDER).toEqual(["leads", "contacts", "companies", "deals"]);
    expect(Object.keys(RECORD_TYPES).sort()).toEqual([...RECORD_TYPE_ORDER].sort());
  });

  it("returns the matching config for a known type and null for an unknown one", () => {
    expect(getRecordTypeConfig("leads")).toBe(RECORD_TYPES.leads);
    expect(getRecordTypeConfig("bogus")).toBeNull();
  });

  it("every record type's headerAliases point only at real destination fields (regression guard against config drift)", () => {
    for (const type of RECORD_TYPE_ORDER) {
      const config = RECORD_TYPES[type];
      const fieldKeys = new Set(config.destinationFields.map((f) => f.key));
      for (const destKey of Object.values(config.headerAliases)) {
        expect(fieldKeys.has(destKey)).toBe(true);
      }
    }
  });

  it("every template column key, once normalized, resolves via headerAliases back to a real destination field", () => {
    for (const type of RECORD_TYPE_ORDER) {
      const config = RECORD_TYPES[type];
      const fieldKeys = new Set(config.destinationFields.map((f) => f.key));
      for (const col of config.templateColumns) {
        const norm = normalizeHeader(col.key);
        expect(config.headerAliases[norm]).toBeTruthy();
        expect(fieldKeys.has(config.headerAliases[norm])).toBe(true);
      }
    }
  });
});

describe("importConfig — autoMapHeaders", () => {
  const leadsConfig = RECORD_TYPES.leads;

  it("maps a header to its destination field via a known alias, with high confidence", () => {
    const { mapping, confidence } = autoMapHeaders(["fname", "surname", "mobile"], leadsConfig);
    expect(mapping).toEqual({ 0: "firstName", 1: "lastName", 2: "phone" });
    expect(confidence).toEqual({ 0: "high", 1: "high", 2: "high" });
  });

  it("resolves the Leads presets named in the spec: fname, surname, mobile, company, assigned_to", () => {
    const headers = ["fname", "surname", "mobile", "company", "assigned_to"];
    const { mapping } = autoMapHeaders(headers, leadsConfig);
    expect(mapping).toEqual({ 0: "firstName", 1: "lastName", 2: "phone", 3: "companyName", 4: "ownerId" });
  });

  it("resolves deal_amount to Deal Value and close_date to Expected Closing Date on the Deals config", () => {
    const { mapping } = autoMapHeaders(["deal_amount", "close_date"], RECORD_TYPES.deals);
    expect(mapping).toEqual({ 0: "value", 1: "expectedClosingDate" });
  });

  it("leaves an unrecognized header unmapped", () => {
    const { mapping, confidence } = autoMapHeaders(["some_totally_unknown_column"], leadsConfig);
    expect(mapping).toEqual({});
    expect(confidence).toEqual({});
  });

  it("matches headers regardless of case, spacing, or punctuation", () => {
    const { mapping } = autoMapHeaders(["First Name", "  Phone Number "], leadsConfig);
    expect(mapping).toEqual({ 0: "firstName", 1: "phone" });
  });
});

describe("importConfig — IMPORT_LIMITS", () => {
  it("supports exactly csv, xlsx, and xls", () => {
    expect(IMPORT_LIMITS.supportedExtensions).toEqual([".csv", ".xlsx", ".xls"]);
  });
});

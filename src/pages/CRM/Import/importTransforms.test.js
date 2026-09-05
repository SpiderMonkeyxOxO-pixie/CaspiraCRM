import { describe, it, expect } from "vitest";
import {
  trimWhitespace, normalizeEmailCase, normalizePhoneFormat, splitFullName, combineFirstLastName,
  standardizeDate, convertPercentValue, splitTags, replaceBlankWithDefault, TRANSFORM_TYPES, applyTransform,
} from "./importTransforms";

describe("importTransforms — simple value transforms", () => {
  it("trimWhitespace strips leading/trailing whitespace and tolerates null/undefined", () => {
    expect(trimWhitespace("  Priya  ")).toBe("Priya");
    expect(trimWhitespace(null)).toBe("");
    expect(trimWhitespace(undefined)).toBe("");
  });

  it("normalizeEmailCase trims and lowercases", () => {
    expect(normalizeEmailCase("  Priya.Anand@Example.COM ")).toBe("priya.anand@example.com");
  });

  it("normalizePhoneFormat strips everything but digits while preserving a leading +", () => {
    expect(normalizePhoneFormat("+1 (555) 013-4000")).toBe("+15550134000");
    expect(normalizePhoneFormat("555.013.4000")).toBe("5550134000");
    expect(normalizePhoneFormat("")).toBe("");
  });

  it("splitFullName splits on whitespace, putting every remaining word into lastName", () => {
    expect(splitFullName("Priya Anand")).toEqual({ firstName: "Priya", lastName: "Anand" });
    expect(splitFullName("Priya Kumar Anand")).toEqual({ firstName: "Priya", lastName: "Kumar Anand" });
    expect(splitFullName("Cher")).toEqual({ firstName: "Cher", lastName: "" });
    expect(splitFullName("")).toEqual({ firstName: "", lastName: "" });
  });

  it("combineFirstLastName joins the two names and trims a missing half", () => {
    expect(combineFirstLastName("Priya", "Anand")).toBe("Priya Anand");
    expect(combineFirstLastName("Cher", "")).toBe("Cher");
    expect(combineFirstLastName("", "")).toBe("");
  });

  it("splitTags splits on commas, trims each tag, and drops empties", () => {
    expect(splitTags("trade-show, warm ,, vip")).toEqual(["trade-show", "warm", "vip"]);
    expect(splitTags("")).toEqual([]);
  });

  it("replaceBlankWithDefault only substitutes for blank/whitespace-only values", () => {
    expect(replaceBlankWithDefault("", "New")).toBe("New");
    expect(replaceBlankWithDefault("   ", "New")).toBe("New");
    expect(replaceBlankWithDefault(undefined, "New")).toBe("New");
    expect(replaceBlankWithDefault("Existing", "New")).toBe("Existing");
  });
});

describe("importTransforms — standardizeDate", () => {
  it("passes an already-ISO date through unchanged", () => {
    expect(standardizeDate("2026-09-15")).toBe("2026-09-15");
  });

  it("treats an ambiguous slash date as month/day when the first number could be a month", () => {
    expect(standardizeDate("09/15/2026")).toBe("2026-09-15");
  });

  it("treats the first number as the day once it exceeds 12 (unambiguous day-first)", () => {
    expect(standardizeDate("25/12/2026")).toBe("2026-12-25");
  });

  it("expands a 2-digit year to 20YY", () => {
    expect(standardizeDate("09/15/26")).toBe("2026-09-15");
  });

  it("returns the original text unchanged when it can't confidently parse it", () => {
    expect(standardizeDate("not-a-date")).toBe("not-a-date");
  });

  it("returns blank input unchanged", () => {
    expect(standardizeDate("")).toBe("");
  });
});

describe("importTransforms — convertPercentValue", () => {
  it("passes a plain whole-number percentage through unchanged", () => {
    expect(convertPercentValue("45")).toBe("45");
  });

  it("strips a literal % sign", () => {
    expect(convertPercentValue("45%")).toBe("45");
  });

  it("converts a 0-1 fraction to its 0-100 equivalent", () => {
    expect(convertPercentValue("0.45")).toBe("45");
  });

  it("leaves a value already greater than 1 (and not a % string) unchanged", () => {
    expect(convertPercentValue("45.5")).toBe("45.5");
  });

  it("returns the original text when it isn't numeric", () => {
    expect(convertPercentValue("high")).toBe("high");
  });
});

describe("importTransforms — TRANSFORM_TYPES / applyTransform", () => {
  it("every transform type has a unique key, a label, and a callable apply function", () => {
    const keys = TRANSFORM_TYPES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const t of TRANSFORM_TYPES) {
      expect(t.label).toBeTruthy();
      expect(typeof t.apply).toBe("function");
    }
  });

  it("applyTransform dispatches to the matching transform by key", () => {
    expect(applyTransform("trim", "  Priya  ")).toBe("Priya");
    expect(applyTransform("lowercaseEmail", "PRIYA@EXAMPLE.COM")).toBe("priya@example.com");
  });

  it("applyTransform passes context through for transforms that need it (defaultBlank)", () => {
    expect(applyTransform("defaultBlank", "", { defaultValue: "New" })).toBe("New");
  });

  it("applyTransform returns the original value unchanged for an unknown key", () => {
    expect(applyTransform("does-not-exist", "value")).toBe("value");
  });
});

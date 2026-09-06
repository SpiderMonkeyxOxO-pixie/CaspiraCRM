import { describe, it, expect } from "vitest";
import {
  normalizeEmail, normalizePhone, normalizeDomain, normalizeName, normalizeTagName,
  isValidTagColorToken, sanitizeNoteBody, isValidEmail, isValidCurrencyCode,
} from "./normalizationService.js";

describe("normalizationService", () => {
  it("normalizes email to trimmed lowercase", () => {
    expect(normalizeEmail("  Jane.DOE@Example.com ")).toBe("jane.doe@example.com");
    expect(normalizeEmail(null)).toBeNull();
  });

  it("normalizes phone numbers to digits, preserving a leading +", () => {
    expect(normalizePhone("(555) 123-4567")).toBe("5551234567");
    expect(normalizePhone("+1 555.123.4567")).toBe("+15551234567");
    expect(normalizePhone("")).toBeNull();
  });

  it("normalizes a website URL down to a bare domain", () => {
    expect(normalizeDomain("https://www.Acme.com/about")).toBe("acme.com");
    expect(normalizeDomain("acme.com")).toBe("acme.com");
  });

  it("normalizes names by lowercasing and collapsing whitespace", () => {
    expect(normalizeName("  Acme   Corp  ")).toBe("acme corp");
  });

  it("normalizes tag names the same way", () => {
    expect(normalizeTagName("  VIP   Client ")).toBe("vip client");
  });

  it("only accepts an allowlisted tag color token, never arbitrary CSS", () => {
    expect(isValidTagColorToken("blue")).toBe(true);
    expect(isValidTagColorToken(null)).toBe(true);
    expect(isValidTagColorToken("javascript:alert(1)")).toBe(false);
    expect(isValidTagColorToken("#ff0000")).toBe(false);
  });

  it("strips all HTML tags from a note body", () => {
    expect(sanitizeNoteBody("<script>alert(1)</script>Hello <b>world</b>")).toBe("alert(1)Hello world");
  });

  it("validates a plausible email shape without being a full RFC validator", () => {
    expect(isValidEmail("a@b.com")).toBe(true);
    expect(isValidEmail("not-an-email")).toBe(false);
    expect(isValidEmail(null)).toBe(true); // optional field
  });

  it("validates a 3-letter ISO currency code", () => {
    expect(isValidCurrencyCode("USD")).toBe(true);
    expect(isValidCurrencyCode("usd")).toBe(false);
    expect(isValidCurrencyCode("US")).toBe(false);
  });
});

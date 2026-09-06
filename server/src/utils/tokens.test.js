import { describe, it, expect } from "vitest";
import { generateRawToken, hashToken, isExpired } from "./tokens.js";

describe("tokens", () => {
  it("generates a high-entropy, URL-safe raw token", () => {
    const a = generateRawToken();
    const b = generateRawToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(30);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("hashes deterministically — same input, same hash", () => {
    const raw = generateRawToken();
    expect(hashToken(raw)).toBe(hashToken(raw));
  });

  it("produces a different hash for a different token", () => {
    expect(hashToken(generateRawToken())).not.toBe(hashToken(generateRawToken()));
  });

  it("never reveals the raw token from its hash (not reversible/equal)", () => {
    const raw = generateRawToken();
    expect(hashToken(raw)).not.toBe(raw);
  });

  it("treats a null/undefined expiry as expired (required-expiry tables)", () => {
    expect(isExpired(null)).toBe(true);
    expect(isExpired(undefined)).toBe(true);
  });

  it("treats a past date as expired and a future date as not expired", () => {
    expect(isExpired(new Date(Date.now() - 1000))).toBe(true);
    expect(isExpired(new Date(Date.now() + 100000))).toBe(false);
  });
});

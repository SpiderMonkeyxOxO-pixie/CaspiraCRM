import { describe, it, expect } from "vitest";
import bcrypt from "bcryptjs";
import { hashPassword, verifyPassword } from "./password.js";

describe("password hashing bridge", () => {
  it("hashes new passwords as Argon2id", async () => {
    const hash = await hashPassword("Caspira2026!");
    expect(hash.startsWith("$argon2id$")).toBe(true);
  });

  it("verifies a correct password against an Argon2id hash", async () => {
    const hash = await hashPassword("Caspira2026!");
    expect(await verifyPassword(hash, "Caspira2026!")).toBe(true);
  });

  it("rejects an incorrect password against an Argon2id hash", async () => {
    const hash = await hashPassword("Caspira2026!");
    expect(await verifyPassword(hash, "wrong-password")).toBe(false);
  });

  it("still verifies existing bcrypt-hashed accounts (no forced migration)", async () => {
    const legacyHash = await bcrypt.hash("Caspira123!", 10);
    expect(await verifyPassword(legacyHash, "Caspira123!")).toBe(true);
    expect(await verifyPassword(legacyHash, "wrong-password")).toBe(false);
  });

  it("never logs or returns the plaintext password anywhere in the hash", async () => {
    const plain = "SuperSecret123!";
    const hash = await hashPassword(plain);
    expect(hash).not.toContain(plain);
  });

  it("returns false for an unrecognized hash format rather than throwing", async () => {
    expect(await verifyPassword("not-a-real-hash", "anything")).toBe(false);
    expect(await verifyPassword(null, "anything")).toBe(false);
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import crypto from "node:crypto";

const key = () => crypto.randomBytes(32).toString("base64");
const ENV = ["INTEGRATIONS_KEYS", "INTEGRATIONS_KEYS_FILE", "INTEGRATIONS_ACTIVE_KEY_VERSION", "INTEGRATIONS_MODE", "NODE_ENV"];
let saved;
let vault;

beforeEach(async () => {
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  vi.resetModules();
  vault = await import("./vault.js");
  vault.resetVaultForTests();
});
afterEach(() => {
  for (const k of ENV) if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
});

describe("credential vault", () => {
  it("round-trips with AES-256-GCM and never stores plaintext", () => {
    process.env.INTEGRATIONS_MODE = "live";
    process.env.INTEGRATIONS_KEYS = `1:${key()}`;
    const sealed = vault.encryptSecret("ya29.secret-token", "org1|conn1|access_token");
    expect(sealed).toMatchObject({ keyVersion: 1 });
    expect(JSON.stringify(sealed)).not.toContain("secret-token");
    expect(Buffer.from(sealed.nonce, "base64")).toHaveLength(12);
    expect(vault.decryptSecret(sealed, "org1|conn1|access_token")).toBe("ya29.secret-token");
  });

  it("binds ciphertext to its organization, owner and type (can't be moved)", () => {
    process.env.INTEGRATIONS_KEYS = `1:${key()}`;
    const sealed = vault.encryptSecret("token", vault.aadFor({ organizationId: "org1", ownerId: "conn1", credentialType: "access_token" }));
    expect(() => vault.decryptSecret(sealed, vault.aadFor({ organizationId: "org2", ownerId: "conn1", credentialType: "access_token" }))).toThrow();
    expect(() => vault.decryptSecret({ ...sealed, authTag: Buffer.alloc(16).toString("base64") }, vault.aadFor({ organizationId: "org1", ownerId: "conn1", credentialType: "access_token" }))).toThrow();
  });

  it("key versioning: old ciphertext still opens after a new active key is added", () => {
    const k1 = key();
    process.env.INTEGRATIONS_KEYS = `1:${k1}`;
    const old = vault.encryptSecret("refresh", "a|b|refresh_token");
    vault.resetVaultForTests();
    process.env.INTEGRATIONS_KEYS = `1:${k1},2:${key()}`;
    const fresh = vault.encryptSecret("refresh2", "a|b|refresh_token");
    expect(fresh.keyVersion).toBe(2);
    expect(vault.decryptSecret(old, "a|b|refresh_token")).toBe("refresh");
    vault.resetVaultForTests();
    process.env.INTEGRATIONS_KEYS = `2:${key()}`; // version 1 removed before rewrap
    expect(() => vault.decryptSecret(old, "a|b|refresh_token")).toThrow(/no longer in the keyring/);
  });

  it("fails closed without a master key outside simulator mode", () => {
    delete process.env.INTEGRATIONS_KEYS;
    delete process.env.INTEGRATIONS_KEYS_FILE;
    process.env.INTEGRATIONS_MODE = "live";
    expect(() => vault.assertVaultReady()).toThrow(vault.VaultConfigurationError);
    vault.resetVaultForTests();
    process.env.NODE_ENV = "production";
    process.env.INTEGRATIONS_MODE = "simulator"; // simulator is never "safe" in production
    expect(() => vault.assertVaultReady()).toThrow(/No integration master key/);
  });

  it("simulator mode uses a dev key that live mode refuses to decrypt", () => {
    delete process.env.INTEGRATIONS_KEYS;
    process.env.NODE_ENV = "development";
    process.env.INTEGRATIONS_MODE = "simulator";
    expect(vault.assertVaultReady()).toMatchObject({ devKey: true, activeVersion: 0 });
    const sealed = vault.encryptSecret("sim", "a|b|c");
    vault.resetVaultForTests();
    process.env.INTEGRATIONS_MODE = "live";
    process.env.INTEGRATIONS_KEYS = `1:${key()}`;
    expect(() => vault.decryptSecret(sealed, "a|b|c")).toThrow(/simulator key/);
  });

  it("rejects malformed keyrings", () => {
    expect(() => vault.parseKeyring("1:short")).toThrow(/32 bytes/);
    expect(() => vault.parseKeyring(`0:${key()}`)).toThrow(/start at 1/);
    expect(() => vault.parseKeyring("nonsense")).toThrow(/look like/);
    expect(vault.parseKeyring(`1:${key()},\n2:${key()}`).size).toBe(2);
  });
});

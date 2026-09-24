// Backend Phase 8 — the credential vault. AES-256-GCM (Node's crypto; no
// custom cryptography) with versioned master keys held OUTSIDE PostgreSQL:
//
//   INTEGRATIONS_KEYS_FILE  path to a Docker secret containing "1:<base64>,2:<base64>"
//   INTEGRATIONS_KEYS       the same, as an environment variable
//   INTEGRATIONS_ACTIVE_KEY_VERSION  which version encrypts new data (default: highest)
//
// Each key is 32 random bytes, base64. The database stores only ciphertext,
// nonce, auth tag and key version. The AAD binds a ciphertext to its
// organization, owner and credential type, so it can't be replayed onto
// another connection. Plaintext never leaves this module except to the
// provider adapter that needs it; it's never logged or returned by an API.
//
// Safe local simulator mode (INTEGRATIONS_MODE=simulator, not production)
// may run without keys: it uses a fixed development key, version 0, which
// live mode refuses to decrypt.
import crypto from "node:crypto";
import fs from "node:fs";

const ALGORITHM = "aes-256-gcm";
const DEV_KEY_VERSION = 0;

export class VaultConfigurationError extends Error {}

export function integrationsMode() {
  const mode = (process.env.INTEGRATIONS_MODE || (process.env.NODE_ENV === "production" ? "live" : "simulator")).toLowerCase();
  return mode === "simulator" ? "simulator" : "live";
}

export const simulatorSafe = () => integrationsMode() === "simulator" && process.env.NODE_ENV !== "production";

// "1:base64,2:base64" → Map<number, Buffer>
export function parseKeyring(text) {
  const keys = new Map();
  for (const part of String(text || "").split(/[,\n]/).map((s) => s.trim()).filter(Boolean)) {
    const match = part.match(/^(\d+):(.+)$/);
    if (!match) throw new VaultConfigurationError("Integration keys must look like 1:<base64>,2:<base64>.");
    const version = Number(match[1]);
    if (version < 1) throw new VaultConfigurationError("Integration key versions start at 1 (0 is reserved for the simulator).");
    const key = Buffer.from(match[2], "base64");
    if (key.length !== 32) throw new VaultConfigurationError(`Integration key version ${version} must be 32 bytes (base64).`);
    keys.set(version, key);
  }
  return keys;
}

let cached = null;

function loadKeyring() {
  if (cached) return cached;
  let source = process.env.INTEGRATIONS_KEYS || "";
  if (process.env.INTEGRATIONS_KEYS_FILE) {
    try {
      source = fs.readFileSync(process.env.INTEGRATIONS_KEYS_FILE, "utf8");
    } catch {
      throw new VaultConfigurationError("INTEGRATIONS_KEYS_FILE can't be read.");
    }
  }
  const keys = parseKeyring(source);
  if (!keys.size && simulatorSafe()) {
    keys.set(DEV_KEY_VERSION, crypto.createHash("sha256").update("caspira-local-provider-simulator-only").digest());
  }
  if (!keys.size) throw new VaultConfigurationError("No integration master key is configured (INTEGRATIONS_KEYS or INTEGRATIONS_KEYS_FILE).");
  const requested = process.env.INTEGRATIONS_ACTIVE_KEY_VERSION ? Number(process.env.INTEGRATIONS_ACTIVE_KEY_VERSION) : Math.max(...keys.keys());
  if (!keys.has(requested)) throw new VaultConfigurationError(`INTEGRATIONS_ACTIVE_KEY_VERSION ${requested} isn't in the keyring.`);
  cached = { keys, activeVersion: requested };
  return cached;
}

// Called at api and worker startup: outside safe simulator mode a missing or
// malformed key stops the process (fail closed).
export function assertVaultReady() {
  loadKeyring();
  return { activeVersion: cached.activeVersion, versions: [...cached.keys.keys()], devKey: cached.activeVersion === DEV_KEY_VERSION };
}

export function resetVaultForTests() {
  cached = null;
}

export const aadFor = ({ organizationId, ownerId, credentialType }) => `${organizationId || "system"}|${ownerId || "none"}|${credentialType}`;

export function encryptSecret(plaintext, aad) {
  if (typeof plaintext !== "string" || !plaintext) throw new Error("Nothing to encrypt.");
  const { keys, activeVersion } = loadKeyring();
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, keys.get(activeVersion), nonce);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { ciphertext: ciphertext.toString("base64"), nonce: nonce.toString("base64"), authTag: cipher.getAuthTag().toString("base64"), keyVersion: activeVersion };
}

export function decryptSecret({ ciphertext, nonce, authTag, keyVersion }, aad) {
  const { keys } = loadKeyring();
  if (keyVersion === DEV_KEY_VERSION && !simulatorSafe()) throw new VaultConfigurationError("This credential was encrypted with the simulator key and can't be used in live mode.");
  const key = keys.get(keyVersion);
  if (!key) throw new VaultConfigurationError(`Integration key version ${keyVersion} is no longer in the keyring.`);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(nonce, "base64"));
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(Buffer.from(authTag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64")), decipher.final()]).toString("utf8");
}

export const activeKeyVersion = () => loadKeyring().activeVersion;

// Random secrets and hashes used across the integration layer.
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString("base64url");
export const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
export const hmacSha256 = (key, value, encoding = "hex") => crypto.createHmac("sha256", key).update(value).digest(encoding);
export function safeEqual(a, b) {
  const x = Buffer.from(String(a || ""));
  const y = Buffer.from(String(b || ""));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

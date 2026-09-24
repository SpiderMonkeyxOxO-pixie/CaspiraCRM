// Backend Phase 8 — encrypted credential records. One Active credential per
// owner (connection or provider app) and type; storing a new one supersedes
// the old (rotation). Decryption happens only here, on demand, for the
// adapter call that needs it.
import prisma from "../../lib/prisma.js";
import { encryptSecret, decryptSecret, aadFor, activeKeyVersion } from "./vault.js";

const ownerOf = (row) => row.connectionId || row.providerAppId || null;

export async function storeCredential(db, { organizationId = null, connectionId = null, providerAppId = null, credentialType, plaintext, expiresAt = null }) {
  const aad = aadFor({ organizationId, ownerId: connectionId || providerAppId, credentialType });
  const sealed = encryptSecret(plaintext, aad);
  const previous = await db.integrationCredential.findFirst({ where: { connectionId, providerAppId, credentialType, status: "Active" } });
  const created = await db.integrationCredential.create({
    data: { organizationId, connectionId, providerAppId, credentialType, ...sealed, expiresAt, rotatedFromId: previous?.id || null },
  });
  if (previous) await db.integrationCredential.update({ where: { id: previous.id }, data: { status: "Superseded", rotatedAt: new Date() } });
  return created;
}

export async function readCredential(db, { connectionId = null, providerAppId = null, credentialType }) {
  const row = await db.integrationCredential.findFirst({ where: { connectionId, providerAppId, credentialType, status: "Active" }, orderBy: { createdAt: "desc" } });
  if (!row) return null;
  return { value: decryptSecret(row, aadFor({ organizationId: row.organizationId, ownerId: ownerOf(row), credentialType })), expiresAt: row.expiresAt, id: row.id };
}

export async function readCredentialById(db, id) {
  const row = await db.integrationCredential.findUnique({ where: { id } });
  if (!row || row.status !== "Active") return null;
  return decryptSecret(row, aadFor({ organizationId: row.organizationId, ownerId: ownerOf(row), credentialType: row.credentialType }));
}

export async function revokeCredentials(db, { connectionId }) {
  return db.integrationCredential.updateMany({ where: { connectionId, status: "Active" }, data: { status: "Revoked", rotatedAt: new Date() } });
}

// Safe description for APIs: which credentials exist, never their values.
export async function describeCredentials(db, { connectionId = null, providerAppId = null }) {
  const rows = await db.integrationCredential.findMany({ where: { connectionId, providerAppId, status: "Active" }, select: { credentialType: true, keyVersion: true, expiresAt: true, createdAt: true } });
  return rows.map((r) => ({ type: r.credentialType, keyVersion: r.keyVersion, expiresAt: r.expiresAt, storedAt: r.createdAt }));
}

// Master-key rotation: re-encrypts every Active credential still sealed with
// an older key version under the active one. Run after adding a new key
// version to the keyring; old versions can be removed once this reports 0.
export async function rewrapCredentials({ batchSize = 200 } = {}) {
  const active = activeKeyVersion();
  let rewrapped = 0;
  for (;;) {
    const rows = await prisma.integrationCredential.findMany({ where: { status: "Active", keyVersion: { not: active } }, take: batchSize });
    if (!rows.length) break;
    for (const row of rows) {
      const aad = aadFor({ organizationId: row.organizationId, ownerId: ownerOf(row), credentialType: row.credentialType });
      const sealed = encryptSecret(decryptSecret(row, aad), aad);
      await prisma.integrationCredential.update({ where: { id: row.id }, data: { ...sealed, rotatedAt: new Date() } });
      rewrapped += 1;
    }
  }
  const remaining = await prisma.integrationCredential.count({ where: { status: "Active", keyVersion: { not: active } } });
  return { activeKeyVersion: active, rewrapped, remaining };
}

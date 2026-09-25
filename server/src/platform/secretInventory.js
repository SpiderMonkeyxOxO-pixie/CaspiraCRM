// Backend Phase 13 — secret inventory (metadata only) and the rotation
// workflow. Secret VALUES live only in the secret store (Docker secret files
// on the host, or an external manager); this module records what exists, who
// owns it, when it was rotated and each audited rotation step. The API never
// receives, returns or logs a value.
import prisma from "../lib/prisma.js";
import { PlatformError, currentEnvironment, platformAudit } from "./common.js";
import { activeKeyVersion } from "../integrations/credentials/vault.js";
import { rewrapCredentials } from "../integrations/credentials/credentialStore.js";

// The platform's secrets and how each is rotated.
export const SECRET_CATALOG = [
  { secretKey: "DB_PASSWORD", purpose: "Runtime database role password (caspira_app)", owningService: "api, worker", owner: "Platform operations", rotationMethod: "ALTER ROLE caspira_app PASSWORD; update the db_password secret file; restart api and worker", dependentServices: ["api", "worker"], rotationIntervalDays: 180, supportsOverlap: false },
  { secretKey: "DB_MIGRATOR_PASSWORD", purpose: "Migration role password (caspira_owner)", owningService: "migrate", owner: "Platform operations", rotationMethod: "ALTER ROLE caspira_owner PASSWORD; update the db_migrator_password secret file", dependentServices: ["migrate"], rotationIntervalDays: 180, supportsOverlap: false },
  { secretKey: "DB_BACKUP_PASSWORD", purpose: "Backup role password (pgBackRest)", owningService: "backup-agent", owner: "Backup operator", rotationMethod: "ALTER ROLE caspira_backup PASSWORD; update the db_backup_password secret file", dependentServices: ["db", "backup-agent"], rotationIntervalDays: 180, supportsOverlap: false },
  { secretKey: "REDIS_PASSWORD", purpose: "Redis requirepass", owningService: "redis", owner: "Platform operations", rotationMethod: "Update the redis_password secret file; restart redis, api and worker together", dependentServices: ["redis", "api", "worker"], rotationIntervalDays: 180, supportsOverlap: false },
  { secretKey: "JWT_SECRET", purpose: "Access-token signing key", owningService: "api", owner: "Security administrator", rotationMethod: "Move the current value to jwt_secret_previous, write a new jwt_secret, restart api; remove the previous file after the access-token lifetime", dependentServices: ["api"], rotationIntervalDays: 90, supportsOverlap: true },
  { secretKey: "INTEGRATIONS_KEYS", purpose: "Credential-vault master keyring (integration and AI credentials, export files)", owningService: "api, worker", owner: "Security administrator", rotationMethod: "Add a new key version to the keyring, set it active, restart, re-encrypt, then remove the old version once nothing uses it", dependentServices: ["api", "worker"], rotationIntervalDays: 365, supportsOverlap: true },
  { secretKey: "AI_SAFETY_ID_SECRET", purpose: "HMAC key for pseudonymous AI safety identifiers", owningService: "api, worker", owner: "Security administrator", rotationMethod: "Write a new value and bump AI_SAFETY_ID_VERSION; restart", dependentServices: ["api", "worker"], rotationIntervalDays: 365, supportsOverlap: true },
  { secretKey: "METRICS_TOKEN", purpose: "Bearer token for the internal /metrics endpoint", owningService: "api, prometheus", owner: "Platform operations", rotationMethod: "Update metrics_token for api and Prometheus together", dependentServices: ["api", "prometheus"], rotationIntervalDays: 180, supportsOverlap: false },
  { secretKey: "SMTP_PASSWORD", purpose: "Email provider credential", owningService: "worker", owner: "Platform operations", rotationMethod: "Create a new credential at the provider, update smtp_password, restart worker, revoke the old credential", dependentServices: ["worker"], rotationIntervalDays: 180, supportsOverlap: true },
  { secretKey: "OBJECT_STORAGE_SECRET_KEY", purpose: "Object storage access key", owningService: "api, worker", owner: "Platform operations", rotationMethod: "Create a second access key, update the secret, restart, delete the old key", dependentServices: ["api", "worker"], rotationIntervalDays: 180, supportsOverlap: true },
  { secretKey: "BACKUP_REPO_CIPHER_PASS", purpose: "pgBackRest repository encryption passphrase (stored apart from the backups)", owningService: "db, backup-agent", owner: "Backup operator", rotationMethod: "Repository ciphers can't be changed in place: create a new repository with a new passphrase, back up to it, keep the old passphrase until its backups expire", dependentServices: ["db", "backup-agent"], rotationIntervalDays: 365, supportsOverlap: true },
  { secretKey: "BACKUP_OFFSITE_CREDENTIALS", purpose: "Off-site backup repository credentials (write-only where supported)", owningService: "backup-agent", owner: "Backup operator", rotationMethod: "Create a new key at the storage provider, update the secret, run a backup, delete the old key", dependentServices: ["backup-agent"], rotationIntervalDays: 180, supportsOverlap: true },
  { secretKey: "PLATFORM_AUTOMATION_TOKEN_PEPPER", purpose: "Pepper for hashing automation tokens", owningService: "api", owner: "Security administrator", rotationMethod: "Rotating invalidates every automation token: issue new tokens after rotation", dependentServices: ["api"], rotationIntervalDays: 365, supportsOverlap: false },
  { secretKey: "OAUTH_CLIENT_SECRETS", purpose: "Per-provider OAuth client secrets (stored encrypted in the vault)", owningService: "api", owner: "Integration administrator", rotationMethod: "Rotate at the provider, update the provider app in Integrations", dependentServices: ["api"], rotationIntervalDays: 365, supportsOverlap: true },
  { secretKey: "WEBHOOK_SIGNING_SECRETS", purpose: "Inbound and outbound webhook signing secrets (vault)", owningService: "api, worker", owner: "Integration administrator", rotationMethod: "Rotate per endpoint in Integrations (overlap window supported)", dependentServices: ["api", "worker"], rotationIntervalDays: 365, supportsOverlap: true },
  { secretKey: "AI_PROVIDER_KEYS", purpose: "AI provider API keys (vault, per organization)", owningService: "api, worker", owner: "AI administrator", rotationMethod: "AI Providers → Rotate key", dependentServices: ["api", "worker"], rotationIntervalDays: 180, supportsOverlap: false },
  { secretKey: "PAYMENT_PROVIDER_SECRETS", purpose: "Payment provider credentials (not connected yet)", owningService: "api", owner: "Finance administrator", rotationMethod: "Rotate at the provider; update the connection", dependentServices: ["api"], rotationIntervalDays: 180, supportsOverlap: true },
  { secretKey: "TLS_PRIVATE_KEY", purpose: "Reverse-proxy TLS private key (certificate metadata tracked here)", owningService: "proxy", owner: "Platform operations", rotationMethod: "Automatic renewal (ACME) or manual re-issue; reload the proxy", dependentServices: ["proxy"], rotationIntervalDays: 90, supportsOverlap: true },
];

export const ROTATION_STEPS = ["Started", "New version created", "Consumers accept new version", "Re-encrypted", "Verified", "Old version revoked", "Completed"];

export async function seedSecretInventory(environment = currentEnvironment()) {
  let created = 0;
  for (const s of SECRET_CATALOG) {
    const exists = await prisma.secretInventoryItem.findUnique({ where: { secretKey_environment: { secretKey: s.secretKey, environment } } });
    if (exists) continue;
    const now = new Date();
    await prisma.secretInventoryItem.create({ data: { ...s, environment, createdOn: now, nextRotationDue: new Date(now.getTime() + s.rotationIntervalDays * 86_400_000) } });
    created += 1;
  }
  return created;
}

export const serializeSecret = (s) => ({
  id: s.id, secretKey: s.secretKey, environment: s.environment, purpose: s.purpose, owningService: s.owningService, owner: s.owner,
  createdOn: s.createdOn, lastRotatedAt: s.lastRotatedAt, nextRotationDue: s.nextRotationDue, rotationIntervalDays: s.rotationIntervalDays,
  rotationMethod: s.rotationMethod, dependentServices: s.dependentServices, currentVersion: s.currentVersion, status: s.status, supportsOverlap: s.supportsOverlap, version: s.version,
});

// Vault material still using a key version (the "old version" can be
// revoked only when nothing depends on it).
export async function vaultUsageByKeyVersion() {
  const [creds, oauth, exports] = await Promise.all([
    prisma.integrationCredential.groupBy({ by: ["keyVersion"], where: { status: "Active" }, _count: { _all: true } }),
    prisma.integrationOAuthState.groupBy({ by: ["keyVersion"], where: { consumedAt: null, expiresAt: { gt: new Date() } }, _count: { _all: true } }),
    prisma.analyticsExportJob.groupBy({ by: ["fileKeyVersion"], where: { status: { in: ["Ready", "Downloaded"] } }, _count: { _all: true } }),
  ]);
  const out = {};
  for (const r of creds) out[r.keyVersion] = (out[r.keyVersion] || 0) + r._count._all;
  for (const r of oauth) out[r.keyVersion] = (out[r.keyVersion] || 0) + r._count._all;
  for (const r of exports) if (r.fileKeyVersion !== null) out[r.fileKeyVersion] = (out[r.fileKeyVersion] || 0) + r._count._all;
  return out;
}

// Advances a rotation by one step, in order. Values never pass through here:
// operators change the secret file on the host; this records and, where the
// application can, performs and verifies the step.
export async function advanceRotation(req, itemId, { step, reason, expectedVersion } = {}) {
  const item = await prisma.secretInventoryItem.findFirst({ where: { id: String(itemId), environment: currentEnvironment() } });
  if (!item) throw new PlatformError(404, "NOT_FOUND", "Secret not found.");
  if (expectedVersion !== undefined && Number(expectedVersion) !== item.version) throw new PlatformError(409, "VERSION_CONFLICT", "The secret record changed. Refresh and try again.");
  if (!ROTATION_STEPS.includes(step)) throw new PlatformError(422, "INVALID_STEP", `step must be one of: ${ROTATION_STEPS.join(", ")}.`);
  const last = await prisma.secretRotationEvent.findFirst({ where: { secretItemId: item.id }, orderBy: { createdAt: "desc" } });
  const inProgress = last && last.step !== "Completed" && last.step !== "Emergency revoked" && last.status !== "Failed";
  const expectedNext = inProgress ? ROTATION_STEPS[ROTATION_STEPS.indexOf(last.step) + 1] : "Started";
  // Re-encryption only applies to encryption keys; other secrets skip it.
  const skippable = step === "Verified" && expectedNext === "Re-encrypted" && item.secretKey !== "INTEGRATIONS_KEYS";
  if (step !== expectedNext && !skippable) throw new PlatformError(409, "OUT_OF_ORDER", `The next rotation step is "${expectedNext}".`);
  const detail = {};
  if (step === "Re-encrypted" && item.secretKey === "INTEGRATIONS_KEYS") Object.assign(detail, await rewrapCredentials());
  if (step === "Old version revoked" && item.secretKey === "INTEGRATIONS_KEYS") {
    const usage = await vaultUsageByKeyVersion();
    const active = activeKeyVersion();
    const stale = Object.entries(usage).filter(([v, n]) => Number(v) !== active && n > 0);
    if (stale.length) throw new PlatformError(409, "OLD_VERSION_IN_USE", `Old key versions are still in use (${stale.map(([v, n]) => `v${v}: ${n}`).join(", ")}). Re-encrypt or wait for exports to expire first.`);
    detail.activeKeyVersion = active;
  }
  const fromVersion = item.currentVersion;
  const toVersion = step === "New version created" ? item.currentVersion + 1 : item.currentVersion;
  const data = { version: { increment: 1 } };
  if (step === "Started") data.status = "Rotating";
  if (step === "New version created") data.currentVersion = toVersion;
  if (step === "Completed") Object.assign(data, { status: "Active", lastRotatedAt: new Date(), nextRotationDue: new Date(Date.now() + item.rotationIntervalDays * 86_400_000) });
  const updated = await prisma.secretInventoryItem.update({ where: { id: item.id }, data });
  const event = await prisma.secretRotationEvent.create({ data: { secretItemId: item.id, environment: item.environment, fromVersion, toVersion, step, status: "Recorded", actorUserId: req.user?.id || null, reason: reason ? String(reason).slice(0, 500) : null, correlationId: req.correlationId } });
  await platformAudit(req, "secret.rotation_step", "SecretInventoryItem", item.id, { reason, after: { secretKey: item.secretKey, step, toVersion, ...detail } });
  return { item: serializeSecret(updated), event, detail };
}

// Emergency revocation: marks the secret compromised, opens a critical
// finding and records the event. The runbook covers the host-side steps.
export async function emergencyRevoke(req, itemId, reason) {
  const item = await prisma.secretInventoryItem.findFirst({ where: { id: String(itemId), environment: currentEnvironment() } });
  if (!item) throw new PlatformError(404, "NOT_FOUND", "Secret not found.");
  if (String(reason || "").trim().length < 10) throw new PlatformError(422, "REASON_REQUIRED", "Describe why the secret is being revoked (at least 10 characters).");
  const updated = await prisma.secretInventoryItem.update({ where: { id: item.id }, data: { status: "Compromised", version: { increment: 1 } } });
  await prisma.secretRotationEvent.create({ data: { secretItemId: item.id, environment: item.environment, fromVersion: item.currentVersion, step: "Emergency revoked", status: "Recorded", actorUserId: req.user?.id || null, reason: String(reason).slice(0, 500), correlationId: req.correlationId } });
  const { recordFinding } = await import("./findings.js");
  await recordFinding({ category: "secret", source: "emergency-revocation", title: `Secret ${item.secretKey} reported compromised`, severity: "Critical", component: item.secretKey, fingerprint: `compromised:${item.secretKey}:${item.currentVersion}` });
  await platformAudit(req, "secret.emergency_revoked", "SecretInventoryItem", item.id, { reason, after: { secretKey: item.secretKey } });
  return serializeSecret(updated);
}

// Worker: secrets past their rotation date become "Rotation due".
export async function markRotationsDue(now = new Date()) {
  const { count } = await prisma.secretInventoryItem.updateMany({ where: { environment: currentEnvironment(), status: "Active", nextRotationDue: { lt: now } }, data: { status: "Rotation due" } });
  return count;
}

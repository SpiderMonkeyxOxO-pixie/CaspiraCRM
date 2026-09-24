// npm run integrations:verify-encryption
// Checks the integration master key without printing it: the keyring loads,
// a round trip works, a tampered ciphertext and a wrong binding are
// rejected, and no stored credential uses a key missing from the keyring.
// `--rewrap` re-encrypts credentials under the active key version (master-key
// rotation, see docs/BACKEND_PHASE8.md).
import "dotenv/config";
import prisma from "../src/lib/prisma.js";
import { assertVaultReady, encryptSecret, decryptSecret, integrationsMode } from "../src/integrations/credentials/vault.js";
import { rewrapCredentials } from "../src/integrations/credentials/credentialStore.js";

async function main() {
  const ring = assertVaultReady();
  console.log(`Mode: ${integrationsMode()} · active key version ${ring.activeVersion} · versions [${ring.versions.join(", ")}]${ring.devKey ? " · SIMULATOR DEV KEY (not for live data)" : ""}`);
  const sealed = encryptSecret("verification-probe", "verify|probe|test");
  if (decryptSecret(sealed, "verify|probe|test") !== "verification-probe") throw new Error("Round trip failed.");
  let rejected = 0;
  try { decryptSecret({ ...sealed, ciphertext: Buffer.from("tampered").toString("base64") }, "verify|probe|test"); } catch { rejected += 1; }
  try { decryptSecret(sealed, "verify|other|test"); } catch { rejected += 1; }
  if (rejected !== 2) throw new Error("Tampering was not detected.");
  console.log("AES-256-GCM round trip OK; tampered ciphertext and wrong binding rejected.");
  const byVersion = await prisma.integrationCredential.groupBy({ by: ["keyVersion"], where: { status: "Active" }, _count: { _all: true } });
  const missing = byVersion.filter((v) => !ring.versions.includes(v.keyVersion));
  console.log(`Active credentials by key version: ${byVersion.map((v) => `v${v.keyVersion}=${v._count._all}`).join(", ") || "none"}`);
  if (missing.length) throw new Error(`Credentials use key versions not in the keyring: ${missing.map((m) => m.keyVersion).join(", ")}.`);
  if (process.argv.includes("--rewrap")) console.log("Rewrap:", await rewrapCredentials());
}

main()
  .catch((err) => { console.error("Encryption check failed:", err.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());

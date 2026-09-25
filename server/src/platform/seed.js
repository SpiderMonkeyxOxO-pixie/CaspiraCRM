// Backend Phase 13 — idempotent platform seed: secret inventory metadata,
// backup policies, disaster-recovery plans and alert policies for the current
// environment. Safe on every worker start.
import { seedSecretInventory } from "./secretInventory.js";
import { seedBackupPolicies } from "./backups.js";
import { seedDrPlans } from "./disasterRecovery.js";
import { seedAlertPolicies } from "./alerts.js";

export async function ensurePlatformSeed() {
  return {
    secrets: await seedSecretInventory(),
    backupPolicies: await seedBackupPolicies(),
    drPlans: await seedDrPlans(),
    alertPolicies: await seedAlertPolicies(),
  };
}

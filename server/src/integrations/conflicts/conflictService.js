// Backend Phase 8 — conflicts: both the CRM record and the provider record
// changed since the last sync. A person decides; nothing is overwritten
// silently, and restricted values never appear to people who may not see
// them.
//
// Keep CRM             the CRM keeps its values; the provider change is marked seen
//                      (two-way configs send the CRM values on the next run).
// Keep Provider        the provider values are applied to the CRM record.
// Merge Selected Fields the chosen fields come from the provider, the rest stay.
// Skip                 nothing changes; the provider change is marked seen.
// Disconnect Mapping   the record stops syncing (the CRM record stays).
import prisma from "../../lib/prisma.js";
import { hasGrant } from "../../utils/grants.js";
import { IntegrationError, KINDS } from "../common/errors.js";
import { checksum, applyToCrm } from "../synchronization/transformers.js";

export const RESOLUTIONS = ["Keep CRM", "Keep Provider", "Merge Selected Fields", "Skip", "Disconnect Mapping"];

// Viewers without resolve rights or sensitive access see field names, not values.
export function serializeConflict(req, c) {
  const canSeeValues = req.isSystemOwnerOverride || hasGrant(req, "integration_conflicts", "resolve") || hasGrant(req, "integration_connections", "view_sensitive_fields");
  const mask = (vals) => Object.fromEntries(Object.keys(vals || {}).map((k) => [k, canSeeValues ? vals[k] : "[hidden]"]));
  return {
    _id: c.id, connectionId: c.connectionId, entityType: c.entityType, crmRecordId: c.crmRecordId, externalId: c.externalId, fields: c.fields,
    crmValues: mask(c.crmValues), providerValues: mask(c.providerValues), restrictedFields: c.restrictedFields, valuesVisible: canSeeValues,
    status: c.status, resolution: c.resolution, selectedFields: c.selectedFields, resolvedByMembershipId: c.resolvedByMembershipId, resolvedAt: c.resolvedAt,
    resolutionReason: c.resolutionReason, detectedAt: c.detectedAt,
  };
}

export async function resolveConflict(req, conflict, { resolution, selectedFields = [], reason = null }) {
  if (conflict.status !== "Open") throw new IntegrationError(KINDS.PERMANENT, "This conflict is already resolved.");
  if (!RESOLUTIONS.includes(resolution)) throw new IntegrationError(KINDS.PERMANENT, `resolution must be one of: ${RESOLUTIONS.join(", ")}.`);
  if (resolution === "Merge Selected Fields") {
    if (!Array.isArray(selectedFields) || !selectedFields.length) throw new IntegrationError(KINDS.PERMANENT, "Choose which fields to take from the provider.");
    const unknown = selectedFields.filter((f) => !(conflict.fields || []).includes(f));
    if (unknown.length) throw new IntegrationError(KINDS.PERMANENT, `Not conflicting fields: ${unknown.join(", ")}.`);
    if (selectedFields.some((f) => (conflict.restrictedFields || []).includes(f))) throw new IntegrationError(KINDS.POLICY, "Restricted fields can't be taken from the provider.");
  }
  if (resolution === "Keep Provider" && (conflict.restrictedFields || []).length) throw new IntegrationError(KINDS.POLICY, "The provider can't overwrite restricted CRM fields; use Merge Selected Fields for the others.");

  const mapping = await prisma.integrationRecordMapping.findUnique({ where: { id: conflict.mappingId } });
  const connection = await prisma.integrationConnection.findUnique({ where: { id: conflict.connectionId } });
  const providerSum = checksum(conflict.providerValues);
  await prisma.$transaction(async (tx) => {
    const now = new Date();
    if (resolution === "Keep Provider" || resolution === "Merge Selected Fields") {
      const fields = resolution === "Keep Provider" ? conflict.providerValues : { ...conflict.crmValues, ...Object.fromEntries(selectedFields.map((f) => [f, conflict.providerValues[f]])) };
      const config = await tx.integrationSyncConfiguration.findFirst({ where: { connectionId: conflict.connectionId, entityType: conflict.entityType } });
      await applyToCrm(tx, { entityType: conflict.entityType, connection, config, run: { id: `conflict-${conflict.id}`, initiatedByMembershipId: req.membership?.id || null, capability: config?.capability }, normalized: { externalId: conflict.externalId, fields }, existingId: mapping.crmRecordId, providerKey: connection.providerKey });
      await tx.integrationRecordMapping.update({ where: { id: mapping.id }, data: { syncState: "Active", lastInboundChecksum: resolution === "Keep Provider" ? providerSum : checksum(fields), lastSyncedAt: now, lastWriteOrigin: "Provider" } });
    } else if (resolution === "Disconnect Mapping") {
      await tx.integrationRecordMapping.update({ where: { id: mapping.id }, data: { syncState: "Disconnected", lastSyncedAt: now } });
    } else {
      // Keep CRM / Skip: the provider's change is acknowledged, the CRM record untouched.
      await tx.integrationRecordMapping.update({ where: { id: mapping.id }, data: { syncState: "Active", lastInboundChecksum: providerSum, lastSyncedAt: now } });
    }
    const updated = await tx.integrationConflict.updateMany({
      where: { id: conflict.id, status: "Open" },
      data: { status: "Resolved", resolution, selectedFields: resolution === "Merge Selected Fields" ? selectedFields : undefined, resolvedByMembershipId: req.membership?.id || null, resolvedAt: now, resolutionReason: reason },
    });
    if (updated.count !== 1) throw new IntegrationError(KINDS.TRANSIENT, "The conflict was resolved by someone else.", { status: 409 });
  });
  return prisma.integrationConflict.findUnique({ where: { id: conflict.id } });
}

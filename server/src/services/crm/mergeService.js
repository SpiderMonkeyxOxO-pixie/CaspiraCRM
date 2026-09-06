import prisma from "../../lib/prisma.js";
import { recordAuditEvent } from "../auditService.js";

const MERGEABLE_FIELDS = {
  Contact: ["name", "firstName", "lastName", "email", "phone", "jobTitle", "companyId", "lifecycleStage", "department", "ownerMembershipId", "preferredChannel", "preferredLanguage", "country", "region", "city", "timeZone"],
  Company: ["name", "legalName", "website", "industry", "companyType", "lifecycleStage", "accountStatus", "employeeSizeRange", "annualRevenueRange", "currency", "country", "region", "city", "addressLine1", "addressLine2", "postalCode", "ownerMembershipId", "team", "department"],
};

async function loadRecord(model, id, organizationId) {
  return prisma[model].findFirst({ where: { id, organizationId } });
}

// Preview only — never writes anything. Shows field conflicts (source has
// a value the destination doesn't already carry), the proposed winning
// value (destination's own value if set, else the source's), and what
// relationships/notes/tags/activities would move.
export async function mergePreview(recordType, organizationId, sourceId, destinationId) {
  const model = recordType === "Contact" ? "contact" : "company";
  const [source, destination] = await Promise.all([
    loadRecord(model, sourceId, organizationId),
    loadRecord(model, destinationId, organizationId),
  ]);
  if (!source || !destination) return { error: { status: 404, code: "CRM_RECORD_NOT_FOUND", message: "Source or destination record not found in this organization." } };
  if (source.id === destination.id) return { error: { status: 400, code: "CRM_MERGE_CONFLICT", message: "Source and destination must be different records." } };

  const fields = MERGEABLE_FIELDS[recordType];
  const fieldConflicts = fields
    .filter((f) => source[f] != null && destination[f] != null && source[f] !== destination[f])
    .map((f) => ({ field: f, sourceValue: source[f], destinationValue: destination[f], proposedWinner: destination[f] }));
  const fieldsToFill = fields
    .filter((f) => source[f] != null && destination[f] == null)
    .map((f) => ({ field: f, valueFromSource: source[f] }));

  const relField = model === "contact" ? "contactId" : "companyId";
  const [notesToMove, tagsToMove, activitiesToMove, relationshipsToMove] = await Promise.all([
    prisma.crmNote.count({ where: { [relField]: sourceId } }),
    prisma.crmRecordTag.count({ where: { [relField]: sourceId } }),
    model === "contact" ? prisma.activity.count({ where: { contactId: sourceId } }) : prisma.activity.count({ where: { companyId: sourceId } }),
    model === "contact" ? prisma.companyContactRelationship.count({ where: { contactId: sourceId } }) : prisma.companyContactRelationship.count({ where: { companyId: sourceId } }),
  ]);

  return {
    source, destination, fieldConflicts, fieldsToFill,
    impact: { notesToMove, tagsToMove, activitiesToMove, relationshipsToMove },
  };
}

// Requires: same organization (implicit — both loaded scoped to
// organizationId), a non-empty written reason, the destination's current
// `version` (optimistic concurrency), one transaction, never a hard
// delete. Idempotency is enforced at the route level
// (middleware/idempotency.js), same as lead conversion.
export async function merge({ recordType, organizationId, sourceId, destinationId, destinationVersion, reason, actorUserId, actorMembershipId, ipAddress, userAgent, correlationId }) {
  const model = recordType === "Contact" ? "contact" : "company";
  const relField = model === "contact" ? "contactId" : "companyId";

  return prisma.$transaction(async (tx) => {
    const [source, destination] = await Promise.all([
      tx[model].findFirst({ where: { id: sourceId, organizationId } }),
      tx[model].findFirst({ where: { id: destinationId, organizationId } }),
    ]);
    if (!source || !destination) return { error: { status: 404, code: "CRM_RECORD_NOT_FOUND", message: "Source or destination record not found in this organization." } };
    if (source.id === destination.id) return { error: { status: 400, code: "CRM_MERGE_CONFLICT", message: "Source and destination must be different records." } };
    if (source.archived) return { error: { status: 400, code: "CRM_MERGE_CONFLICT", message: "The source record has already been archived (possibly already merged)." } };
    if (Number(destinationVersion) !== destination.version) {
      return { error: { status: 409, code: "CRM_VERSION_CONFLICT", message: "The destination record was changed by someone else. Refresh and try again." } };
    }

    const fields = MERGEABLE_FIELDS[recordType];
    const fieldResolutions = {};
    const fill = {};
    fields.forEach((f) => {
      if (destination[f] == null && source[f] != null) {
        fill[f] = source[f];
        fieldResolutions[f] = { from: "source", value: source[f] };
      } else {
        fieldResolutions[f] = { from: "destination", value: destination[f] };
      }
    });

    // Reassign everything that pointed at the source over to the
    // destination — notes, tags, activities, and (for Contact/Company)
    // relationship rows — before archiving the source.
    await tx.crmNote.updateMany({ where: { [relField]: sourceId }, data: { [relField]: destinationId } });
    await tx.crmRecordTag.updateMany({ where: { [relField]: sourceId }, data: { [relField]: destinationId } });
    if (model === "contact") {
      await tx.activity.updateMany({ where: { contactId: sourceId }, data: { contactId: destinationId } });
      // Company relationships: move rows not already duplicated on the
      // destination (the unique [companyId, contactId] constraint would
      // otherwise reject a move where the destination already has a
      // relationship with that same company).
      const sourceRels = await tx.companyContactRelationship.findMany({ where: { contactId: sourceId } });
      for (const rel of sourceRels) {
        const clash = await tx.companyContactRelationship.findFirst({ where: { companyId: rel.companyId, contactId: destinationId } });
        if (clash) await tx.companyContactRelationship.delete({ where: { id: rel.id } });
        else await tx.companyContactRelationship.update({ where: { id: rel.id }, data: { contactId: destinationId } });
      }
    } else {
      await tx.activity.updateMany({ where: { companyId: sourceId }, data: { companyId: destinationId } });
      const sourceRels = await tx.companyContactRelationship.findMany({ where: { companyId: sourceId } });
      for (const rel of sourceRels) {
        const clash = await tx.companyContactRelationship.findFirst({ where: { companyId: destinationId, contactId: rel.contactId } });
        if (clash) await tx.companyContactRelationship.delete({ where: { id: rel.id } });
        else await tx.companyContactRelationship.update({ where: { id: rel.id }, data: { companyId: destinationId } });
      }
      // Legacy convenience FK on Contact.companyId — keep it pointed at a
      // real company after the merge.
      await tx.contact.updateMany({ where: { companyId: sourceId }, data: { companyId: destinationId } });
    }

    const updatedDestination = await tx[model].update({
      where: { id: destinationId },
      data: { ...fill, updatedByMembershipId: actorMembershipId, version: { increment: 1 } },
    });
    const archivedSource = await tx[model].update({
      where: { id: sourceId },
      data: { archived: true, archiveReason: `Merged into ${destinationId}`, archivedAt: new Date(), archivedByMembershipId: actorMembershipId, version: { increment: 1 } },
    });

    await tx.recordMerge.create({
      data: { organizationId, recordType, sourceRecordId: sourceId, destinationRecordId: destinationId, performedByMembershipId: actorMembershipId, reason, fieldResolutions },
    });

    await recordAuditEvent({
      tx, correlationId, actorUserId, actorMembershipId, organizationId,
      action: `crm.${model}.merged`, targetType: recordType, targetId: destinationId, result: "Success", reason,
      before: { sourceId, destinationId }, after: { fieldResolutions },
      ipAddress, userAgent,
    });

    return { destination: updatedDestination, source: archivedSource };
  });
}

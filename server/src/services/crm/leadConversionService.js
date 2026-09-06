import prisma from "../../lib/prisma.js";
import { recordAuditEvent } from "../auditService.js";
import { normalizeEmail, normalizePhone, normalizeName } from "./normalizationService.js";

// Explicitly human-initiated (never automatic), permission-checked by the
// caller (requireCrmOrgPermission("leads","convert")), transactional,
// idempotent (via middleware/idempotency.js at the route level),
// concurrency-safe, and audited. Never creates a Deal — that's Backend
// Phase 3's job entirely; this service doesn't accept dealName/dealValue/
// createDeal at all.
export async function convertLead({ organizationId, leadId, actorUserId, actorMembershipId, ipAddress, userAgent, correlationId, contactId: existingContactId, companyId: existingCompanyId, createContact = true, createCompany = true }) {
  return prisma.$transaction(async (tx) => {
    const lead = await tx.lead.findFirst({ where: { id: leadId, organizationId } });
    if (!lead) return { error: { status: 404, code: "CRM_RECORD_NOT_FOUND", message: "Lead not found." } };

    // Concurrency-safe: an atomic status-guarded update means two
    // simultaneous conversion requests for the same lead can't both
    // succeed — the second one finds zero rows to claim and is rejected,
    // exactly like invitation acceptance in Backend Phase 1.
    if (lead.convertedContactId || lead.status === "Converted") {
      return { error: { status: 409, code: "CRM_CONVERSION_CONFLICT", message: "This lead has already been converted." } };
    }
    const claim = await tx.lead.updateMany({ where: { id: leadId, organizationId, convertedContactId: null }, data: { status: "Converted" } });
    if (claim.count === 0) {
      return { error: { status: 409, code: "CRM_CONVERSION_CONFLICT", message: "This lead has already been converted." } };
    }

    // Never trust a client-supplied Contact/Company ID without confirming
    // it belongs to this same organization first.
    let contact = null;
    if (existingContactId) {
      contact = await tx.contact.findFirst({ where: { id: existingContactId, organizationId } });
      if (!contact) return { error: { status: 400, code: "CRM_OWNER_INVALID", message: "The specified contact does not belong to this organization." } };
    }
    let company = null;
    if (existingCompanyId) {
      company = await tx.company.findFirst({ where: { id: existingCompanyId, organizationId } });
      if (!company) return { error: { status: 400, code: "CRM_OWNER_INVALID", message: "The specified company does not belong to this organization." } };
    }

    if (!company && createCompany && lead.companyName) {
      company = await tx.company.create({
        data: {
          organizationId, name: lead.companyName, normalizedName: normalizeName(lead.companyName),
          ownerMembershipId: lead.ownerMembershipId, createdByMembershipId: actorMembershipId,
        },
      });
    }
    if (!contact && createContact) {
      contact = await tx.contact.create({
        data: {
          organizationId, name: lead.name || lead.email || "Unnamed Contact",
          email: lead.email, phone: lead.phone, companyId: company?.id || null, isPrimary: !!company,
          normalizedEmail: normalizeEmail(lead.email), normalizedPhone: normalizePhone(lead.phone),
          ownerMembershipId: lead.ownerMembershipId, createdByMembershipId: actorMembershipId,
        },
      });
      if (company) {
        await tx.companyContactRelationship.create({
          data: { companyId: company.id, contactId: contact.id, isPrimaryContact: true, relationshipType: "Customer" },
        });
      }
    }

    const updatedLead = await tx.lead.update({
      where: { id: leadId },
      data: {
        convertedContactId: contact?.id || null,
        convertedCompanyId: company?.id || null,
        convertedAt: new Date(),
        convertedByMembershipId: actorMembershipId,
        updatedByMembershipId: actorMembershipId,
        version: { increment: 1 },
      },
    });

    await recordAuditEvent({
      tx, correlationId, actorUserId, actorMembershipId, organizationId,
      action: "crm.lead.converted", targetType: "Lead", targetId: leadId, result: "Success",
      after: { convertedContactId: contact?.id, convertedCompanyId: company?.id },
      ipAddress, userAgent,
    });

    return { lead: updatedLead, contact, company };
  });
}

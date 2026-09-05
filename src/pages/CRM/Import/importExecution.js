// Converts a validated (and possibly corrected) import row into the exact
// payload shape the real Lead/Contact/Company/Deal create/update thunks
// already expect — the same field names the forms submit, so an imported
// record is indistinguishable from one entered by hand.
import { resolveCompanyByName, resolveContactByEmail, resolveOwner } from "./importValidation";

const OVERRIDE_REASON = "Imported via the CRM Import wizard frontend preview — duplicate already reviewed in the Duplicates step.";

export function buildCreatePayload(recordType, values) {
  const ownerId = values.ownerId ? resolveOwner(values.ownerId).ownerId || undefined : undefined;

  if (recordType === "leads") {
    return {
      firstName: values.firstName || undefined, lastName: values.lastName || undefined,
      companyName: values.companyName || undefined, email: values.email || undefined, phone: values.phone || undefined,
      source: values.source || "Website", status: values.status || "New", priority: values.priority || "Medium",
      estimatedValue: values.estimatedValue ? Number(values.estimatedValue) : undefined,
      currency: values.currency || "USD", ownerId,
      nextFollowUp: values.nextFollowUp ? new Date(values.nextFollowUp).toISOString() : undefined,
      tags: values.tags || [], duplicateOverride: true, overrideReason: OVERRIDE_REASON,
    };
  }
  if (recordType === "contacts") {
    const company = resolveCompanyByName(values.companyName);
    return {
      firstName: values.firstName || undefined, lastName: values.lastName || undefined,
      companyId: company?._id || null, jobTitle: values.jobTitle || undefined,
      email: values.email || undefined, phone: values.phone || undefined, country: values.country || undefined,
      preferredLanguage: values.preferredLanguage || "English", relationshipType: values.relationshipType || "Prospect",
      lifecycleStage: values.lifecycleStage || "New", ownerId, source: values.source || "Import", tags: values.tags || [],
      duplicateOverride: true, overrideReason: OVERRIDE_REASON,
    };
  }
  if (recordType === "companies") {
    return {
      name: values.name, primaryDomain: values.primaryDomain || undefined, website: values.website || undefined,
      industry: values.industry || undefined, companySize: values.companySize || undefined,
      accountType: values.accountType || "Prospect", lifecycleStage: values.lifecycleStage || "New",
      accountTier: values.accountTier || "Standard", ownerId, email: values.email || undefined, phone: values.phone || undefined,
      country: values.country || undefined, city: values.city || undefined,
      estimatedAnnualValue: values.estimatedAnnualValue ? Number(values.estimatedAnnualValue) : 0,
      currency: values.currency || "USD", tags: values.tags || [], source: values.source || "Import",
      duplicateOverride: true, overrideReason: OVERRIDE_REASON,
    };
  }
  if (recordType === "deals") {
    const company = resolveCompanyByName(values.companyName);
    const contact = values.primaryContactEmail ? resolveContactByEmail(values.primaryContactEmail, company?._id) : null;
    return {
      name: values.name, companyId: company?._id || null, primaryContactId: contact?._id || null,
      pipeline: values.pipeline || "New Business", stage: values.stage || "Discovery",
      value: values.value ? Number(values.value) : 0, currency: values.currency || "USD",
      probability: values.probability !== undefined && values.probability !== "" ? Number(values.probability) : undefined,
      expectedClosingDate: values.expectedClosingDate ? new Date(values.expectedClosingDate).toISOString() : undefined,
      ownerId, source: values.source || "Import", priority: values.priority || "Medium",
      nextAction: values.nextAction || undefined, tags: values.tags || [],
    };
  }
  return {};
}

// A conservative subset of fields for the "preview update existing" path —
// only overwrites fields the imported row actually provided a value for,
// so an update never blanks out data the existing record already had.
export function buildUpdatePayload(recordType, values) {
  const full = buildCreatePayload(recordType, values);
  const sparse = {};
  for (const [key, val] of Object.entries(full)) {
    if (["duplicateOverride", "overrideReason"].includes(key)) continue;
    if (val === undefined || val === null || val === "" || (Array.isArray(val) && val.length === 0)) continue;
    sparse[key] = val;
  }
  return sparse;
}

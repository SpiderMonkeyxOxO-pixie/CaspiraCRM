// Row construction + validation for the Import wizard. Every rule here
// mirrors the same-named validator already used by the Lead/Contact/
// Company/Deal forms (see mockApi.js's validateLeadPayload/
// validateContactPayload/validateCompanyPayload/validateDealPayload) — same
// field names, same required-field logic, same regexes — so an imported
// record can never end up under different rules than one entered by hand.
import { CRM_TEAM, isValidOwner } from "../../../Helpers/mockUsersData";
import { getRecordTypeConfig, CURRENCIES } from "./importConfig";
import { companies as fixtureCompanies, contacts as fixtureContacts } from "../../../Helpers/mockCrmData";
import { LEAD_STATUSES } from "../../../redux/crm/leadsSlice";
import { DEAL_STAGES } from "../../../redux/crm/dealsSlice";
import { applyTransform, splitFullName, splitTags, combineFirstLastName } from "./importTransforms";

export const FULL_NAME_VIRTUAL_KEY = "__fullName__";
export const IGNORE_KEY = "__ignore__";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(v) {
  return (v || "").trim().toLowerCase();
}
export function normalizePhone(v) {
  return (v || "").replace(/[^\d]/g, "");
}
function normalizeName(v) {
  return (v || "").trim().toLowerCase().replace(/\s+/g, " ");
}

// Case-insensitive match against a known enum, returning the canonical
// casing when found so a file that says "website" still resolves cleanly
// to the fixture value "Website".
export function resolveEnumValue(raw, enumValues) {
  if (!raw) return { value: "", matched: true };
  const exact = enumValues.find((v) => v === raw);
  if (exact) return { value: exact, matched: true };
  const ci = enumValues.find((v) => v.toLowerCase() === raw.toLowerCase());
  if (ci) return { value: ci, matched: true };
  return { value: raw, matched: false };
}

export function resolveOwner(raw) {
  if (!raw) return { ownerId: null, matched: true };
  if (isValidOwner(raw)) return { ownerId: raw, matched: true };
  const byName = CRM_TEAM.find((u) => u.name.toLowerCase() === raw.toLowerCase());
  if (byName) return { ownerId: byName.id, matched: true };
  return { ownerId: null, matched: false, raw };
}

export function resolveCompanyByName(name) {
  if (!name) return null;
  const q = name.trim().toLowerCase();
  return fixtureCompanies.find((c) => c.name.trim().toLowerCase() === q) || null;
}
export function resolveContactByEmail(email, companyId) {
  if (!email) return null;
  const q = normalizeEmail(email);
  const matches = fixtureContacts.filter((c) => normalizeEmail(c.email) === q);
  if (companyId) return matches.find((c) => c.companyId === companyId) || matches[0] || null;
  return matches[0] || null;
}

// ---------------------------------------------------------------------------
// Row construction — applies mapping + per-column transforms to raw source
// cells, producing the same field-name-shaped object the real forms submit.
// ---------------------------------------------------------------------------
export function buildRowValues(recordType, sourceRow, headers, mapping, transforms) {
  const config = getRecordTypeConfig(recordType);
  const values = {};
  headers.forEach((_, colIndex) => {
    const destKey = mapping[colIndex];
    if (!destKey || destKey === IGNORE_KEY) return;
    let raw = (sourceRow[colIndex] ?? "").toString();
    const transformKey = transforms[colIndex];
    if (transformKey) raw = applyTransform(transformKey, raw, {});
    if (destKey === FULL_NAME_VIRTUAL_KEY) {
      const { firstName, lastName } = splitFullName(raw);
      values.firstName = values.firstName || firstName;
      values.lastName = values.lastName || lastName;
      return;
    }
    const fieldDef = config.destinationFields.find((f) => f.key === destKey);
    values[destKey] = fieldDef?.multiValue ? splitTags(raw) : raw.trim();
  });
  return values;
}

export function computeRowIdentifier(recordType, values) {
  if (recordType === "companies") return values.name || "(no company name)";
  if (recordType === "deals") return values.name || "(no deal name)";
  const combined = combineFirstLastName(values.firstName, values.lastName);
  return combined || values.email || values.phone || "(no name)";
}

// ---------------------------------------------------------------------------
// Validation — one function per record type, deliberately mirroring the
// live-form validators field-for-field, plus the extra checks the Import
// wizard specifically needs (unknown enum values, unresolved lookups).
// ---------------------------------------------------------------------------
function baseChecks(values, errors, warnings) {
  if (values.currency && !CURRENCIES.includes(values.currency)) {
    warnings.currency = `Unknown currency "${values.currency}" — expected one of ${CURRENCIES.join(", ")}.`;
  }
  if (values.ownerId) {
    const resolved = resolveOwner(values.ownerId);
    if (!resolved.matched) warnings.ownerId = `Unknown owner "${values.ownerId}" — will be left unassigned.`;
  }
}

function validateLeadRow(values) {
  const errors = {}; const warnings = {};
  const hasPersonName = (values.firstName || values.lastName || "").trim().length > 0;
  const hasCompanyName = (values.companyName || "").trim().length > 0;
  if (!hasPersonName && !hasCompanyName) errors.name = "Provide a person name or a company name";
  const hasEmail = (values.email || "").trim().length > 0;
  const hasPhone = (values.phone || "").trim().length > 0;
  if (!hasEmail && !hasPhone) {
    errors.email = "Provide at least one contact method (email or phone)";
    errors.phone = "Provide at least one contact method (email or phone)";
  }
  if (hasEmail && !EMAIL_RE.test(values.email.trim())) errors.email = "Enter a valid email address";
  if (hasPhone && normalizePhone(values.phone).length < 7) warnings.phone = "This phone number looks too short to be valid.";
  if (values.estimatedValue !== undefined && values.estimatedValue !== "" && (Number.isNaN(Number(values.estimatedValue)) || Number(values.estimatedValue) < 0)) {
    errors.estimatedValue = "Estimated value must be a non-negative number";
  }
  if (values.nextFollowUp && Number.isNaN(new Date(values.nextFollowUp).getTime())) errors.nextFollowUp = "Enter a valid date";
  if (values.status && !LEAD_STATUSES.includes(values.status)) warnings.status = `Unknown status "${values.status}" — will default to New.`;
  baseChecks(values, errors, warnings);
  return { errors, warnings };
}

function validateContactRow(values) {
  const errors = {}; const warnings = {};
  const hasPersonName = (values.firstName || values.lastName || "").trim().length > 0;
  if (!hasPersonName) errors.name = "Provide a first or last name";
  const hasEmail = (values.email || "").trim().length > 0;
  const hasPhone = (values.phone || "").trim().length > 0;
  if (!hasEmail && !hasPhone) {
    errors.email = "Provide at least one contact method (email or phone)";
    errors.phone = "Provide at least one contact method (email or phone)";
  }
  if (hasEmail && !EMAIL_RE.test(values.email.trim())) errors.email = "Enter a valid email address";
  if (hasPhone && normalizePhone(values.phone).length < 7) warnings.phone = "This phone number looks too short to be valid.";
  if (values.companyName && !resolveCompanyByName(values.companyName)) {
    warnings.companyName = `No existing company matches "${values.companyName}" — this contact will be created without a company link.`;
  }
  baseChecks(values, errors, warnings);
  return { errors, warnings };
}

function validateCompanyRow(values) {
  const errors = {}; const warnings = {};
  if (!(values.name || "").trim()) errors.name = "Company name is required";
  if (values.website && values.website.trim() && !/^https?:\/\/.+\..+/.test(values.website.trim())) {
    warnings.website = "Website should include https:// to be considered a valid URL.";
  }
  if (values.email && values.email.trim() && !EMAIL_RE.test(values.email.trim())) errors.email = "Enter a valid email address";
  if (values.estimatedAnnualValue !== undefined && values.estimatedAnnualValue !== "" && (Number.isNaN(Number(values.estimatedAnnualValue)) || Number(values.estimatedAnnualValue) < 0)) {
    errors.estimatedAnnualValue = "Estimated annual value must be a non-negative number";
  }
  baseChecks(values, errors, warnings);
  return { errors, warnings };
}

function validateDealRow(values) {
  const errors = {}; const warnings = {};
  if (!(values.name || "").trim()) errors.name = "Deal name is required";
  const company = values.companyName ? resolveCompanyByName(values.companyName) : null;
  if (!(values.companyName || "").trim()) errors.companyName = "Company is required";
  else if (!company) errors.companyName = `No existing company matches "${values.companyName}" — a Deal cannot be created without a valid company.`;
  if (values.primaryContactEmail) {
    const contact = resolveContactByEmail(values.primaryContactEmail, company?._id);
    if (!contact) warnings.primaryContactEmail = `No existing contact matches "${values.primaryContactEmail}" — the deal will be created without a primary contact.`;
    else if (company && contact.companyId !== company._id) warnings.primaryContactEmail = "This contact belongs to a different company than the one matched for this deal.";
  }
  if (values.value !== undefined && values.value !== "" && (Number.isNaN(Number(values.value)) || Number(values.value) < 0)) {
    errors.value = "Deal value must be a non-negative number";
  }
  if (!(values.currency || "").trim()) errors.currency = "Currency is required";
  if (values.probability !== undefined && values.probability !== "") {
    const p = Number(values.probability);
    if (Number.isNaN(p) || p < 0 || p > 100) errors.probability = "Probability must be between 0 and 100";
  }
  if (values.expectedClosingDate && Number.isNaN(new Date(values.expectedClosingDate).getTime())) errors.expectedClosingDate = "Enter a valid date";
  if (values.stage && !DEAL_STAGES.includes(values.stage)) warnings.stage = `Unknown stage "${values.stage}" — will default to Discovery.`;
  baseChecks(values, errors, warnings);
  return { errors, warnings };
}

const VALIDATORS = { leads: validateLeadRow, contacts: validateContactRow, companies: validateCompanyRow, deals: validateDealRow };

export function validateRow(recordType, values) {
  return VALIDATORS[recordType] ? VALIDATORS[recordType](values) : { errors: {}, warnings: {} };
}

export function classifyRow(errors, warnings) {
  if (Object.keys(errors).length > 0) return "invalid";
  if (Object.keys(warnings).length > 0) return "warning";
  return "valid";
}

// ---------------------------------------------------------------------------
// In-file duplicate detection — rows within the SAME upload that look like
// the same record (checked independently of the fixture-duplicate step).
// ---------------------------------------------------------------------------
export function findInFileDuplicateRowIndexes(recordType, rowsValues) {
  const dupeIndexes = new Set();
  const seen = new Map();
  rowsValues.forEach((values, idx) => {
    let key;
    if (recordType === "companies") key = `name:${normalizeName(values.name)}`;
    else if (recordType === "deals") key = `deal:${normalizeName(values.name)}|${normalizeName(values.companyName)}`;
    else key = values.email ? `email:${normalizeEmail(values.email)}` : values.phone ? `phone:${normalizePhone(values.phone)}` : null;
    if (!key || key.endsWith(":")) return;
    if (seen.has(key)) {
      dupeIndexes.add(seen.get(key));
      dupeIndexes.add(idx);
    } else {
      seen.set(key, idx);
    }
  });
  return dupeIndexes;
}

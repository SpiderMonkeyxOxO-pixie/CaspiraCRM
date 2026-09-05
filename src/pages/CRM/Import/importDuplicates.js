// Matches parsed import rows against the SAME shared fixture arrays every
// completed CRM route already reads — never a separate import-only dataset.
// Never merges or updates anything here; this only produces preview
// comparisons for the user to decide on in the Duplicates step.
import { leads as fixtureLeads, contacts as fixtureContacts, companies as fixtureCompanies, deals as fixtureDeals } from "../../../Helpers/mockCrmData";
import { normalizeEmail, normalizePhone, resolveCompanyByName } from "./importValidation";

function deriveDomain(website) {
  try { return new URL(website).hostname.replace(/^www\./, ""); } catch { return ""; }
}

function confidenceFor(matches) {
  if (matches.includes("Email") || matches.includes("Domain") || matches.includes("Website Domain")) return "High";
  if (matches.length >= 2) return "High";
  if (matches.includes("Phone") || matches.includes("Company Name") || matches.includes("Company")) return "Medium";
  return "Low";
}

function diffFields(imported, existing, fieldMap) {
  const diffs = [];
  for (const [label, [importedKey, existingKey]] of Object.entries(fieldMap)) {
    const a = (imported[importedKey] ?? "").toString().trim();
    const b = (existing[existingKey] ?? "").toString().trim();
    if (a && b && a.toLowerCase() !== b.toLowerCase()) diffs.push({ field: label, imported: a, existing: b });
  }
  return diffs;
}

function findLeadOrContactDuplicates(values, fixtureList, isContact) {
  const email = normalizeEmail(values.email);
  const phone = normalizePhone(values.phone);
  const name = `${values.firstName || ""} ${values.lastName || ""}`.trim().toLowerCase();
  const company = (values.companyName || "").trim().toLowerCase();

  return fixtureList
    .filter((r) => !r.archived)
    .map((existing) => {
      const matches = [];
      if (email && normalizeEmail(existing.email) === email) matches.push("Email");
      if (phone && phone.length >= 7 && normalizePhone(existing.phone) === phone) matches.push("Phone");
      const existingName = (existing.name || "").trim().toLowerCase();
      const existingCompany = (existing.companyName || "").trim().toLowerCase();
      if (name && existingName === name && company && existingCompany === company) matches.push("Name + Company");
      if (!matches.length) return null;
      return {
        existing,
        matchingFields: matches,
        confidence: confidenceFor(matches),
        differences: diffFields(values, existing, isContact
          ? { Email: ["email", "email"], Phone: ["phone", "phone"], "Job Title": ["jobTitle", "jobTitle"] }
          : { Email: ["email", "email"], Phone: ["phone", "phone"] }),
      };
    })
    .filter(Boolean);
}

function findCompanyDuplicates(values) {
  const name = (values.name || "").trim().toLowerCase();
  const domain = (values.primaryDomain || deriveDomain(values.website || "")).trim().toLowerCase();
  const phone = normalizePhone(values.phone);

  return fixtureCompanies
    .filter((c) => !c.archived)
    .map((existing) => {
      const matches = [];
      if (name && existing.name.trim().toLowerCase() === name) matches.push("Company Name");
      if (domain && existing.primaryDomain && existing.primaryDomain.trim().toLowerCase() === domain) matches.push("Domain");
      if (phone && phone.length >= 7 && normalizePhone(existing.phone) === phone) matches.push("Phone");
      if (!matches.length) return null;
      return {
        existing, matchingFields: matches, confidence: confidenceFor(matches),
        differences: diffFields(values, existing, { Website: ["website", "website"], Industry: ["industry", "industry"], Phone: ["phone", "phone"] }),
      };
    })
    .filter(Boolean);
}

function sameExpectedClosePeriod(a, b) {
  if (!a || !b) return false;
  const da = new Date(a); const db = new Date(b);
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return false;
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth();
}

function findDealDuplicates(values) {
  const name = (values.name || "").trim().toLowerCase();
  const company = resolveCompanyByName(values.companyName);

  return fixtureDeals
    .filter((d) => !d.archived)
    .map((existing) => {
      const matches = [];
      if (name && existing.name.trim().toLowerCase() === name) matches.push("Deal Name");
      if (company && existing.companyId === company._id) matches.push("Company");
      if (sameExpectedClosePeriod(values.expectedClosingDate, existing.expectedClosingDate)) matches.push("Expected Closing Period");
      if (matches.length < 2) return null; // a single weak signal (e.g. company alone) isn't worth flagging for Deals
      return {
        existing, matchingFields: matches, confidence: confidenceFor(matches),
        differences: diffFields(values, existing, { Value: ["value", "value"], Stage: ["stage", "stage"] }),
      };
    })
    .filter(Boolean);
}

export function findFixtureDuplicates(recordType, values) {
  if (recordType === "leads") return findLeadOrContactDuplicates(values, fixtureLeads, false);
  if (recordType === "contacts") return findLeadOrContactDuplicates(values, fixtureContacts, true);
  if (recordType === "companies") return findCompanyDuplicates(values);
  if (recordType === "deals") return findDealDuplicates(values);
  return [];
}

export const DUPLICATE_DECISIONS = [
  { key: "skip", label: "Skip imported record" },
  { key: "createNew", label: "Create as new" },
  { key: "previewUpdate", label: "Preview update existing" },
  { key: "reviewManually", label: "Review manually" },
];

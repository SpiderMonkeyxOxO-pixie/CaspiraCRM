import prisma from "../../lib/prisma.js";

// Deterministic, documented, rule-ranked — never a fake confidence
// percentage. Every function here takes an ALREADY-AUTHORIZED organization
// scope (the caller resolved via requireCrmOrgPermission first) and never
// queries outside it, so a duplicate candidate can never surface a record
// from another organization or one the caller isn't authorized to see.
//
// Rules, in rank order (exact beats fuzzy):
//   1. exact normalizedEmail match
//   2. exact normalizedPhone match
//   3. same company/domain + fuzzy name similarity (pg_trgm, threshold 0.4)

const NAME_SIMILARITY_THRESHOLD = 0.4;

// `scopeWhere` is the SAME record-scope fragment (resolveCrmScopeWhere)
// applied to every other query for this caller — passed in explicitly
// rather than re-resolved here, so duplicate detection can never
// accidentally use a different (or missing) scope than the list/search
// endpoints and surface a record the caller isn't authorized to see.
export async function findLeadDuplicateCandidates(organizationId, lead, scopeWhere = {}) {
  const candidates = new Map();
  const addCandidate = (record, rule) => {
    const existing = candidates.get(record.id);
    if (existing) existing.matchedRules.push(rule);
    else candidates.set(record.id, { record, matchedRules: [rule] });
  };

  if (lead.normalizedEmail) {
    const matches = await prisma.lead.findMany({
      where: { organizationId, id: { not: lead.id }, normalizedEmail: lead.normalizedEmail, archived: false, ...scopeWhere },
    });
    matches.forEach((m) => addCandidate(m, "exact_email"));
  }
  if (lead.normalizedPhone) {
    const matches = await prisma.lead.findMany({
      where: { organizationId, id: { not: lead.id }, normalizedPhone: lead.normalizedPhone, archived: false, ...scopeWhere },
    });
    matches.forEach((m) => addCandidate(m, "exact_phone"));
  }
  if (lead.name) {
    // Raw SQL can't compose with a dynamic Prisma `where` object the same
    // way — fuzzy-name candidates get the DB-level org/archived filter,
    // then an explicit in-process re-check against the caller's scope IDs
    // (fetched via a normal Prisma query using the same scopeWhere) before
    // anything from this branch is ever added as a candidate.
    const scopedIds = scopeWhere && Object.keys(scopeWhere).length
      ? new Set((await prisma.lead.findMany({ where: { organizationId, archived: false, ...scopeWhere }, select: { id: true } })).map((r) => r.id))
      : null;
    const rows = await prisma.$queryRaw`
      SELECT id, name, "companyName", email, phone, status,
             similarity(lower(name), lower(${lead.name})) AS sim
      FROM leads
      WHERE "organizationId" = ${organizationId}
        AND id != ${lead.id}
        AND archived = false
        AND similarity(lower(name), lower(${lead.name})) >= ${NAME_SIMILARITY_THRESHOLD}
        AND ("companyName" = ${lead.companyName} OR ${lead.companyName}::text IS NULL)
    `;
    rows.filter((r) => !scopedIds || scopedIds.has(r.id)).forEach((r) => addCandidate(r, "fuzzy_name_same_company"));
  }

  // Exact matches rank above fuzzy — sort by whether any exact rule fired.
  return [...candidates.values()].sort((a, b) => {
    const aExact = a.matchedRules.some((r) => r.startsWith("exact_"));
    const bExact = b.matchedRules.some((r) => r.startsWith("exact_"));
    return aExact === bExact ? 0 : aExact ? -1 : 1;
  });
}

export async function findContactDuplicateCandidates(organizationId, contact, scopeWhere = {}) {
  const candidates = new Map();
  const addCandidate = (record, rule) => {
    const existing = candidates.get(record.id);
    if (existing) existing.matchedRules.push(rule);
    else candidates.set(record.id, { record, matchedRules: [rule] });
  };

  if (contact.normalizedEmail) {
    const matches = await prisma.contact.findMany({
      where: { organizationId, id: { not: contact.id }, normalizedEmail: contact.normalizedEmail, archived: false, ...scopeWhere },
    });
    matches.forEach((m) => addCandidate(m, "exact_email"));
  }
  if (contact.normalizedPhone) {
    const matches = await prisma.contact.findMany({
      where: { organizationId, id: { not: contact.id }, normalizedPhone: contact.normalizedPhone, archived: false, ...scopeWhere },
    });
    matches.forEach((m) => addCandidate(m, "exact_phone"));
  }
  if (contact.name) {
    const scopedIds = scopeWhere && Object.keys(scopeWhere).length
      ? new Set((await prisma.contact.findMany({ where: { organizationId, archived: false, ...scopeWhere }, select: { id: true } })).map((r) => r.id))
      : null;
    const rows = await prisma.$queryRaw`
      SELECT id, name, email, phone, "companyId", status,
             similarity(lower(name), lower(${contact.name})) AS sim
      FROM contacts
      WHERE "organizationId" = ${organizationId}
        AND id != ${contact.id}
        AND archived = false
        AND similarity(lower(name), lower(${contact.name})) >= ${NAME_SIMILARITY_THRESHOLD}
        AND ("companyId" = ${contact.companyId} OR ${contact.companyId}::text IS NULL)
    `;
    rows.filter((r) => !scopedIds || scopedIds.has(r.id)).forEach((r) => addCandidate(r, "fuzzy_name_same_company"));
  }

  return [...candidates.values()].sort((a, b) => {
    const aExact = a.matchedRules.some((r) => r.startsWith("exact_"));
    const bExact = b.matchedRules.some((r) => r.startsWith("exact_"));
    return aExact === bExact ? 0 : aExact ? -1 : 1;
  });
}

export async function findCompanyDuplicateCandidates(organizationId, company, scopeWhere = {}) {
  const candidates = new Map();
  const addCandidate = (record, rule) => {
    const existing = candidates.get(record.id);
    if (existing) existing.matchedRules.push(rule);
    else candidates.set(record.id, { record, matchedRules: [rule] });
  };

  if (company.normalizedDomain) {
    const matches = await prisma.company.findMany({
      where: { organizationId, id: { not: company.id }, normalizedDomain: company.normalizedDomain, archived: false, ...scopeWhere },
    });
    matches.forEach((m) => addCandidate(m, "exact_domain"));
  }
  if (company.normalizedName) {
    const matches = await prisma.company.findMany({
      where: { organizationId, id: { not: company.id }, normalizedName: company.normalizedName, archived: false, ...scopeWhere },
    });
    matches.forEach((m) => addCandidate(m, "exact_name"));

    const scopedIds = scopeWhere && Object.keys(scopeWhere).length
      ? new Set((await prisma.company.findMany({ where: { organizationId, archived: false, ...scopeWhere }, select: { id: true } })).map((r) => r.id))
      : null;
    const rows = await prisma.$queryRaw`
      SELECT id, name, website, phone, city, status,
             similarity(lower(name), lower(${company.name})) AS sim
      FROM companies
      WHERE "organizationId" = ${organizationId}
        AND id != ${company.id}
        AND archived = false
        AND similarity(lower(name), lower(${company.name})) >= ${NAME_SIMILARITY_THRESHOLD}
    `;
    rows.filter((r) => !scopedIds || scopedIds.has(r.id)).forEach((r) => addCandidate(r, "fuzzy_name"));
  }
  if (company.phone) {
    const matches = await prisma.company.findMany({
      where: { organizationId, id: { not: company.id }, phone: company.phone, archived: false, ...scopeWhere },
    });
    matches.forEach((m) => addCandidate(m, "matching_phone"));
  }

  return [...candidates.values()].sort((a, b) => {
    const aExact = a.matchedRules.some((r) => r.startsWith("exact_"));
    const bExact = b.matchedRules.some((r) => r.startsWith("exact_"));
    return aExact === bExact ? 0 : aExact ? -1 : 1;
  });
}

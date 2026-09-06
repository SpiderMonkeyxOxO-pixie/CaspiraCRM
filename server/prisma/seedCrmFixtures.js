// Idempotent CRM fixture import for LOCAL DEVELOPMENT ONLY — never run in
// production. Mirrors the *shape* of the frontend's mockCrmData.js fixtures
// (field names, lifecycle stages, sources) as a small, explicitly-labeled,
// hand-curated dataset rather than a port of the frontend's faker-random
// generator (which produces different random data every run and isn't a
// legitimate "migration source").
//
// Idempotency: since Lead/Contact/Company have no natural unique key of
// their own, each fixture is looked up by (organizationId, normalizedEmail)
// or (organizationId, normalizedDomain) before creating — rerunning this
// script against the same organization never creates duplicates. This is
// an application-level dedup for fixture purposes only, not a DB
// constraint (real user-entered records may legitimately share an email
// today per the existing schema).
//
// Usage: CRM_FIXTURE_ORG_ID=<real org id> node prisma/seedCrmFixtures.js
// Run only when explicitly requested — this is NOT part of `prisma db seed`.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { normalizeEmail, normalizeDomain, normalizeName } from "../src/services/crm/normalizationService.js";

const prisma = new PrismaClient();

const FIXTURE_COMPANIES = [
  { name: "Northwind Analytics", legalName: "Northwind Analytics Inc.", website: "northwindanalytics.example", companyType: "Prospect", accountStatus: "Active", employeeSizeRange: "51-200", annualRevenueRange: "$5M-$20M", currency: "USD" },
  { name: "Bluepeak Logistics", legalName: "Bluepeak Logistics LLC", website: "bluepeaklogistics.example", companyType: "Customer", accountStatus: "Active", employeeSizeRange: "201-500", annualRevenueRange: "$20M-$100M", currency: "USD" },
];

const FIXTURE_CONTACTS = [
  { firstName: "Elena", lastName: "Vasquez", email: "elena.vasquez@northwindanalytics.example", jobTitle: "VP of Operations", lifecycleStage: "Engaged", companyName: "Northwind Analytics" },
  { firstName: "Marcus", lastName: "Chen", email: "marcus.chen@bluepeaklogistics.example", jobTitle: "Procurement Manager", lifecycleStage: "Active", companyName: "Bluepeak Logistics" },
];

const FIXTURE_LEADS = [
  { name: "Fixture Lead — Priya Desai", email: "priya.desai@newventure.example", companyName: "New Venture Studio", status: "New", source: "Website", lifecycleStage: "New" },
  { name: "Fixture Lead — Tom Reilly", email: "tom.reilly@reillyconsulting.example", companyName: "Reilly Consulting", status: "Qualified", source: "Referral", lifecycleStage: "Engaged" },
];

async function findOrCreateCompany(organizationId, ownerMembershipId, fixture) {
  const normalizedDomain = normalizeDomain(fixture.website);
  const existing = await prisma.company.findFirst({ where: { organizationId, normalizedDomain } });
  if (existing) return existing;
  return prisma.company.create({
    data: {
      organizationId, name: fixture.name, legalName: fixture.legalName, normalizedName: normalizeName(fixture.name),
      website: fixture.website, normalizedDomain, companyType: fixture.companyType, accountStatus: fixture.accountStatus,
      employeeSizeRange: fixture.employeeSizeRange, annualRevenueRange: fixture.annualRevenueRange, currency: fixture.currency,
      ownerMembershipId, createdByMembershipId: ownerMembershipId, updatedByMembershipId: ownerMembershipId,
    },
  });
}

async function findOrCreateContact(organizationId, ownerMembershipId, fixture, companyId) {
  const normalizedEmail = normalizeEmail(fixture.email);
  const existing = await prisma.contact.findFirst({ where: { organizationId, normalizedEmail } });
  if (existing) return existing;
  return prisma.contact.create({
    data: {
      organizationId, firstName: fixture.firstName, lastName: fixture.lastName, name: `${fixture.firstName} ${fixture.lastName}`,
      displayName: `${fixture.firstName} ${fixture.lastName}`, email: fixture.email, normalizedEmail, jobTitle: fixture.jobTitle,
      lifecycleStage: fixture.lifecycleStage, companyId: companyId || null, isPrimary: !!companyId,
      ownerMembershipId, createdByMembershipId: ownerMembershipId, updatedByMembershipId: ownerMembershipId,
    },
  });
}

async function findOrCreateLead(organizationId, ownerMembershipId, fixture) {
  const normalizedEmail = normalizeEmail(fixture.email);
  const existing = await prisma.lead.findFirst({ where: { organizationId, normalizedEmail } });
  if (existing) return existing;
  return prisma.lead.create({
    data: {
      organizationId, name: fixture.name, displayName: fixture.name, email: fixture.email, normalizedEmail,
      companyName: fixture.companyName, status: fixture.status, source: fixture.source, lifecycleStage: fixture.lifecycleStage,
      ownerMembershipId, createdByMembershipId: ownerMembershipId, updatedByMembershipId: ownerMembershipId,
    },
  });
}

async function main() {
  const organizationId = process.env.CRM_FIXTURE_ORG_ID;
  if (!organizationId) {
    console.error("CRM_FIXTURE_ORG_ID is required — this script never guesses which organization to seed.");
    process.exit(1);
  }
  if (process.env.NODE_ENV === "production") {
    console.error("Refusing to run fixture import with NODE_ENV=production.");
    process.exit(1);
  }

  const organization = await prisma.organization.findUnique({ where: { id: organizationId } });
  if (!organization) {
    console.error(`No organization found with id ${organizationId}.`);
    process.exit(1);
  }

  const membership = await prisma.organizationMembership.findFirst({ where: { organizationId, status: "Active" }, orderBy: { createdAt: "asc" } });
  if (!membership) {
    console.error(`Organization ${organizationId} has no active membership to own the fixture records.`);
    process.exit(1);
  }

  console.log(`Importing CRM fixtures into "${organization.name}" (${organizationId}), owned by membership ${membership.id}...`);

  const companies = {};
  for (const fixture of FIXTURE_COMPANIES) {
    companies[fixture.name] = await findOrCreateCompany(organizationId, membership.id, fixture);
  }

  for (const fixture of FIXTURE_CONTACTS) {
    await findOrCreateContact(organizationId, membership.id, fixture, companies[fixture.companyName]?.id);
  }

  for (const fixture of FIXTURE_LEADS) {
    await findOrCreateLead(organizationId, membership.id, fixture);
  }

  console.log(`Done. ${FIXTURE_COMPANIES.length} companies, ${FIXTURE_CONTACTS.length} contacts, ${FIXTURE_LEADS.length} leads checked/imported (idempotent — rerun freely).`);
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());

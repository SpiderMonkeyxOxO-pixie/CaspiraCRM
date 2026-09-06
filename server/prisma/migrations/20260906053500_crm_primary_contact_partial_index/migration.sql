-- Enforce "at most one ACTIVE primary Contact per Company" at the database
-- level, not just in application logic — Prisma's schema DSL has no
-- partial-index syntax, so this is hand-written rather than generated.
-- "Active" here means isPrimaryContact = true AND endDate IS NULL (an
-- ended relationship is historical, not a live claim on the primary slot).
CREATE UNIQUE INDEX "company_contact_relationships_one_active_primary"
  ON "company_contact_relationships" ("companyId")
  WHERE "isPrimaryContact" = true AND "endDate" IS NULL;

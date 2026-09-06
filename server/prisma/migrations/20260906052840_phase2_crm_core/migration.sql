-- AlterTable
ALTER TABLE "activities" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "assignedMembershipId" TEXT,
ADD COLUMN     "createdByMembershipId" TEXT,
ADD COLUMN     "followUpActivityId" TEXT,
ADD COLUMN     "followUpDate" TIMESTAMP(3),
ADD COLUMN     "followUpRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "leadId" TEXT,
ADD COLUMN     "organizationId" TEXT,
ADD COLUMN     "outcome" TEXT,
ADD COLUMN     "ownerMembershipId" TEXT,
ADD COLUMN     "scheduledEnd" TIMESTAMP(3),
ADD COLUMN     "scheduledStart" TIMESTAMP(3),
ADD COLUMN     "source" TEXT,
ADD COLUMN     "updatedByMembershipId" TEXT,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "accountStatus" TEXT,
ADD COLUMN     "addressLine2" TEXT,
ADD COLUMN     "annualRevenueRange" TEXT,
ADD COLUMN     "archivedByMembershipId" TEXT,
ADD COLUMN     "companyType" TEXT,
ADD COLUMN     "createdByMembershipId" TEXT,
ADD COLUMN     "currency" TEXT,
ADD COLUMN     "department" TEXT,
ADD COLUMN     "employeeSizeRange" TEXT,
ADD COLUMN     "legalName" TEXT,
ADD COLUMN     "normalizedDomain" TEXT,
ADD COLUMN     "normalizedName" TEXT,
ADD COLUMN     "organizationId" TEXT,
ADD COLUMN     "ownerMembershipId" TEXT,
ADD COLUMN     "region" TEXT,
ADD COLUMN     "team" TEXT,
ADD COLUMN     "updatedByMembershipId" TEXT,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "archivedByMembershipId" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "country" TEXT,
ADD COLUMN     "createdByMembershipId" TEXT,
ADD COLUMN     "department" TEXT,
ADD COLUMN     "displayName" TEXT,
ADD COLUMN     "emailOptIn" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastContactDate" TIMESTAMP(3),
ADD COLUMN     "lifecycleStage" TEXT,
ADD COLUMN     "marketingOptIn" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "normalizedEmail" TEXT,
ADD COLUMN     "normalizedPhone" TEXT,
ADD COLUMN     "organizationId" TEXT,
ADD COLUMN     "ownerMembershipId" TEXT,
ADD COLUMN     "phoneOptIn" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "preferredChannel" TEXT,
ADD COLUMN     "preferredLanguage" TEXT,
ADD COLUMN     "region" TEXT,
ADD COLUMN     "smsOptIn" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "timeZone" TEXT,
ADD COLUMN     "updatedByMembershipId" TEXT,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "archivedByMembershipId" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "convertedAt" TIMESTAMP(3),
ADD COLUMN     "convertedByMembershipId" TEXT,
ADD COLUMN     "country" TEXT,
ADD COLUMN     "createdByMembershipId" TEXT,
ADD COLUMN     "currency" TEXT,
ADD COLUMN     "department" TEXT,
ADD COLUMN     "displayName" TEXT,
ADD COLUMN     "doNotContact" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "estimatedValue" DOUBLE PRECISION,
ADD COLUMN     "lastContactDate" TIMESTAMP(3),
ADD COLUMN     "lifecycleStage" TEXT,
ADD COLUMN     "nextActionDate" TIMESTAMP(3),
ADD COLUMN     "nextActionText" TEXT,
ADD COLUMN     "normalizedEmail" TEXT,
ADD COLUMN     "normalizedPhone" TEXT,
ADD COLUMN     "organizationId" TEXT,
ADD COLUMN     "ownerMembershipId" TEXT,
ADD COLUMN     "qualificationStatus" TEXT,
ADD COLUMN     "region" TEXT,
ADD COLUMN     "team" TEXT,
ADD COLUMN     "updatedByMembershipId" TEXT,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "crm_notes" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "authorMembershipId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "edited" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "leadId" TEXT,
    "contactId" TEXT,
    "companyId" TEXT,
    "activityId" TEXT,

    CONSTRAINT "crm_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_tags" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "colorToken" TEXT,
    "createdByMembershipId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_record_tags" (
    "id" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leadId" TEXT,
    "contactId" TEXT,
    "companyId" TEXT,
    "activityId" TEXT,

    CONSTRAINT "crm_record_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_contact_relationships" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "relationshipType" TEXT,
    "jobTitleAtCompany" TEXT,
    "isDecisionMaker" BOOLEAN NOT NULL DEFAULT false,
    "isPrimaryContact" BOOLEAN NOT NULL DEFAULT false,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_contact_relationships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "record_merges" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "recordType" TEXT NOT NULL,
    "sourceRecordId" TEXT NOT NULL,
    "destinationRecordId" TEXT NOT NULL,
    "performedByMembershipId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "fieldResolutions" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "record_merges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "crm_notes_organizationId_idx" ON "crm_notes"("organizationId");

-- CreateIndex
CREATE INDEX "crm_notes_leadId_idx" ON "crm_notes"("leadId");

-- CreateIndex
CREATE INDEX "crm_notes_contactId_idx" ON "crm_notes"("contactId");

-- CreateIndex
CREATE INDEX "crm_notes_companyId_idx" ON "crm_notes"("companyId");

-- CreateIndex
CREATE INDEX "crm_notes_activityId_idx" ON "crm_notes"("activityId");

-- CreateIndex
CREATE UNIQUE INDEX "crm_tags_organizationId_normalizedName_key" ON "crm_tags"("organizationId", "normalizedName");

-- CreateIndex
CREATE INDEX "crm_record_tags_leadId_idx" ON "crm_record_tags"("leadId");

-- CreateIndex
CREATE INDEX "crm_record_tags_contactId_idx" ON "crm_record_tags"("contactId");

-- CreateIndex
CREATE INDEX "crm_record_tags_companyId_idx" ON "crm_record_tags"("companyId");

-- CreateIndex
CREATE INDEX "crm_record_tags_activityId_idx" ON "crm_record_tags"("activityId");

-- CreateIndex
CREATE UNIQUE INDEX "crm_record_tags_tagId_leadId_key" ON "crm_record_tags"("tagId", "leadId");

-- CreateIndex
CREATE UNIQUE INDEX "crm_record_tags_tagId_contactId_key" ON "crm_record_tags"("tagId", "contactId");

-- CreateIndex
CREATE UNIQUE INDEX "crm_record_tags_tagId_companyId_key" ON "crm_record_tags"("tagId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "crm_record_tags_tagId_activityId_key" ON "crm_record_tags"("tagId", "activityId");

-- CreateIndex
CREATE INDEX "company_contact_relationships_companyId_idx" ON "company_contact_relationships"("companyId");

-- CreateIndex
CREATE INDEX "company_contact_relationships_contactId_idx" ON "company_contact_relationships"("contactId");

-- CreateIndex
CREATE UNIQUE INDEX "company_contact_relationships_companyId_contactId_key" ON "company_contact_relationships"("companyId", "contactId");

-- CreateIndex
CREATE INDEX "record_merges_organizationId_idx" ON "record_merges"("organizationId");

-- CreateIndex
CREATE INDEX "record_merges_destinationRecordId_idx" ON "record_merges"("destinationRecordId");

-- CreateIndex
CREATE INDEX "activities_organizationId_idx" ON "activities"("organizationId");

-- CreateIndex
CREATE INDEX "activities_leadId_idx" ON "activities"("leadId");

-- CreateIndex
CREATE INDEX "activities_status_idx" ON "activities"("status");

-- CreateIndex
CREATE INDEX "activities_dueDate_idx" ON "activities"("dueDate");

-- CreateIndex
CREATE INDEX "activities_scheduledStart_idx" ON "activities"("scheduledStart");

-- CreateIndex
CREATE INDEX "activities_ownerMembershipId_idx" ON "activities"("ownerMembershipId");

-- CreateIndex
CREATE INDEX "activities_assignedMembershipId_idx" ON "activities"("assignedMembershipId");

-- CreateIndex
CREATE INDEX "activities_updatedAt_idx" ON "activities"("updatedAt");

-- CreateIndex
CREATE INDEX "companies_organizationId_idx" ON "companies"("organizationId");

-- CreateIndex
CREATE INDEX "companies_normalizedDomain_idx" ON "companies"("normalizedDomain");

-- CreateIndex
CREATE INDEX "companies_lifecycleStage_idx" ON "companies"("lifecycleStage");

-- CreateIndex
CREATE INDEX "companies_accountStatus_idx" ON "companies"("accountStatus");

-- CreateIndex
CREATE INDEX "companies_ownerMembershipId_idx" ON "companies"("ownerMembershipId");

-- CreateIndex
CREATE INDEX "companies_archived_idx" ON "companies"("archived");

-- CreateIndex
CREATE INDEX "companies_updatedAt_idx" ON "companies"("updatedAt");

-- CreateIndex
CREATE INDEX "contacts_organizationId_idx" ON "contacts"("organizationId");

-- CreateIndex
CREATE INDEX "contacts_normalizedEmail_idx" ON "contacts"("normalizedEmail");

-- CreateIndex
CREATE INDEX "contacts_normalizedPhone_idx" ON "contacts"("normalizedPhone");

-- CreateIndex
CREATE INDEX "contacts_lifecycleStage_idx" ON "contacts"("lifecycleStage");

-- CreateIndex
CREATE INDEX "contacts_ownerMembershipId_idx" ON "contacts"("ownerMembershipId");

-- CreateIndex
CREATE INDEX "contacts_archived_idx" ON "contacts"("archived");

-- CreateIndex
CREATE INDEX "contacts_updatedAt_idx" ON "contacts"("updatedAt");

-- CreateIndex
CREATE INDEX "leads_organizationId_idx" ON "leads"("organizationId");

-- CreateIndex
CREATE INDEX "leads_normalizedEmail_idx" ON "leads"("normalizedEmail");

-- CreateIndex
CREATE INDEX "leads_normalizedPhone_idx" ON "leads"("normalizedPhone");

-- CreateIndex
CREATE INDEX "leads_status_idx" ON "leads"("status");

-- CreateIndex
CREATE INDEX "leads_lifecycleStage_idx" ON "leads"("lifecycleStage");

-- CreateIndex
CREATE INDEX "leads_ownerMembershipId_idx" ON "leads"("ownerMembershipId");

-- CreateIndex
CREATE INDEX "leads_archived_idx" ON "leads"("archived");

-- CreateIndex
CREATE INDEX "leads_updatedAt_idx" ON "leads"("updatedAt");

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_ownerMembershipId_fkey" FOREIGN KEY ("ownerMembershipId") REFERENCES "organization_memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_ownerMembershipId_fkey" FOREIGN KEY ("ownerMembershipId") REFERENCES "organization_memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_ownerMembershipId_fkey" FOREIGN KEY ("ownerMembershipId") REFERENCES "organization_memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_followUpActivityId_fkey" FOREIGN KEY ("followUpActivityId") REFERENCES "activities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_ownerMembershipId_fkey" FOREIGN KEY ("ownerMembershipId") REFERENCES "organization_memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_assignedMembershipId_fkey" FOREIGN KEY ("assignedMembershipId") REFERENCES "organization_memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_notes" ADD CONSTRAINT "crm_notes_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_notes" ADD CONSTRAINT "crm_notes_authorMembershipId_fkey" FOREIGN KEY ("authorMembershipId") REFERENCES "organization_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_notes" ADD CONSTRAINT "crm_notes_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_notes" ADD CONSTRAINT "crm_notes_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_notes" ADD CONSTRAINT "crm_notes_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_notes" ADD CONSTRAINT "crm_notes_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "activities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_tags" ADD CONSTRAINT "crm_tags_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_record_tags" ADD CONSTRAINT "crm_record_tags_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "crm_tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_record_tags" ADD CONSTRAINT "crm_record_tags_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_record_tags" ADD CONSTRAINT "crm_record_tags_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_record_tags" ADD CONSTRAINT "crm_record_tags_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_record_tags" ADD CONSTRAINT "crm_record_tags_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "activities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_contact_relationships" ADD CONSTRAINT "company_contact_relationships_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_contact_relationships" ADD CONSTRAINT "company_contact_relationships_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "record_merges" ADD CONSTRAINT "record_merges_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

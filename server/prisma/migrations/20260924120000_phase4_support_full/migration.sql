-- AlterTable
ALTER TABLE "ticket_messages" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "authorContactId" TEXT,
ADD COLUMN     "authorPortalAccountId" TEXT,
ADD COLUMN     "authorType" TEXT NOT NULL DEFAULT 'Agent',
ADD COLUMN     "deliveryStatus" TEXT NOT NULL DEFAULT 'Not Applicable',
ADD COLUMN     "editedAt" TIMESTAMP(3),
ADD COLUMN     "messageType" TEXT NOT NULL DEFAULT 'Agent Reply',
ADD COLUMN     "sanitizedBody" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'Agent Console',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "visibility" TEXT NOT NULL DEFAULT 'Customer Visible';

-- AlterTable
ALTER TABLE "tickets" ADD COLUMN     "archiveReason" TEXT,
ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "archivedByMembershipId" TEXT,
ADD COLUMN     "cancellationReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "categoryId" TEXT,
ADD COLUMN     "entitlementId" TEXT,
ADD COLUMN     "inboxId" TEXT,
ADD COLUMN     "mergedIntoTicketId" TEXT,
ADD COLUMN     "normalizedSubject" TEXT,
ADD COLUMN     "ownerMembershipId" TEXT,
ADD COLUMN     "portalAccountId" TEXT,
ADD COLUMN     "queueId" TEXT,
ADD COLUMN     "relatedContractId" TEXT,
ADD COLUMN     "relatedDealId" TEXT,
ADD COLUMN     "relatedLeadId" TEXT,
ADD COLUMN     "relatedOrderId" TEXT,
ADD COLUMN     "reopenedAt" TIMESTAMP(3),
ADD COLUMN     "resolutionCode" TEXT,
ADD COLUMN     "slaPolicyVersionId" TEXT,
ADD COLUMN     "statusBeforeArchive" TEXT,
ADD COLUMN     "subcategoryId" TEXT,
ADD COLUMN     "team" TEXT,
ADD COLUMN     "waitingReason" TEXT;

-- CreateTable
CREATE TABLE "ticket_events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "actorType" TEXT NOT NULL DEFAULT 'Agent',
    "actorMembershipId" TEXT,
    "actorPortalAccountId" TEXT,
    "fromValue" TEXT,
    "toValue" TEXT,
    "reason" TEXT,
    "snapshot" JSONB NOT NULL DEFAULT '{}',
    "customerVisible" BOOLEAN NOT NULL DEFAULT false,
    "dedupeKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_inboxes" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "channelType" TEXT NOT NULL DEFAULT 'Manual',
    "defaultQueueId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "customerDisplayName" TEXT,
    "createdByMembershipId" TEXT,
    "updatedByMembershipId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "support_inboxes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_queues" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "department" TEXT,
    "team" TEXT,
    "defaultSlaPolicyId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "assignmentMode" TEXT NOT NULL DEFAULT 'Manual',
    "lastAssignedMembershipId" TEXT,
    "createdByMembershipId" TEXT,
    "updatedByMembershipId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "support_queues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_queue_members" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "queueId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'Agent',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "capacity" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_queue_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_categories" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "description" TEXT,
    "parentId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "defaultQueueId" TEXT,
    "defaultPriority" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "ticket_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_followers" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "addedByMembershipId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_followers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_accounts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "companyId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Invited',
    "companyWideAccess" BOOLEAN NOT NULL DEFAULT false,
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedAt" TIMESTAMP(3),
    "suspendedAt" TIMESTAMP(3),
    "suspensionReason" TEXT,
    "lastAccessAt" TIMESTAMP(3),
    "createdByMembershipId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "portal_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_hours_calendars" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "timeZone" TEXT NOT NULL,
    "workingHours" JSONB NOT NULL,
    "holidays" JSONB NOT NULL DEFAULT '[]',
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_hours_calendars_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sla_policies" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "currentVersionId" TEXT,
    "createdByMembershipId" TEXT,
    "updatedByMembershipId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "sla_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sla_policy_versions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "businessHours" BOOLEAN NOT NULL DEFAULT false,
    "calendarId" TEXT,
    "calendarSnapshot" JSONB,
    "timeZone" TEXT NOT NULL DEFAULT 'UTC',
    "targets" JSONB NOT NULL,
    "pauseStatuses" JSONB NOT NULL DEFAULT '["Waiting for Customer"]',
    "warningPercent" INTEGER NOT NULL DEFAULT 80,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "createdByMembershipId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sla_policy_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sla_clocks" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "policyVersionId" TEXT,
    "targetType" TEXT NOT NULL,
    "targetMinutes" INTEGER NOT NULL,
    "businessHours" BOOLEAN NOT NULL DEFAULT false,
    "calendarSnapshot" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "pausedAt" TIMESTAMP(3),
    "pausedMinutes" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    "breachedAt" TIMESTAMP(3),
    "warnedAt" TIMESTAMP(3),
    "state" TEXT NOT NULL DEFAULT 'Running',
    "lastCalculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sla_clocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_entitlements" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "contractId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "slaPolicyVersionId" TEXT,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "supportLevel" TEXT NOT NULL DEFAULT 'Standard',
    "allowedChannels" JSONB NOT NULL DEFAULT '[]',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdByMembershipId" TEXT,
    "updatedByMembershipId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_entitlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "canned_responses" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'Team',
    "queueId" TEXT,
    "categoryId" TEXT,
    "createdByMembershipId" TEXT,
    "updatedByMembershipId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "canned_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kb_categories" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "parentId" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'Internal',
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "kb_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kb_articles" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "articleNumber" TEXT NOT NULL,
    "categoryId" TEXT,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "summary" TEXT,
    "currentVersionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "visibility" TEXT NOT NULL DEFAULT 'Internal',
    "authorMembershipId" TEXT,
    "reviewerMembershipId" TEXT,
    "publishedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kb_articles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kb_article_versions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "body" TEXT NOT NULL,
    "changeNote" TEXT,
    "authorMembershipId" TEXT,
    "reviewStatus" TEXT NOT NULL DEFAULT 'Draft',
    "reviewerMembershipId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewReason" TEXT,
    "publishedAt" TIMESTAMP(3),
    "publishedByMembershipId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kb_article_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_satisfaction" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "portalAccountId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Valid',
    "moderationState" TEXT NOT NULL DEFAULT 'None',
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_satisfaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ticket_events_dedupeKey_key" ON "ticket_events"("dedupeKey");

-- CreateIndex
CREATE INDEX "ticket_events_ticketId_createdAt_idx" ON "ticket_events"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "ticket_events_organizationId_idx" ON "ticket_events"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "support_inboxes_organizationId_name_key" ON "support_inboxes"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "support_queues_organizationId_name_key" ON "support_queues"("organizationId", "name");

-- CreateIndex
CREATE INDEX "support_queue_members_membershipId_idx" ON "support_queue_members"("membershipId");

-- CreateIndex
CREATE UNIQUE INDEX "support_queue_members_queueId_membershipId_key" ON "support_queue_members"("queueId", "membershipId");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_categories_organizationId_parentId_normalizedName_key" ON "ticket_categories"("organizationId", "parentId", "normalizedName");

-- CreateIndex
CREATE INDEX "ticket_followers_membershipId_idx" ON "ticket_followers"("membershipId");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_followers_ticketId_membershipId_key" ON "ticket_followers"("ticketId", "membershipId");

-- CreateIndex
CREATE UNIQUE INDEX "portal_accounts_organizationId_userId_key" ON "portal_accounts"("organizationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "portal_accounts_organizationId_contactId_key" ON "portal_accounts"("organizationId", "contactId");

-- CreateIndex
CREATE UNIQUE INDEX "business_hours_calendars_organizationId_name_key" ON "business_hours_calendars"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "sla_policies_organizationId_name_key" ON "sla_policies"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "sla_policy_versions_policyId_versionNumber_key" ON "sla_policy_versions"("policyId", "versionNumber");

-- CreateIndex
CREATE INDEX "sla_clocks_organizationId_state_dueAt_idx" ON "sla_clocks"("organizationId", "state", "dueAt");

-- CreateIndex
CREATE INDEX "sla_clocks_ticketId_idx" ON "sla_clocks"("ticketId");

-- CreateIndex
CREATE INDEX "support_entitlements_organizationId_companyId_idx" ON "support_entitlements"("organizationId", "companyId");

-- CreateIndex
CREATE INDEX "canned_responses_organizationId_idx" ON "canned_responses"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "kb_categories_organizationId_slug_key" ON "kb_categories"("organizationId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "kb_articles_organizationId_slug_key" ON "kb_articles"("organizationId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "kb_articles_organizationId_articleNumber_key" ON "kb_articles"("organizationId", "articleNumber");

-- CreateIndex
CREATE UNIQUE INDEX "kb_article_versions_articleId_versionNumber_key" ON "kb_article_versions"("articleId", "versionNumber");

-- CreateIndex
CREATE INDEX "ticket_satisfaction_organizationId_idx" ON "ticket_satisfaction"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_satisfaction_ticketId_portalAccountId_key" ON "ticket_satisfaction"("ticketId", "portalAccountId");

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_inboxId_fkey" FOREIGN KEY ("inboxId") REFERENCES "support_inboxes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_queueId_fkey" FOREIGN KEY ("queueId") REFERENCES "support_queues"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ticket_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_subcategoryId_fkey" FOREIGN KEY ("subcategoryId") REFERENCES "ticket_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_portalAccountId_fkey" FOREIGN KEY ("portalAccountId") REFERENCES "portal_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_entitlementId_fkey" FOREIGN KEY ("entitlementId") REFERENCES "support_entitlements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_slaPolicyVersionId_fkey" FOREIGN KEY ("slaPolicyVersionId") REFERENCES "sla_policy_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_events" ADD CONSTRAINT "ticket_events_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_queue_members" ADD CONSTRAINT "support_queue_members_queueId_fkey" FOREIGN KEY ("queueId") REFERENCES "support_queues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_categories" ADD CONSTRAINT "ticket_categories_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ticket_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_followers" ADD CONSTRAINT "ticket_followers_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sla_policy_versions" ADD CONSTRAINT "sla_policy_versions_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "sla_policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sla_clocks" ADD CONSTRAINT "sla_clocks_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_entitlements" ADD CONSTRAINT "support_entitlements_slaPolicyVersionId_fkey" FOREIGN KEY ("slaPolicyVersionId") REFERENCES "sla_policy_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kb_articles" ADD CONSTRAINT "kb_articles_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "kb_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kb_article_versions" ADD CONSTRAINT "kb_article_versions_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "kb_articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_satisfaction" ADD CONSTRAINT "ticket_satisfaction_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill: messages written before this migration only had `kind`.
-- Notes MUST become Internal Only — never left on the customer-visible default.
UPDATE "ticket_messages" SET "messageType" = 'Internal Note', "visibility" = 'Internal Only', "deliveryStatus" = 'Not Applicable' WHERE "kind" = 'Note';
UPDATE "ticket_messages" SET "messageType" = 'Agent Reply', "visibility" = 'Customer Visible', "deliveryStatus" = 'Pending Provider' WHERE "kind" = 'Reply';
UPDATE "ticket_messages" SET "sanitizedBody" = "body" WHERE "sanitizedBody" IS NULL;
UPDATE "tickets" SET "normalizedSubject" = lower(regexp_replace(trim("subject"), '\s+', ' ', 'g')) WHERE "normalizedSubject" IS NULL;

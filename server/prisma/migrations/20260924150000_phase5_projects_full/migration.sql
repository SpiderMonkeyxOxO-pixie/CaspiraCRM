-- AlterTable
ALTER TABLE "milestones" ADD COLUMN     "acceptanceRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "customerVisible" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "organizationId" TEXT,
ADD COLUMN     "ownerMembershipId" TEXT,
ADD COLUMN     "phaseId" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'Planned',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "actualEndDate" TIMESTAMP(3),
ADD COLUMN     "actualStartDate" TIMESTAMP(3),
ADD COLUMN     "archiveReason" TEXT,
ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "archivedByMembershipId" TEXT,
ADD COLUMN     "cancellationReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "currency" TEXT,
ADD COLUMN     "customerSummary" TEXT,
ADD COLUMN     "department" TEXT,
ADD COLUMN     "healthNote" TEXT,
ADD COLUMN     "healthState" TEXT,
ADD COLUMN     "manualProgress" INTEGER,
ADD COLUMN     "manualProgressReason" TEXT,
ADD COLUMN     "plannedBudget" DECIMAL(14,2),
ADD COLUMN     "plannedEffortMinutes" INTEGER,
ADD COLUMN     "portfolioId" TEXT,
ADD COLUMN     "primaryContactId" TEXT,
ADD COLUMN     "priority" TEXT NOT NULL DEFAULT 'Medium',
ADD COLUMN     "progressMode" TEXT NOT NULL DEFAULT 'Task Count',
ADD COLUMN     "projectNumber" TEXT,
ADD COLUMN     "projectType" TEXT NOT NULL DEFAULT 'Delivery',
ADD COLUMN     "sourceContractId" TEXT,
ADD COLUMN     "sourceOrderId" TEXT,
ADD COLUMN     "statusBeforeArchive" TEXT,
ADD COLUMN     "team" TEXT,
ADD COLUMN     "templateId" TEXT,
ADD COLUMN     "templateVersionNumber" INTEGER;

-- AlterTable
ALTER TABLE "task_comments" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "authorPortalAccountId" TEXT,
ADD COLUMN     "editedAt" TIMESTAMP(3),
ADD COLUMN     "projectId" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "visibility" TEXT NOT NULL DEFAULT 'Project Team',
ALTER COLUMN "taskId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "task_time_entries" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedByMembershipId" TEXT,
ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "billable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "correctionReason" TEXT,
ADD COLUMN     "correctsEntryId" TEXT,
ADD COLUMN     "durationMinutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "endTime" TIMESTAMP(3),
ADD COLUMN     "projectId" TEXT,
ADD COLUMN     "rejectedAt" TIMESTAMP(3),
ADD COLUMN     "rejectedByMembershipId" TEXT,
ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'Manual',
ADD COLUMN     "startTime" TIMESTAMP(3),
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'Draft',
ADD COLUMN     "submittedAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "workDate" TIMESTAMP(3),
ALTER COLUMN "taskId" DROP NOT NULL,
ALTER COLUMN "hours" DROP NOT NULL;

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "actualStartDate" TIMESTAMP(3),
ADD COLUMN     "archiveReason" TEXT,
ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "blocked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "blockedReason" TEXT,
ADD COLUMN     "boardId" TEXT,
ADD COLUMN     "columnId" TEXT,
ADD COLUMN     "customerVisible" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "estimatedMinutes" INTEGER,
ADD COLUMN     "milestoneId" TEXT,
ADD COLUMN     "ownerMembershipId" TEXT,
ADD COLUMN     "parentTaskId" TEXT,
ADD COLUMN     "phaseId" TEXT,
ADD COLUMN     "plannedStartDate" TIMESTAMP(3),
ADD COLUMN     "progress" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "remainingMinutes" INTEGER,
ADD COLUMN     "reporterMembershipId" TEXT,
ADD COLUMN     "statusCategory" TEXT NOT NULL DEFAULT 'Backlog',
ADD COLUMN     "taskNumber" TEXT,
ADD COLUMN     "taskType" TEXT NOT NULL DEFAULT 'Task',
ADD COLUMN     "weight" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "project_portfolios" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "ownerMembershipId" TEXT,
    "department" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "visibility" TEXT NOT NULL DEFAULT 'Organization',
    "createdByMembershipId" TEXT,
    "updatedByMembershipId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "project_portfolios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_templates" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "projectType" TEXT NOT NULL DEFAULT 'Delivery',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "currentVersionId" TEXT,
    "createdByMembershipId" TEXT,
    "updatedByMembershipId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "project_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_template_versions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "changeNote" TEXT,
    "createdByMembershipId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_template_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_members" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'Contributor',
    "accessLevel" TEXT NOT NULL DEFAULT 'Edit',
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "allocationPercent" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_phases" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "plannedStartDate" TIMESTAMP(3),
    "plannedEndDate" TIMESTAMP(3),
    "actualStartDate" TIMESTAMP(3),
    "actualEndDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'Not Started',
    "ownerMembershipId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "project_phases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_boards" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "task_boards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "board_columns" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "category" TEXT NOT NULL DEFAULT 'Backlog',
    "wipLimit" INTEGER,
    "isCompletion" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "requiredFields" JSONB NOT NULL DEFAULT '[]',
    "allowedFromColumnIds" JSONB NOT NULL DEFAULT '[]',
    "allowedRoles" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "board_columns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_assignees" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'Contributor',
    "assignedByMembershipId" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "task_assignees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_checklist_items" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "completedByMembershipId" TEXT,
    "completedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "task_checklist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_dependencies" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "predecessorId" TEXT NOT NULL,
    "successorId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'Finish to Start',
    "lagMinutes" INTEGER NOT NULL DEFAULT 0,
    "createdByMembershipId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_dependencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_labels" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "colorToken" TEXT NOT NULL DEFAULT 'gray',
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "project_labels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_labels" (
    "taskId" TEXT NOT NULL,
    "labelId" TEXT NOT NULL,

    CONSTRAINT "task_labels_pkey" PRIMARY KEY ("taskId","labelId")
);

-- CreateTable
CREATE TABLE "project_activities" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "taskId" TEXT,
    "eventType" TEXT NOT NULL,
    "actorType" TEXT NOT NULL DEFAULT 'Member',
    "actorMembershipId" TEXT,
    "actorPortalAccountId" TEXT,
    "fromValue" TEXT,
    "toValue" TEXT,
    "reason" TEXT,
    "snapshot" JSONB NOT NULL DEFAULT '{}',
    "customerVisible" BOOLEAN NOT NULL DEFAULT false,
    "dedupeKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_timers" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "taskId" TEXT,
    "state" TEXT NOT NULL DEFAULT 'Running',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastResumedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "pausedAt" TIMESTAMP(3),
    "accumulatedSeconds" INTEGER NOT NULL DEFAULT 0,
    "stoppedAt" TIMESTAMP(3),
    "timeEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_timers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deliverables" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "deliverableNumber" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "milestoneId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "ownerMembershipId" TEXT,
    "reviewerMembershipId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "dueDate" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "customerVisible" BOOLEAN NOT NULL DEFAULT false,
    "acceptanceCriteria" TEXT,
    "currentVersionNumber" INTEGER NOT NULL DEFAULT 1,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "deliverables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deliverable_decisions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "deliverableId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "decision" TEXT NOT NULL,
    "comment" TEXT,
    "actorType" TEXT NOT NULL DEFAULT 'Internal',
    "actorMembershipId" TEXT,
    "actorPortalAccountId" TEXT,
    "customerVisible" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deliverable_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_risks" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL DEFAULT 'Delivery',
    "probabilityLevel" TEXT NOT NULL DEFAULT 'Medium',
    "impactLevel" TEXT NOT NULL DEFAULT 'Medium',
    "priority" TEXT NOT NULL DEFAULT 'Medium',
    "ownerMembershipId" TEXT,
    "responseStrategy" TEXT,
    "mitigationPlan" TEXT,
    "trigger" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Identified',
    "internalOnly" BOOLEAN NOT NULL DEFAULT true,
    "reviewDate" TIMESTAMP(3),
    "acceptanceReason" TEXT,
    "acceptedByMembershipId" TEXT,
    "closedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_risks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_issues" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "relatedTaskId" TEXT,
    "relatedTicketId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'Medium',
    "severity" TEXT NOT NULL DEFAULT 'Moderate',
    "ownerMembershipId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Open',
    "internalOnly" BOOLEAN NOT NULL DEFAULT true,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "targetResolutionDate" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolutionSummary" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "change_requests" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "changeNumber" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "requestedByMembershipId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "businessReason" TEXT,
    "scopeImpact" TEXT,
    "scheduleImpact" JSONB NOT NULL DEFAULT '{}',
    "effortImpactMinutes" INTEGER,
    "budgetImpact" DECIMAL(14,2),
    "riskImpact" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "reviewerMembershipId" TEXT,
    "impactSnapshot" JSONB,
    "decision" TEXT,
    "decisionReason" TEXT,
    "approvedByMembershipId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "implementedAt" TIMESTAMP(3),
    "cancelledReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "change_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_baselines" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "baselineNumber" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdByMembershipId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_baselines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "project_portfolios_organizationId_name_key" ON "project_portfolios"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "project_templates_organizationId_name_key" ON "project_templates"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "project_template_versions_templateId_versionNumber_key" ON "project_template_versions"("templateId", "versionNumber");

-- CreateIndex
CREATE INDEX "project_members_membershipId_idx" ON "project_members"("membershipId");

-- CreateIndex
CREATE UNIQUE INDEX "project_members_projectId_membershipId_key" ON "project_members"("projectId", "membershipId");

-- CreateIndex
CREATE INDEX "project_phases_projectId_idx" ON "project_phases"("projectId");

-- CreateIndex
CREATE INDEX "task_boards_projectId_idx" ON "task_boards"("projectId");

-- CreateIndex
CREATE INDEX "board_columns_boardId_idx" ON "board_columns"("boardId");

-- CreateIndex
CREATE INDEX "task_assignees_taskId_idx" ON "task_assignees"("taskId");

-- CreateIndex
CREATE INDEX "task_assignees_membershipId_idx" ON "task_assignees"("membershipId");

-- CreateIndex
CREATE INDEX "task_checklist_items_taskId_idx" ON "task_checklist_items"("taskId");

-- CreateIndex
CREATE INDEX "task_dependencies_projectId_idx" ON "task_dependencies"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "task_dependencies_predecessorId_successorId_key" ON "task_dependencies"("predecessorId", "successorId");

-- CreateIndex
CREATE UNIQUE INDEX "project_labels_organizationId_projectId_normalizedName_key" ON "project_labels"("organizationId", "projectId", "normalizedName");

-- CreateIndex
CREATE UNIQUE INDEX "project_activities_dedupeKey_key" ON "project_activities"("dedupeKey");

-- CreateIndex
CREATE INDEX "project_activities_projectId_createdAt_idx" ON "project_activities"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "work_timers_membershipId_state_idx" ON "work_timers"("membershipId", "state");

-- CreateIndex
CREATE INDEX "deliverables_projectId_idx" ON "deliverables"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "deliverables_organizationId_deliverableNumber_key" ON "deliverables"("organizationId", "deliverableNumber");

-- CreateIndex
CREATE INDEX "deliverable_decisions_deliverableId_idx" ON "deliverable_decisions"("deliverableId");

-- CreateIndex
CREATE INDEX "project_risks_projectId_idx" ON "project_risks"("projectId");

-- CreateIndex
CREATE INDEX "project_issues_projectId_idx" ON "project_issues"("projectId");

-- CreateIndex
CREATE INDEX "change_requests_projectId_idx" ON "change_requests"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "change_requests_organizationId_changeNumber_key" ON "change_requests"("organizationId", "changeNumber");

-- CreateIndex
CREATE UNIQUE INDEX "project_baselines_projectId_baselineNumber_key" ON "project_baselines"("projectId", "baselineNumber");

-- CreateIndex
CREATE UNIQUE INDEX "projects_organizationId_projectNumber_key" ON "projects"("organizationId", "projectNumber");

-- CreateIndex
CREATE INDEX "task_comments_projectId_idx" ON "task_comments"("projectId");

-- CreateIndex
CREATE INDEX "task_time_entries_projectId_idx" ON "task_time_entries"("projectId");

-- CreateIndex
CREATE INDEX "task_time_entries_authorMembershipId_workDate_idx" ON "task_time_entries"("authorMembershipId", "workDate");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_organizationId_taskNumber_key" ON "tasks"("organizationId", "taskNumber");

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "project_portfolios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parentTaskId_fkey" FOREIGN KEY ("parentTaskId") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_columnId_fkey" FOREIGN KEY ("columnId") REFERENCES "board_columns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_time_entries" ADD CONSTRAINT "task_time_entries_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_template_versions" ADD CONSTRAINT "project_template_versions_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "project_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_phases" ADD CONSTRAINT "project_phases_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_boards" ADD CONSTRAINT "task_boards_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_columns" ADD CONSTRAINT "board_columns_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "task_boards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_assignees" ADD CONSTRAINT "task_assignees_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_checklist_items" ADD CONSTRAINT "task_checklist_items_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_predecessorId_fkey" FOREIGN KEY ("predecessorId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_successorId_fkey" FOREIGN KEY ("successorId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_labels" ADD CONSTRAINT "task_labels_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_labels" ADD CONSTRAINT "task_labels_labelId_fkey" FOREIGN KEY ("labelId") REFERENCES "project_labels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_activities" ADD CONSTRAINT "project_activities_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliverables" ADD CONSTRAINT "deliverables_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliverables" ADD CONSTRAINT "deliverables_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "milestones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliverable_decisions" ADD CONSTRAINT "deliverable_decisions_deliverableId_fkey" FOREIGN KEY ("deliverableId") REFERENCES "deliverables"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_risks" ADD CONSTRAINT "project_risks_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_issues" ADD CONSTRAINT "project_issues_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_baselines" ADD CONSTRAINT "project_baselines_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill for rows created before the full spec.
-- Legacy single dependency → Finish-to-Start dependency record.
INSERT INTO "task_dependencies" ("id", "organizationId", "projectId", "predecessorId", "successorId", "type", "lagMinutes", "createdAt")
SELECT md5(random()::text || clock_timestamp()::text || t."id"), t."organizationId", t."projectId", t."dependsOnId", t."id", 'Finish to Start', 0, now()
FROM "tasks" t WHERE t."dependsOnId" IS NOT NULL AND t."projectId" IS NOT NULL AND t."organizationId" IS NOT NULL
ON CONFLICT DO NOTHING;
-- Hours → minutes.
UPDATE "tasks" SET "estimatedMinutes" = ROUND("estimateHours" * 60) WHERE "estimateHours" IS NOT NULL AND "estimatedMinutes" IS NULL;
UPDATE "task_time_entries" e SET "durationMinutes" = ROUND(COALESCE(e."hours", 0) * 60), "status" = 'Submitted', "submittedAt" = e."createdAt",
  "workDate" = e."createdAt", "projectId" = t."projectId"
FROM "tasks" t WHERE t."id" = e."taskId" AND e."durationMinutes" = 0;
-- Comments belong to their task's project, visible to the project team.
UPDATE "task_comments" c SET "projectId" = t."projectId" FROM "tasks" t WHERE t."id" = c."taskId" AND c."projectId" IS NULL;
-- Milestones: organization and status from the legacy completed flag.
UPDATE "milestones" m SET "organizationId" = p."organizationId", "status" = CASE WHEN m."completed" THEN 'Achieved' ELSE 'Planned' END
FROM "projects" p WHERE p."id" = m."projectId";
-- The existing owner becomes the Project Manager member.
INSERT INTO "project_members" ("id", "organizationId", "projectId", "membershipId", "role", "accessLevel", "active", "createdAt", "updatedAt")
SELECT md5(random()::text || clock_timestamp()::text || p."id"), p."organizationId", p."id", p."ownerMembershipId", 'Project Manager', 'Edit', true, now(), now()
FROM "projects" p WHERE p."ownerMembershipId" IS NOT NULL AND p."organizationId" IS NOT NULL
ON CONFLICT DO NOTHING;
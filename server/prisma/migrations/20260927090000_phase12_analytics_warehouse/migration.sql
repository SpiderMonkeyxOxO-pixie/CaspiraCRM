-- CreateTable
CREATE TABLE "analytics_dim_date" (
    "date" DATE NOT NULL,
    "year" INTEGER NOT NULL,
    "quarter" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "day" INTEGER NOT NULL,
    "isoWeek" INTEGER NOT NULL,
    "isoYear" INTEGER NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "isWeekend" BOOLEAN NOT NULL,
    "monthStart" DATE NOT NULL,
    "quarterStart" DATE NOT NULL,

    CONSTRAINT "analytics_dim_date_pkey" PRIMARY KEY ("date")
);

-- CreateTable
CREATE TABLE "analytics_dimensions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "currentVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "analytics_dimensions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_dimension_versions" (
    "id" TEXT NOT NULL,
    "dimensionId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "attributes" JSONB NOT NULL,
    "attributesHash" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "sourceUpdatedAt" TIMESTAMP(3),
    "warehouseUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_dimension_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_metrics" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "publishedVersion" INTEGER,
    "latestVersion" INTEGER NOT NULL DEFAULT 1,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "analytics_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_metric_versions" (
    "id" TEXT NOT NULL,
    "metricId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "definition" JSONB NOT NULL,
    "checksum" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "effectiveDate" TIMESTAMP(3),
    "deprecatedDate" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "publishedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_metric_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_fact_leads" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "ownerMembershipId" TEXT,
    "department" TEXT,
    "team" TEXT,
    "businessDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "lifecycleStage" TEXT,
    "qualificationStatus" TEXT,
    "source" TEXT,
    "country" TEXT,
    "hasContactInfo" BOOLEAN NOT NULL,
    "qualified" BOOLEAN NOT NULL,
    "converted" BOOLEAN NOT NULL,
    "convertedAt" TIMESTAMP(3),
    "convertedDate" DATE,
    "convertedDealId" TEXT,
    "currency" TEXT,
    "estimatedValue" DECIMAL(18,2),
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "sourceUpdatedAt" TIMESTAMP(3) NOT NULL,
    "loadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "jobId" TEXT,

    CONSTRAINT "analytics_fact_leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_fact_activities" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "ownerMembershipId" TEXT,
    "assignedMembershipId" TEXT,
    "department" TEXT,
    "team" TEXT,
    "businessDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3),
    "dueDate" DATE,
    "completedAt" TIMESTAMP(3),
    "completedDate" DATE,
    "companyId" TEXT,
    "dealId" TEXT,
    "leadId" TEXT,
    "followUpRequired" BOOLEAN NOT NULL DEFAULT false,
    "followUpDate" TIMESTAMP(3),
    "followUpActivityId" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "sourceUpdatedAt" TIMESTAMP(3) NOT NULL,
    "loadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "jobId" TEXT,

    CONSTRAINT "analytics_fact_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_fact_deal_events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "ownerMembershipId" TEXT,
    "department" TEXT,
    "team" TEXT,
    "businessDate" DATE NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "fromStage" TEXT,
    "toStage" TEXT,
    "toProbability" INTEGER,
    "secondsInPrevious" INTEGER,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "loadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "jobId" TEXT,

    CONSTRAINT "analytics_fact_deal_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_fact_deal_snapshots" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "snapshotDate" DATE NOT NULL,
    "dealId" TEXT NOT NULL,
    "ownerMembershipId" TEXT,
    "department" TEXT,
    "team" TEXT,
    "pipelineId" TEXT,
    "stage" TEXT NOT NULL,
    "stageClassification" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "isOpen" BOOLEAN NOT NULL,
    "companyId" TEXT,
    "currency" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "probability" INTEGER,
    "weightedAmount" DECIMAL(18,2) NOT NULL,
    "baseCurrency" TEXT NOT NULL,
    "baseAmount" DECIMAL(18,2),
    "baseWeightedAmount" DECIMAL(18,2),
    "rateDate" DATE,
    "rateVersion" INTEGER,
    "conversionStatus" TEXT NOT NULL,
    "expectedClosingDate" DATE,
    "actualClosingDate" DATE,
    "createdDate" DATE NOT NULL,
    "stageEnteredAt" TIMESTAMP(3),
    "lastActivityAt" TIMESTAMP(3),
    "hasNextAction" BOOLEAN NOT NULL,
    "hasOwner" BOOLEAN NOT NULL,
    "hasProducts" BOOLEAN NOT NULL,
    "loadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "jobId" TEXT,

    CONSTRAINT "analytics_fact_deal_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_fact_quotes" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "ownerMembershipId" TEXT,
    "department" TEXT,
    "team" TEXT,
    "businessDate" DATE NOT NULL,
    "status" TEXT NOT NULL,
    "approvalStatus" TEXT,
    "dealId" TEXT,
    "companyId" TEXT,
    "currency" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "baseCurrency" TEXT NOT NULL,
    "baseAmount" DECIMAL(18,2),
    "rateDate" DATE,
    "rateVersion" INTEGER,
    "conversionStatus" TEXT NOT NULL,
    "validUntilDate" DATE,
    "acceptedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "sourceUpdatedAt" TIMESTAMP(3) NOT NULL,
    "loadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "jobId" TEXT,

    CONSTRAINT "analytics_fact_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_fact_orders" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "ownerMembershipId" TEXT,
    "department" TEXT,
    "team" TEXT,
    "businessDate" DATE NOT NULL,
    "status" TEXT NOT NULL,
    "orderType" TEXT,
    "dealId" TEXT,
    "companyId" TEXT,
    "currency" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "baseCurrency" TEXT NOT NULL,
    "baseAmount" DECIMAL(18,2),
    "rateDate" DATE,
    "rateVersion" INTEGER,
    "conversionStatus" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "sourceUpdatedAt" TIMESTAMP(3) NOT NULL,
    "loadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "jobId" TEXT,

    CONSTRAINT "analytics_fact_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_fact_contracts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "ownerMembershipId" TEXT,
    "renewalOwnerMembershipId" TEXT,
    "department" TEXT,
    "team" TEXT,
    "businessDate" DATE NOT NULL,
    "status" TEXT NOT NULL,
    "contractType" TEXT NOT NULL,
    "renewalType" TEXT,
    "companyId" TEXT,
    "currency" TEXT NOT NULL,
    "amount" DECIMAL(18,2),
    "baseCurrency" TEXT NOT NULL,
    "baseAmount" DECIMAL(18,2),
    "rateDate" DATE,
    "rateVersion" INTEGER,
    "conversionStatus" TEXT NOT NULL,
    "effectiveDate" DATE,
    "endDate" DATE,
    "renewalNoticeDate" DATE,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "sourceUpdatedAt" TIMESTAMP(3) NOT NULL,
    "loadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "jobId" TEXT,

    CONSTRAINT "analytics_fact_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_fact_support" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "ownerMembershipId" TEXT,
    "assignedMembershipId" TEXT,
    "department" TEXT,
    "team" TEXT,
    "businessDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "queueId" TEXT,
    "companyId" TEXT,
    "firstRespondedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolvedDate" DATE,
    "closedAt" TIMESTAMP(3),
    "firstResponseMinutes" INTEGER,
    "resolutionMinutes" INTEGER,
    "responseDue" TIMESTAMP(3),
    "resolutionDue" TIMESTAMP(3),
    "responseBreached" BOOLEAN,
    "resolutionBreached" BOOLEAN,
    "reopenCount" INTEGER NOT NULL DEFAULT 0,
    "isOpen" BOOLEAN NOT NULL,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "sourceUpdatedAt" TIMESTAMP(3) NOT NULL,
    "loadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "jobId" TEXT,

    CONSTRAINT "analytics_fact_support_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_fact_projects" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "ownerMembershipId" TEXT,
    "department" TEXT,
    "team" TEXT,
    "businessDate" DATE NOT NULL,
    "status" TEXT NOT NULL,
    "healthState" TEXT,
    "priority" TEXT,
    "companyId" TEXT,
    "startDate" DATE,
    "dueDate" DATE,
    "completedAt" TIMESTAMP(3),
    "completedDate" DATE,
    "plannedEffortMinutes" INTEGER,
    "currency" TEXT,
    "plannedBudget" DECIMAL(18,2),
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "sourceUpdatedAt" TIMESTAMP(3) NOT NULL,
    "loadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "jobId" TEXT,

    CONSTRAINT "analytics_fact_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_fact_tasks" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "projectId" TEXT,
    "ownerMembershipId" TEXT,
    "assigneeMembershipId" TEXT,
    "department" TEXT,
    "team" TEXT,
    "businessDate" DATE NOT NULL,
    "status" TEXT NOT NULL,
    "statusCategory" TEXT,
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "isMilestone" BOOLEAN NOT NULL DEFAULT false,
    "dueDate" DATE,
    "completedAt" TIMESTAMP(3),
    "completedDate" DATE,
    "estimatedMinutes" INTEGER,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "sourceUpdatedAt" TIMESTAMP(3) NOT NULL,
    "loadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "jobId" TEXT,

    CONSTRAINT "analytics_fact_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_fact_time" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "projectId" TEXT,
    "taskId" TEXT,
    "ownerMembershipId" TEXT,
    "department" TEXT,
    "team" TEXT,
    "businessDate" DATE NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "billable" BOOLEAN NOT NULL,
    "status" TEXT NOT NULL,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "sourceUpdatedAt" TIMESTAMP(3) NOT NULL,
    "loadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "jobId" TEXT,

    CONSTRAINT "analytics_fact_time_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_fact_invoices" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "ownerMembershipId" TEXT,
    "department" TEXT,
    "team" TEXT,
    "businessDate" DATE NOT NULL,
    "status" TEXT NOT NULL,
    "companyId" TEXT,
    "projectId" TEXT,
    "currency" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "amountPaid" DECIMAL(18,2) NOT NULL,
    "amountDue" DECIMAL(18,2) NOT NULL,
    "baseCurrency" TEXT NOT NULL,
    "baseAmount" DECIMAL(18,2),
    "baseAmountDue" DECIMAL(18,2),
    "rateDate" DATE,
    "rateVersion" INTEGER,
    "conversionStatus" TEXT NOT NULL,
    "dueDate" DATE,
    "paidAt" TIMESTAMP(3),
    "paidDate" DATE,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "sourceUpdatedAt" TIMESTAMP(3) NOT NULL,
    "loadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "jobId" TEXT,

    CONSTRAINT "analytics_fact_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_fact_payments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "ownerMembershipId" TEXT,
    "department" TEXT,
    "team" TEXT,
    "businessDate" DATE NOT NULL,
    "direction" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "method" TEXT,
    "invoiceId" TEXT,
    "companyId" TEXT,
    "currency" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "baseCurrency" TEXT NOT NULL,
    "baseAmount" DECIMAL(18,2),
    "rateDate" DATE,
    "rateVersion" INTEGER,
    "conversionStatus" TEXT NOT NULL,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "sourceUpdatedAt" TIMESTAMP(3) NOT NULL,
    "loadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "jobId" TEXT,

    CONSTRAINT "analytics_fact_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_fact_expenses" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "ownerMembershipId" TEXT,
    "department" TEXT,
    "team" TEXT,
    "businessDate" DATE NOT NULL,
    "status" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "projectId" TEXT,
    "billable" BOOLEAN NOT NULL DEFAULT false,
    "currency" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "baseCurrency" TEXT NOT NULL,
    "baseAmount" DECIMAL(18,2),
    "rateDate" DATE,
    "rateVersion" INTEGER,
    "conversionStatus" TEXT NOT NULL,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "sourceUpdatedAt" TIMESTAMP(3) NOT NULL,
    "loadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "jobId" TEXT,

    CONSTRAINT "analytics_fact_expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_fact_ai_usage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "ownerMembershipId" TEXT,
    "businessDate" DATE NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "useCaseKey" TEXT NOT NULL,
    "capabilityKey" TEXT,
    "providerKey" TEXT NOT NULL,
    "modelId" TEXT,
    "outcome" TEXT NOT NULL,
    "billingSource" TEXT,
    "releaseId" TEXT,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "cachedTokens" INTEGER NOT NULL,
    "estimatedCost" DECIMAL(14,6),
    "costKnown" BOOLEAN NOT NULL,
    "durationMs" INTEGER,
    "loadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "jobId" TEXT,

    CONSTRAINT "analytics_fact_ai_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_fact_ai_events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "ownerMembershipId" TEXT,
    "businessDate" DATE NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT,
    "category" TEXT,
    "severity" TEXT,
    "capabilityKey" TEXT,
    "loadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "jobId" TEXT,

    CONSTRAINT "analytics_fact_ai_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_fact_snapshots" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "snapshotDate" DATE NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "ownerMembershipId" TEXT,
    "department" TEXT,
    "team" TEXT,
    "currency" TEXT,
    "value" DECIMAL(18,2),
    "count" INTEGER NOT NULL DEFAULT 0,
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "loadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "jobId" TEXT,

    CONSTRAINT "analytics_fact_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_fact_budgets" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "snapshotDate" DATE NOT NULL,
    "budgetId" TEXT NOT NULL,
    "budgetName" TEXT NOT NULL,
    "department" TEXT,
    "fiscalYearId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "planned" DECIMAL(18,2) NOT NULL,
    "actual" DECIMAL(18,2) NOT NULL,
    "loadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "jobId" TEXT,

    CONSTRAINT "analytics_fact_budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_exchange_rates" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "baseCurrency" TEXT NOT NULL,
    "quoteCurrency" TEXT NOT NULL,
    "rate" DECIMAL(20,10) NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "source" TEXT NOT NULL,
    "sourceRateId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "loadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_exchange_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_fiscal_calendars" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "timeZone" TEXT NOT NULL DEFAULT 'UTC',
    "baseCurrency" TEXT NOT NULL DEFAULT 'USD',
    "fiscalYearStartMonth" INTEGER NOT NULL DEFAULT 1,
    "weekStart" INTEGER NOT NULL DEFAULT 1,
    "source" TEXT NOT NULL DEFAULT 'default',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "analytics_fiscal_calendars_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_warehouse_jobs" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "jobType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Queued',
    "watermarkFrom" TIMESTAMP(3),
    "watermarkTo" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "rowsRead" INTEGER NOT NULL DEFAULT 0,
    "rowsInserted" INTEGER NOT NULL DEFAULT 0,
    "rowsUpdated" INTEGER NOT NULL DEFAULT 0,
    "rowsDeleted" INTEGER NOT NULL DEFAULT 0,
    "rowsRejected" INTEGER NOT NULL DEFAULT 0,
    "reconciliation" JSONB,
    "failureCategory" TEXT,
    "safeError" TEXT,
    "correlationId" TEXT NOT NULL,
    "requestedByUserId" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_warehouse_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_job_checkpoints" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "watermark" TIMESTAMP(3) NOT NULL,
    "lastSourceId" TEXT,
    "lastJobId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "analytics_job_checkpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_reconciliation_runs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "jobId" TEXT,
    "status" TEXT NOT NULL,
    "checks" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_reconciliation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_data_quality_issues" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "issueType" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "affectedCount" INTEGER NOT NULL DEFAULT 0,
    "metricKeys" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'Open',
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "analytics_data_quality_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_reports" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ownerMembershipId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "visibility" TEXT NOT NULL DEFAULT 'Private',
    "team" TEXT,
    "department" TEXT,
    "isTemplate" BOOLEAN NOT NULL DEFAULT false,
    "latestVersion" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "analytics_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_report_versions" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "definition" JSONB NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_report_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_report_shares" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_report_shares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_report_schedules" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "ownerMembershipId" TEXT NOT NULL,
    "timeZone" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "cron" TEXT,
    "runAt" TEXT NOT NULL DEFAULT '08:00',
    "dayOfWeek" INTEGER,
    "dayOfMonth" INTEGER,
    "startDate" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "recipients" JSONB NOT NULL DEFAULT '[]',
    "deliveryMethod" TEXT NOT NULL DEFAULT 'in_app',
    "format" TEXT NOT NULL DEFAULT 'csv',
    "expiresAt" TIMESTAMP(3),
    "failurePolicy" TEXT NOT NULL DEFAULT 'notify_owner',
    "stalePolicy" TEXT NOT NULL DEFAULT 'skip',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "pausedReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "analytics_report_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_schedule_runs" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "occurrenceKey" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "deliveries" JSONB NOT NULL DEFAULT '[]',
    "exportJobId" TEXT,
    "safeError" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "analytics_schedule_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_export_jobs" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "requestedByMembershipId" TEXT NOT NULL,
    "reportId" TEXT,
    "reportVersion" INTEGER,
    "dataset" TEXT,
    "query" JSONB NOT NULL,
    "columns" JSONB NOT NULL DEFAULT '[]',
    "format" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "classification" TEXT NOT NULL DEFAULT 'Internal',
    "status" TEXT NOT NULL DEFAULT 'Requested',
    "approvalRequired" BOOLEAN NOT NULL DEFAULT false,
    "approvedByMembershipId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rowCount" INTEGER,
    "fileSize" INTEGER,
    "fileSha256" TEXT,
    "fileData" BYTEA,
    "fileIv" TEXT,
    "fileTag" TEXT,
    "fileKeyVersion" INTEGER,
    "metricVersions" JSONB NOT NULL DEFAULT '{}',
    "watermark" TEXT,
    "downloadLimit" INTEGER NOT NULL DEFAULT 5,
    "downloads" INTEGER NOT NULL DEFAULT 0,
    "recipientMembershipIds" JSONB NOT NULL DEFAULT '[]',
    "expiresAt" TIMESTAMP(3),
    "scheduleRunId" TEXT,
    "failureCategory" TEXT,
    "safeError" TEXT,
    "revokedByMembershipId" TEXT,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "analytics_export_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_export_downloads" (
    "id" TEXT NOT NULL,
    "exportJobId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "membershipId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_export_downloads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "analytics_dimensions_organizationId_type_sourceId_key" ON "analytics_dimensions"("organizationId", "type", "sourceId");

-- CreateIndex
CREATE INDEX "analytics_dimension_versions_dimensionId_isCurrent_idx" ON "analytics_dimension_versions"("dimensionId", "isCurrent");

-- CreateIndex
CREATE INDEX "analytics_dimension_versions_organizationId_effectiveFrom_idx" ON "analytics_dimension_versions"("organizationId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "analytics_metrics_key_key" ON "analytics_metrics"("key");

-- CreateIndex
CREATE UNIQUE INDEX "analytics_metric_versions_metricId_version_key" ON "analytics_metric_versions"("metricId", "version");

-- CreateIndex
CREATE INDEX "analytics_fact_leads_organizationId_businessDate_idx" ON "analytics_fact_leads"("organizationId", "businessDate");

-- CreateIndex
CREATE INDEX "analytics_fact_leads_organizationId_ownerMembershipId_idx" ON "analytics_fact_leads"("organizationId", "ownerMembershipId");

-- CreateIndex
CREATE UNIQUE INDEX "analytics_fact_leads_organizationId_sourceId_key" ON "analytics_fact_leads"("organizationId", "sourceId");

-- CreateIndex
CREATE INDEX "analytics_fact_activities_organizationId_businessDate_idx" ON "analytics_fact_activities"("organizationId", "businessDate");

-- CreateIndex
CREATE INDEX "analytics_fact_activities_organizationId_dueDate_idx" ON "analytics_fact_activities"("organizationId", "dueDate");

-- CreateIndex
CREATE INDEX "analytics_fact_activities_organizationId_ownerMembershipId_idx" ON "analytics_fact_activities"("organizationId", "ownerMembershipId");

-- CreateIndex
CREATE INDEX "analytics_fact_activities_organizationId_companyId_idx" ON "analytics_fact_activities"("organizationId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "analytics_fact_activities_organizationId_sourceId_key" ON "analytics_fact_activities"("organizationId", "sourceId");

-- CreateIndex
CREATE INDEX "analytics_fact_deal_events_organizationId_dealId_idx" ON "analytics_fact_deal_events"("organizationId", "dealId");

-- CreateIndex
CREATE INDEX "analytics_fact_deal_events_organizationId_businessDate_idx" ON "analytics_fact_deal_events"("organizationId", "businessDate");

-- CreateIndex
CREATE UNIQUE INDEX "analytics_fact_deal_events_organizationId_sourceId_key" ON "analytics_fact_deal_events"("organizationId", "sourceId");

-- CreateIndex
CREATE INDEX "analytics_fact_deal_snapshots_organizationId_snapshotDate_idx" ON "analytics_fact_deal_snapshots"("organizationId", "snapshotDate");

-- CreateIndex
CREATE INDEX "analytics_fact_deal_snapshots_organizationId_ownerMembershi_idx" ON "analytics_fact_deal_snapshots"("organizationId", "ownerMembershipId", "snapshotDate");

-- CreateIndex
CREATE UNIQUE INDEX "analytics_fact_deal_snapshots_organizationId_dealId_snapsho_key" ON "analytics_fact_deal_snapshots"("organizationId", "dealId", "snapshotDate");

-- CreateIndex
CREATE INDEX "analytics_fact_quotes_organizationId_businessDate_idx" ON "analytics_fact_quotes"("organizationId", "businessDate");

-- CreateIndex
CREATE UNIQUE INDEX "analytics_fact_quotes_organizationId_sourceId_key" ON "analytics_fact_quotes"("organizationId", "sourceId");

-- CreateIndex
CREATE INDEX "analytics_fact_orders_organizationId_businessDate_idx" ON "analytics_fact_orders"("organizationId", "businessDate");

-- CreateIndex
CREATE UNIQUE INDEX "analytics_fact_orders_organizationId_sourceId_key" ON "analytics_fact_orders"("organizationId", "sourceId");

-- CreateIndex
CREATE INDEX "analytics_fact_contracts_organizationId_endDate_idx" ON "analytics_fact_contracts"("organizationId", "endDate");

-- CreateIndex
CREATE UNIQUE INDEX "analytics_fact_contracts_organizationId_sourceId_key" ON "analytics_fact_contracts"("organizationId", "sourceId");

-- CreateIndex
CREATE INDEX "analytics_fact_support_organizationId_businessDate_idx" ON "analytics_fact_support"("organizationId", "businessDate");

-- CreateIndex
CREATE INDEX "analytics_fact_support_organizationId_assignedMembershipId_idx" ON "analytics_fact_support"("organizationId", "assignedMembershipId");

-- CreateIndex
CREATE UNIQUE INDEX "analytics_fact_support_organizationId_sourceId_key" ON "analytics_fact_support"("organizationId", "sourceId");

-- CreateIndex
CREATE INDEX "analytics_fact_projects_organizationId_businessDate_idx" ON "analytics_fact_projects"("organizationId", "businessDate");

-- CreateIndex
CREATE UNIQUE INDEX "analytics_fact_projects_organizationId_sourceId_key" ON "analytics_fact_projects"("organizationId", "sourceId");

-- CreateIndex
CREATE INDEX "analytics_fact_tasks_organizationId_projectId_idx" ON "analytics_fact_tasks"("organizationId", "projectId");

-- CreateIndex
CREATE INDEX "analytics_fact_tasks_organizationId_businessDate_idx" ON "analytics_fact_tasks"("organizationId", "businessDate");

-- CreateIndex
CREATE UNIQUE INDEX "analytics_fact_tasks_organizationId_sourceId_key" ON "analytics_fact_tasks"("organizationId", "sourceId");

-- CreateIndex
CREATE INDEX "analytics_fact_time_organizationId_businessDate_idx" ON "analytics_fact_time"("organizationId", "businessDate");

-- CreateIndex
CREATE INDEX "analytics_fact_time_organizationId_projectId_idx" ON "analytics_fact_time"("organizationId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "analytics_fact_time_organizationId_sourceId_key" ON "analytics_fact_time"("organizationId", "sourceId");

-- CreateIndex
CREATE INDEX "analytics_fact_invoices_organizationId_businessDate_idx" ON "analytics_fact_invoices"("organizationId", "businessDate");

-- CreateIndex
CREATE INDEX "analytics_fact_invoices_organizationId_dueDate_idx" ON "analytics_fact_invoices"("organizationId", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "analytics_fact_invoices_organizationId_sourceId_key" ON "analytics_fact_invoices"("organizationId", "sourceId");

-- CreateIndex
CREATE INDEX "analytics_fact_payments_organizationId_businessDate_idx" ON "analytics_fact_payments"("organizationId", "businessDate");

-- CreateIndex
CREATE UNIQUE INDEX "analytics_fact_payments_organizationId_sourceId_key" ON "analytics_fact_payments"("organizationId", "sourceId");

-- CreateIndex
CREATE INDEX "analytics_fact_expenses_organizationId_businessDate_idx" ON "analytics_fact_expenses"("organizationId", "businessDate");

-- CreateIndex
CREATE UNIQUE INDEX "analytics_fact_expenses_organizationId_sourceId_key" ON "analytics_fact_expenses"("organizationId", "sourceId");

-- CreateIndex
CREATE INDEX "analytics_fact_ai_usage_organizationId_businessDate_idx" ON "analytics_fact_ai_usage"("organizationId", "businessDate");

-- CreateIndex
CREATE UNIQUE INDEX "analytics_fact_ai_usage_organizationId_sourceId_key" ON "analytics_fact_ai_usage"("organizationId", "sourceId");

-- CreateIndex
CREATE INDEX "analytics_fact_ai_events_organizationId_businessDate_idx" ON "analytics_fact_ai_events"("organizationId", "businessDate");

-- CreateIndex
CREATE UNIQUE INDEX "analytics_fact_ai_events_organizationId_kind_sourceId_key" ON "analytics_fact_ai_events"("organizationId", "kind", "sourceId");

-- CreateIndex
CREATE INDEX "analytics_fact_snapshots_organizationId_kind_snapshotDate_idx" ON "analytics_fact_snapshots"("organizationId", "kind", "snapshotDate");

-- CreateIndex
CREATE UNIQUE INDEX "analytics_fact_snapshots_organizationId_kind_key_snapshotDa_key" ON "analytics_fact_snapshots"("organizationId", "kind", "key", "snapshotDate");

-- CreateIndex
CREATE UNIQUE INDEX "analytics_fact_budgets_organizationId_budgetId_snapshotDate_key" ON "analytics_fact_budgets"("organizationId", "budgetId", "snapshotDate");

-- CreateIndex
CREATE INDEX "analytics_exchange_rates_organizationId_baseCurrency_quoteC_idx" ON "analytics_exchange_rates"("organizationId", "baseCurrency", "quoteCurrency", "effectiveDate");

-- CreateIndex
CREATE UNIQUE INDEX "analytics_exchange_rates_organizationId_sourceRateId_versio_key" ON "analytics_exchange_rates"("organizationId", "sourceRateId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "analytics_fiscal_calendars_organizationId_key" ON "analytics_fiscal_calendars"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "analytics_warehouse_jobs_publicId_key" ON "analytics_warehouse_jobs"("publicId");

-- CreateIndex
CREATE INDEX "analytics_warehouse_jobs_organizationId_source_createdAt_idx" ON "analytics_warehouse_jobs"("organizationId", "source", "createdAt");

-- CreateIndex
CREATE INDEX "analytics_warehouse_jobs_status_idx" ON "analytics_warehouse_jobs"("status");

-- CreateIndex
CREATE UNIQUE INDEX "analytics_job_checkpoints_organizationId_source_key" ON "analytics_job_checkpoints"("organizationId", "source");

-- CreateIndex
CREATE INDEX "analytics_reconciliation_runs_organizationId_source_created_idx" ON "analytics_reconciliation_runs"("organizationId", "source", "createdAt");

-- CreateIndex
CREATE INDEX "analytics_data_quality_issues_organizationId_status_idx" ON "analytics_data_quality_issues"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "analytics_data_quality_issues_organizationId_source_issueTy_key" ON "analytics_data_quality_issues"("organizationId", "source", "issueType", "status");

-- CreateIndex
CREATE UNIQUE INDEX "analytics_reports_publicId_key" ON "analytics_reports"("publicId");

-- CreateIndex
CREATE INDEX "analytics_reports_organizationId_visibility_idx" ON "analytics_reports"("organizationId", "visibility");

-- CreateIndex
CREATE UNIQUE INDEX "analytics_report_versions_reportId_version_key" ON "analytics_report_versions"("reportId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "analytics_report_shares_reportId_targetType_targetId_key" ON "analytics_report_shares"("reportId", "targetType", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "analytics_report_schedules_publicId_key" ON "analytics_report_schedules"("publicId");

-- CreateIndex
CREATE INDEX "analytics_report_schedules_active_nextRunAt_idx" ON "analytics_report_schedules"("active", "nextRunAt");

-- CreateIndex
CREATE UNIQUE INDEX "analytics_schedule_runs_occurrenceKey_key" ON "analytics_schedule_runs"("occurrenceKey");

-- CreateIndex
CREATE INDEX "analytics_schedule_runs_scheduleId_scheduledFor_idx" ON "analytics_schedule_runs"("scheduleId", "scheduledFor");

-- CreateIndex
CREATE UNIQUE INDEX "analytics_export_jobs_publicId_key" ON "analytics_export_jobs"("publicId");

-- CreateIndex
CREATE INDEX "analytics_export_jobs_organizationId_status_idx" ON "analytics_export_jobs"("organizationId", "status");

-- CreateIndex
CREATE INDEX "analytics_export_jobs_requestedByMembershipId_createdAt_idx" ON "analytics_export_jobs"("requestedByMembershipId", "createdAt");

-- CreateIndex
CREATE INDEX "analytics_export_downloads_exportJobId_idx" ON "analytics_export_downloads"("exportJobId");


-- ---- Backend Phase 12: analytics schema, materialized aggregates, date dimension ----
CREATE SCHEMA IF NOT EXISTS analytics;

-- Date dimension 2015-01-01 .. 2040-12-31 (calendar attributes; fiscal attributes are
-- derived per organization from analytics_fiscal_calendars at query time).
INSERT INTO "analytics_dim_date" ("date","year","quarter","month","day","isoWeek","isoYear","dayOfWeek","isWeekend","monthStart","quarterStart")
SELECT d::date, EXTRACT(YEAR FROM d)::int, EXTRACT(QUARTER FROM d)::int, EXTRACT(MONTH FROM d)::int, EXTRACT(DAY FROM d)::int,
       EXTRACT(WEEK FROM d)::int, EXTRACT(ISOYEAR FROM d)::int, EXTRACT(ISODOW FROM d)::int, EXTRACT(ISODOW FROM d) IN (6,7),
       date_trunc('month', d)::date, date_trunc('quarter', d)::date
FROM generate_series('2015-01-01'::date, '2040-12-31'::date, interval '1 day') AS d
ON CONFLICT DO NOTHING;

-- Pipeline by day, owner scope and currency (from deal snapshots).
CREATE MATERIALIZED VIEW analytics.mv_pipeline_daily AS
SELECT "organizationId" AS organization_id, "snapshotDate" AS snapshot_date, COALESCE("ownerMembershipId", '') AS owner_membership_id,
       COALESCE("department", '') AS department, COALESCE("team", '') AS team, "currency", "baseCurrency" AS base_currency, "isOpen" AS is_open,
       COUNT(*)::int AS deals, SUM("amount") AS amount, SUM("weightedAmount") AS weighted_amount,
       SUM("baseAmount") AS base_amount, SUM("baseWeightedAmount") AS base_weighted_amount,
       COUNT(*) FILTER (WHERE "conversionStatus" = 'Unavailable')::int AS unconverted
FROM "analytics_fact_deal_snapshots"
GROUP BY 1,2,3,4,5,6,7,8;
CREATE UNIQUE INDEX mv_pipeline_daily_key ON analytics.mv_pipeline_daily (organization_id, snapshot_date, owner_membership_id, department, team, currency, base_currency, is_open);

-- Invoiced amounts by month, status and currency.
CREATE MATERIALIZED VIEW analytics.mv_invoice_monthly AS
SELECT "organizationId" AS organization_id, date_trunc('month', "businessDate")::date AS month, COALESCE("ownerMembershipId", '') AS owner_membership_id,
       COALESCE("department", '') AS department, COALESCE("team", '') AS team, "status", "currency", "baseCurrency" AS base_currency,
       COUNT(*)::int AS invoices, SUM("amount") AS amount, SUM("amountDue") AS amount_due, SUM("baseAmount") AS base_amount,
       COUNT(*) FILTER (WHERE "conversionStatus" = 'Unavailable')::int AS unconverted
FROM "analytics_fact_invoices" WHERE NOT "isDeleted"
GROUP BY 1,2,3,4,5,6,7,8;
CREATE UNIQUE INDEX mv_invoice_monthly_key ON analytics.mv_invoice_monthly (organization_id, month, owner_membership_id, department, team, status, currency, base_currency);

-- Activities by day, type and status.
CREATE MATERIALIZED VIEW analytics.mv_activity_daily AS
SELECT "organizationId" AS organization_id, "businessDate" AS business_date, COALESCE("ownerMembershipId", '') AS owner_membership_id,
       COALESCE("department", '') AS department, COALESCE("team", '') AS team, "type", "status", COUNT(*)::int AS activities
FROM "analytics_fact_activities" WHERE NOT "isDeleted"
GROUP BY 1,2,3,4,5,6,7;
CREATE UNIQUE INDEX mv_activity_daily_key ON analytics.mv_activity_daily (organization_id, business_date, owner_membership_id, department, team, type, status);

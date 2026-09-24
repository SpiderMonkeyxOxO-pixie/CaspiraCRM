-- AlterTable
ALTER TABLE "ai_requests" ADD COLUMN     "capabilityKey" TEXT,
ADD COLUMN     "moderation" JSONB,
ADD COLUMN     "releaseId" TEXT,
ADD COLUMN     "safetyIdVersion" TEXT;

-- AlterTable
ALTER TABLE "ai_usage_records" ADD COLUMN     "billingSource" TEXT NOT NULL DEFAULT 'Organization key',
ADD COLUMN     "capabilityKey" TEXT,
ADD COLUMN     "promptVersion" TEXT,
ADD COLUMN     "releaseId" TEXT;

-- CreateTable
CREATE TABLE "ai_capabilities" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "riskLevel" TEXT NOT NULL,
    "owners" JSONB NOT NULL DEFAULT '{}',
    "organizationScope" JSONB NOT NULL DEFAULT '[]',
    "roles" JSONB NOT NULL DEFAULT '[]',
    "modules" JSONB NOT NULL DEFAULT '[]',
    "dataClassifications" JSONB NOT NULL DEFAULT '{}',
    "providers" JSONB NOT NULL DEFAULT '[]',
    "models" JSONB NOT NULL DEFAULT '[]',
    "promptVersions" JSONB NOT NULL DEFAULT '[]',
    "toolVersions" JSONB NOT NULL DEFAULT '[]',
    "workflowVersions" JSONB NOT NULL DEFAULT '[]',
    "requiredApprovals" JSONB NOT NULL DEFAULT '[]',
    "evaluationSuiteKey" TEXT,
    "retentionPolicy" JSONB NOT NULL DEFAULT '{}',
    "budgetPolicy" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "currentReleaseId" TEXT,
    "lastReviewAt" TIMESTAMP(3),
    "nextReviewAt" TIMESTAMP(3),
    "sunsetAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_capabilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_capability_versions" (
    "id" TEXT NOT NULL,
    "capabilityId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "changeSummary" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_capability_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_governance_policies" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "organizationId" TEXT,
    "scope" TEXT NOT NULL,
    "capabilityKey" TEXT,
    "name" TEXT NOT NULL,
    "riskLevel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "activeVersionId" TEXT,
    "latestVersion" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_governance_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_governance_policy_versions" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "organizationId" TEXT,
    "version" INTEGER NOT NULL,
    "body" JSONB NOT NULL,
    "checksum" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "changeSummary" TEXT NOT NULL,
    "authorUserId" TEXT,
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_governance_policy_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_governance_approvals" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "subjectVersion" INTEGER,
    "reviewerUserId" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "role" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_governance_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_provider_governance" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "scope" TEXT NOT NULL,
    "providerKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Not configured',
    "credentialStatus" TEXT NOT NULL DEFAULT 'Not configured',
    "contractOwner" TEXT,
    "dpaStatus" TEXT NOT NULL DEFAULT 'Unverified',
    "approvedClassifications" JSONB NOT NULL DEFAULT '[]',
    "prohibitedClassifications" JSONB NOT NULL DEFAULT '[]',
    "region" TEXT,
    "residencyStatus" TEXT NOT NULL DEFAULT 'Unverified',
    "retentionMode" TEXT NOT NULL DEFAULT 'Unverified',
    "zdrEligibility" TEXT NOT NULL DEFAULT 'Unverified',
    "hostedStorage" TEXT NOT NULL DEFAULT 'Off',
    "approvedModels" JSONB NOT NULL DEFAULT '[]',
    "rateLimits" JSONB NOT NULL DEFAULT '{}',
    "spendLimits" JSONB NOT NULL DEFAULT '{}',
    "incidentContact" TEXT,
    "lastVerifiedAt" TIMESTAMP(3),
    "lastSecurityReviewAt" TIMESTAMP(3),
    "nextReviewAt" TIMESTAMP(3),
    "deprecations" JSONB NOT NULL DEFAULT '[]',
    "limitations" JSONB NOT NULL DEFAULT '[]',
    "confirmations" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_provider_governance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_model_governance" (
    "id" TEXT NOT NULL,
    "providerKey" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT true,
    "capabilities" JSONB NOT NULL DEFAULT '[]',
    "modalities" JSONB NOT NULL DEFAULT '["text"]',
    "tools" BOOLEAN NOT NULL DEFAULT false,
    "structuredOutput" BOOLEAN NOT NULL DEFAULT false,
    "contextLimit" INTEGER,
    "outputLimit" INTEGER,
    "retentionClass" TEXT NOT NULL DEFAULT 'Unverified',
    "approvedUseCases" JSONB NOT NULL DEFAULT '[]',
    "prohibitedUseCases" JSONB NOT NULL DEFAULT '[]',
    "pricingVersion" TEXT,
    "evaluationStatus" TEXT NOT NULL DEFAULT 'Not evaluated',
    "releaseStatus" TEXT NOT NULL DEFAULT 'Draft',
    "lastVerifiedAt" TIMESTAMP(3),
    "deprecationAt" TIMESTAMP(3),
    "replacementModelId" TEXT,
    "rollbackModelId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_model_governance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_prompt_governance" (
    "id" TEXT NOT NULL,
    "promptKey" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "capabilityKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "providerCompat" JSONB NOT NULL DEFAULT '[]',
    "modelCompat" JSONB NOT NULL DEFAULT '[]',
    "inputSchema" JSONB NOT NULL DEFAULT '{}',
    "outputSchema" TEXT,
    "toolAllowlist" JSONB NOT NULL DEFAULT '[]',
    "dataClassifications" JSONB NOT NULL DEFAULT '[]',
    "safetyInstructions" TEXT NOT NULL DEFAULT '',
    "citationRules" TEXT NOT NULL DEFAULT '',
    "refusalBehavior" TEXT NOT NULL DEFAULT '',
    "humanApproval" TEXT NOT NULL DEFAULT '',
    "changeSummary" TEXT NOT NULL DEFAULT '',
    "checksum" TEXT NOT NULL,
    "authorUserId" TEXT,
    "reviewers" JSONB NOT NULL DEFAULT '[]',
    "evaluationRunIds" JSONB NOT NULL DEFAULT '[]',
    "approvedAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "retiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_prompt_governance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_tool_governance" (
    "id" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "riskLevel" TEXT NOT NULL,
    "requiredPermission" TEXT,
    "requiredApproval" TEXT,
    "modules" JSONB NOT NULL DEFAULT '[]',
    "fields" JSONB NOT NULL DEFAULT '[]',
    "inputSchema" JSONB NOT NULL DEFAULT '{}',
    "outputSchema" JSONB NOT NULL DEFAULT '{}',
    "maxResults" INTEGER NOT NULL DEFAULT 25,
    "maxRuntimeMs" INTEGER NOT NULL DEFAULT 10000,
    "rateLimitPerMinute" INTEGER NOT NULL DEFAULT 30,
    "auditBehavior" TEXT NOT NULL DEFAULT 'Tool call and result references recorded',
    "owner" TEXT,
    "evaluationSuiteKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "activation" JSONB NOT NULL DEFAULT '{}',
    "activatedAt" TIMESTAMP(3),
    "rowVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_tool_governance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_workflow_governance" (
    "id" TEXT NOT NULL,
    "workflowKey" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "purpose" TEXT NOT NULL,
    "steps" JSONB NOT NULL,
    "tools" JSONB NOT NULL DEFAULT '[]',
    "maxProviderCalls" INTEGER NOT NULL,
    "maxToolCalls" INTEGER NOT NULL,
    "maxRuntimeMs" INTEGER NOT NULL,
    "maxCostUsd" DECIMAL(14,6) NOT NULL,
    "approvalCheckpoints" JSONB NOT NULL DEFAULT '[]',
    "escalation" TEXT NOT NULL DEFAULT '',
    "failureBehavior" TEXT NOT NULL DEFAULT '',
    "rollbackBehavior" TEXT NOT NULL DEFAULT '',
    "owners" JSONB NOT NULL DEFAULT '{}',
    "evaluationRunIds" JSONB NOT NULL DEFAULT '[]',
    "checksum" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "activatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_workflow_governance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_evaluation_suites" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL,
    "capabilityKey" TEXT,
    "datasetVersionIds" JSONB NOT NULL DEFAULT '[]',
    "graderKeys" JSONB NOT NULL DEFAULT '[]',
    "qualityGates" JSONB NOT NULL DEFAULT '[]',
    "zeroToleranceCategories" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'Active',
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_evaluation_suites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_evaluation_datasets" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'Synthetic',
    "ownerUserId" TEXT,
    "authorization" JSONB,
    "retentionDays" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_evaluation_datasets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_evaluation_dataset_versions" (
    "id" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "organizationId" TEXT,
    "version" INTEGER NOT NULL,
    "caseCount" INTEGER NOT NULL DEFAULT 0,
    "checksum" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Published',
    "notes" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_evaluation_dataset_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_evaluation_cases" (
    "id" TEXT NOT NULL,
    "datasetVersionId" TEXT NOT NULL,
    "organizationId" TEXT,
    "key" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "capabilityKey" TEXT,
    "input" JSONB NOT NULL,
    "expectations" JSONB NOT NULL,
    "zeroTolerance" JSONB NOT NULL DEFAULT '[]',
    "tags" JSONB NOT NULL DEFAULT '[]',
    "sourceIncidentId" TEXT,
    "redacted" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_evaluation_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_evaluation_graders" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "rubric" TEXT,
    "config" JSONB NOT NULL DEFAULT '{}',
    "calibration" JSONB NOT NULL DEFAULT '{}',
    "authoritative" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_evaluation_graders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_eval_runs" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "suiteId" TEXT NOT NULL,
    "candidate" JSONB NOT NULL,
    "releaseId" TEXT,
    "trigger" TEXT NOT NULL DEFAULT 'manual',
    "status" TEXT NOT NULL DEFAULT 'Queued',
    "sampleSize" INTEGER NOT NULL DEFAULT 0,
    "completedCases" INTEGER NOT NULL DEFAULT 0,
    "passed" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "errored" INTEGER NOT NULL DEFAULT 0,
    "needsReview" INTEGER NOT NULL DEFAULT 0,
    "zeroToleranceFailures" INTEGER NOT NULL DEFAULT 0,
    "metrics" JSONB NOT NULL DEFAULT '{}',
    "gateResults" JSONB NOT NULL DEFAULT '[]',
    "estimatedCost" DECIMAL(14,6),
    "usage" JSONB NOT NULL DEFAULT '{}',
    "createdByUserId" TEXT,
    "reviewedByUserId" TEXT,
    "reviewDecision" TEXT,
    "reviewReason" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_eval_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_eval_results" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "graderVerdicts" JSONB NOT NULL DEFAULT '[]',
    "disagreement" BOOLEAN NOT NULL DEFAULT false,
    "zeroToleranceCategory" TEXT,
    "metrics" JSONB NOT NULL DEFAULT '{}',
    "requestIds" JSONB NOT NULL DEFAULT '[]',
    "outputDigest" TEXT,
    "safeExcerpt" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_eval_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_evaluation_comparisons" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dimension" TEXT NOT NULL,
    "baselineRunId" TEXT NOT NULL,
    "candidateRunId" TEXT NOT NULL,
    "summary" JSONB NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_evaluation_comparisons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_releases" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "organizationId" TEXT,
    "scope" TEXT NOT NULL,
    "capabilityKey" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "riskLevel" TEXT NOT NULL,
    "manifest" JSONB NOT NULL,
    "manifestChecksum" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "stage" TEXT NOT NULL DEFAULT 'development',
    "environment" TEXT NOT NULL DEFAULT 'development',
    "authorUserId" TEXT,
    "previousReleaseId" TEXT,
    "rolledBackFromId" TEXT,
    "promotionBlocked" BOOLEAN NOT NULL DEFAULT false,
    "promotionBlockReason" TEXT,
    "notes" TEXT,
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "promotedAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "rolledBackAt" TIMESTAMP(3),
    "retiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_releases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_release_gates" (
    "id" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "gateKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "mandatory" BOOLEAN NOT NULL DEFAULT true,
    "threshold" JSONB,
    "result" JSONB,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "runId" TEXT,
    "datasetVersion" TEXT,
    "sampleSize" INTEGER,
    "reviewerUserId" TEXT,
    "evaluatedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "ai_release_gates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_rollout_cohorts" (
    "id" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "organizationId" TEXT,
    "stage" TEXT NOT NULL,
    "rules" JSONB NOT NULL DEFAULT '{}',
    "stopConditions" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'Active',
    "approvedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_rollout_cohorts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_feature_flags" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "organizationId" TEXT,
    "environment" TEXT NOT NULL DEFAULT 'all',
    "capabilityKey" TEXT,
    "targeting" JSONB NOT NULL DEFAULT '{}',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_feature_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_readiness_items" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "organizationId" TEXT,
    "capabilityKey" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "mandatory" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'Incomplete',
    "source" TEXT NOT NULL DEFAULT 'manual',
    "evidence" TEXT,
    "confirmedByUserId" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_readiness_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_safety_events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "membershipId" TEXT,
    "conversationId" TEXT,
    "requestId" TEXT,
    "capabilityKey" TEXT,
    "severity" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "providerKey" TEXT,
    "modelId" TEXT,
    "summary" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "actionTaken" TEXT NOT NULL,
    "reviewStatus" TEXT NOT NULL DEFAULT 'Open',
    "correlationId" TEXT,
    "incidentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_safety_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_incidents" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "organizationId" TEXT,
    "scope" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Detected',
    "capabilityKey" TEXT,
    "ownerUserId" TEXT,
    "detectedBy" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "rootCause" TEXT,
    "remediation" TEXT,
    "containment" JSONB NOT NULL DEFAULT '[]',
    "regressionCaseIds" JSONB NOT NULL DEFAULT '[]',
    "restorationApprovedByUserId" TEXT,
    "restorationApprovedAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "containedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_incident_events" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "organizationId" TEXT,
    "type" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "note" TEXT,
    "actorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_incident_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_incident_evidence" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "organizationId" TEXT,
    "kind" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "hash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "addedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_incident_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_kill_switches" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "organizationId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "activeWorkPolicy" TEXT NOT NULL DEFAULT 'cancel_queued',
    "reason" TEXT,
    "activatedByUserId" TEXT,
    "activatedAt" TIMESTAMP(3),
    "deactivatedByUserId" TEXT,
    "deactivatedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_kill_switches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_emergency_exceptions" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "organizationId" TEXT,
    "scope" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "approvedByUserId" TEXT,
    "systemOwnerReviewedByUserId" TEXT,
    "reason" TEXT NOT NULL,
    "target" JSONB NOT NULL,
    "compensatingControls" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Requested',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "postReviewDueAt" TIMESTAMP(3),
    "postReviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_emergency_exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_slo_definitions" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "comparator" TEXT NOT NULL,
    "objective" DECIMAL(14,4) NOT NULL,
    "unit" TEXT NOT NULL,
    "windowMinutes" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_slo_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_slo_measurements" (
    "id" TEXT NOT NULL,
    "sloId" TEXT NOT NULL,
    "organizationId" TEXT,
    "scope" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "value" DECIMAL(14,4),
    "sampleSize" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_slo_measurements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_alert_rules" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "comparator" TEXT NOT NULL DEFAULT 'gte',
    "threshold" DECIMAL(14,4) NOT NULL,
    "windowMinutes" INTEGER NOT NULL DEFAULT 15,
    "minSamples" INTEGER NOT NULL DEFAULT 1,
    "cooldownMinutes" INTEGER NOT NULL DEFAULT 60,
    "escalateAfterMinutes" INTEGER NOT NULL DEFAULT 60,
    "severity" TEXT NOT NULL DEFAULT 'Medium',
    "notifyRoleKeys" JSONB NOT NULL DEFAULT '["admin"]',
    "suppressedUntil" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_alert_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_alert_events" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "organizationId" TEXT,
    "scope" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Open',
    "severity" TEXT NOT NULL,
    "value" DECIMAL(14,4),
    "count" INTEGER NOT NULL DEFAULT 1,
    "summary" TEXT NOT NULL,
    "firstAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedByUserId" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "resolvedByUserId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "escalatedAt" TIMESTAMP(3),
    "note" TEXT,

    CONSTRAINT "ai_alert_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_human_review_items" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "scope" TEXT NOT NULL,
    "queue" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'Normal',
    "status" TEXT NOT NULL DEFAULT 'Open',
    "summary" TEXT NOT NULL,
    "context" JSONB NOT NULL DEFAULT '{}',
    "recommendedDecision" TEXT,
    "createdByUserId" TEXT,
    "assignedToUserId" TEXT,
    "decidedByUserId" TEXT,
    "decision" TEXT,
    "reason" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_human_review_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_provider_invoices" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "providerKey" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "invoicedAmount" DECIMAL(14,6) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "estimatedAmount" DECIMAL(14,6),
    "difference" DECIMAL(14,6),
    "status" TEXT NOT NULL DEFAULT 'Entered',
    "notes" TEXT,
    "enteredByUserId" TEXT,
    "reconciledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_provider_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_capabilities_key_key" ON "ai_capabilities"("key");

-- CreateIndex
CREATE UNIQUE INDEX "ai_capability_versions_capabilityId_version_key" ON "ai_capability_versions"("capabilityId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ai_governance_policies_publicId_key" ON "ai_governance_policies"("publicId");

-- CreateIndex
CREATE INDEX "ai_governance_policies_scope_status_idx" ON "ai_governance_policies"("scope", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ai_governance_policy_versions_policyId_version_key" ON "ai_governance_policy_versions"("policyId", "version");

-- CreateIndex
CREATE INDEX "ai_governance_approvals_subjectType_subjectId_idx" ON "ai_governance_approvals"("subjectType", "subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "ai_provider_governance_scope_providerKey_key" ON "ai_provider_governance"("scope", "providerKey");

-- CreateIndex
CREATE UNIQUE INDEX "ai_model_governance_providerKey_modelId_key" ON "ai_model_governance"("providerKey", "modelId");

-- CreateIndex
CREATE UNIQUE INDEX "ai_prompt_governance_promptKey_version_key" ON "ai_prompt_governance"("promptKey", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ai_tool_governance_toolName_version_key" ON "ai_tool_governance"("toolName", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ai_workflow_governance_workflowKey_version_key" ON "ai_workflow_governance"("workflowKey", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ai_evaluation_suites_key_version_key" ON "ai_evaluation_suites"("key", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ai_evaluation_datasets_scope_key_key" ON "ai_evaluation_datasets"("scope", "key");

-- CreateIndex
CREATE UNIQUE INDEX "ai_evaluation_dataset_versions_datasetId_version_key" ON "ai_evaluation_dataset_versions"("datasetId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ai_evaluation_cases_datasetVersionId_key_key" ON "ai_evaluation_cases"("datasetVersionId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "ai_evaluation_graders_key_key" ON "ai_evaluation_graders"("key");

-- CreateIndex
CREATE UNIQUE INDEX "ai_eval_runs_publicId_key" ON "ai_eval_runs"("publicId");

-- CreateIndex
CREATE INDEX "ai_eval_runs_organizationId_status_idx" ON "ai_eval_runs"("organizationId", "status");

-- CreateIndex
CREATE INDEX "ai_eval_results_runId_idx" ON "ai_eval_results"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "ai_releases_publicId_key" ON "ai_releases"("publicId");

-- CreateIndex
CREATE INDEX "ai_releases_capabilityKey_status_idx" ON "ai_releases"("capabilityKey", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ai_releases_scope_capabilityKey_version_key" ON "ai_releases"("scope", "capabilityKey", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ai_release_gates_releaseId_gateKey_key" ON "ai_release_gates"("releaseId", "gateKey");

-- CreateIndex
CREATE UNIQUE INDEX "ai_feature_flags_key_scope_environment_key" ON "ai_feature_flags"("key", "scope", "environment");

-- CreateIndex
CREATE UNIQUE INDEX "ai_readiness_items_scope_capabilityKey_key_key" ON "ai_readiness_items"("scope", "capabilityKey", "key");

-- CreateIndex
CREATE INDEX "ai_safety_events_organizationId_createdAt_idx" ON "ai_safety_events"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_safety_events_category_createdAt_idx" ON "ai_safety_events"("category", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ai_incidents_publicId_key" ON "ai_incidents"("publicId");

-- CreateIndex
CREATE INDEX "ai_incidents_scope_status_idx" ON "ai_incidents"("scope", "status");

-- CreateIndex
CREATE INDEX "ai_incident_events_incidentId_idx" ON "ai_incident_events"("incidentId");

-- CreateIndex
CREATE INDEX "ai_incident_evidence_incidentId_idx" ON "ai_incident_evidence"("incidentId");

-- CreateIndex
CREATE UNIQUE INDEX "ai_kill_switches_kind_target_scope_key" ON "ai_kill_switches"("kind", "target", "scope");

-- CreateIndex
CREATE UNIQUE INDEX "ai_emergency_exceptions_publicId_key" ON "ai_emergency_exceptions"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "ai_slo_definitions_key_key" ON "ai_slo_definitions"("key");

-- CreateIndex
CREATE UNIQUE INDEX "ai_slo_measurements_sloId_scope_windowStart_key" ON "ai_slo_measurements"("sloId", "scope", "windowStart");

-- CreateIndex
CREATE UNIQUE INDEX "ai_alert_rules_key_key" ON "ai_alert_rules"("key");

-- CreateIndex
CREATE INDEX "ai_alert_events_scope_status_idx" ON "ai_alert_events"("scope", "status");

-- CreateIndex
CREATE INDEX "ai_alert_events_dedupeKey_status_idx" ON "ai_alert_events"("dedupeKey", "status");

-- CreateIndex
CREATE INDEX "ai_human_review_items_scope_queue_status_idx" ON "ai_human_review_items"("scope", "queue", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ai_provider_invoices_organizationId_providerKey_periodKey_key" ON "ai_provider_invoices"("organizationId", "providerKey", "periodKey");


-- Existing simulator usage is not organization-key spend.
UPDATE "ai_usage_records" SET "billingSource" = 'Simulator' WHERE "mode" = 'Simulator';

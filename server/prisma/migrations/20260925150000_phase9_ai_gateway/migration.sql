-- CreateTable
CREATE TABLE "ai_providers" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "authType" TEXT NOT NULL,
    "capabilities" JSONB NOT NULL DEFAULT '[]',
    "availability" TEXT NOT NULL,
    "availabilityReason" TEXT,
    "dataRetentionNote" TEXT,
    "docsUrl" TEXT,
    "dataPolicyUrl" TEXT,
    "adapterVersion" TEXT,
    "enabledByDefault" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_provider_connections" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "providerKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'Live',
    "status" TEXT NOT NULL DEFAULT 'Configuration Incomplete',
    "keyHint" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "verifiedModels" JSONB NOT NULL DEFAULT '[]',
    "lastErrorCode" TEXT,
    "lastErrorMessage" TEXT,
    "rateLimitedUntil" TIMESTAMP(3),
    "circuitOpenUntil" TIMESTAMP(3),
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "disabledAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdByMembershipId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_provider_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_models" (
    "id" TEXT NOT NULL,
    "providerKey" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "capabilities" JSONB NOT NULL DEFAULT '[]',
    "contextWindow" INTEGER,
    "maxOutputTokens" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "source" TEXT NOT NULL DEFAULT 'Catalog',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_model_aliases" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "providerKey" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedByMembershipId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_model_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_price_tables" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "providerKey" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "unit" TEXT NOT NULL DEFAULT 'per_million_tokens',
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "sourceNote" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "createdByMembershipId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_price_tables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_price_entries" (
    "id" TEXT NOT NULL,
    "priceTableId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "inputPrice" DECIMAL(14,6) NOT NULL,
    "outputPrice" DECIMAL(14,6) NOT NULL,
    "cachedInputPrice" DECIMAL(14,6),

    CONSTRAINT "ai_price_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_use_cases" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "allowedAliases" JSONB NOT NULL DEFAULT '[]',
    "maxInputChars" INTEGER NOT NULL,
    "maxOutputTokens" INTEGER NOT NULL,
    "allowedClassifications" JSONB NOT NULL DEFAULT '[]',
    "toolsAllowed" BOOLEAN NOT NULL DEFAULT false,
    "streamingAllowed" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedByMembershipId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_use_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_routing_policies" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "useCaseKey" TEXT NOT NULL,
    "primaryProviderKey" TEXT NOT NULL,
    "primaryAlias" TEXT NOT NULL,
    "fallbackProviderKey" TEXT,
    "fallbackAlias" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedByMembershipId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_routing_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_policies" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "allowedProviders" JSONB NOT NULL DEFAULT '[]',
    "allowedUseCases" JSONB NOT NULL DEFAULT '[]',
    "providerClassifications" JSONB NOT NULL DEFAULT '{}',
    "restrictedFields" JSONB NOT NULL DEFAULT '[]',
    "personalData" TEXT NOT NULL DEFAULT 'Mask',
    "providerStorage" BOOLEAN NOT NULL DEFAULT false,
    "providerMemory" BOOLEAN NOT NULL DEFAULT false,
    "maxRequestsPerUserPerHour" INTEGER NOT NULL DEFAULT 60,
    "actionApprovals" JSONB NOT NULL DEFAULT '{}',
    "retention" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedByMembershipId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_redaction_rules" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "classification" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedByMembershipId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_redaction_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_prompt_templates" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "useCaseKey" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_prompt_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_prompt_template_versions" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "system" TEXT NOT NULL,
    "userTemplate" TEXT NOT NULL,
    "outputSchema" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Published',
    "checksum" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_prompt_template_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_requests" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "membershipId" TEXT,
    "useCaseKey" TEXT NOT NULL,
    "connectionId" TEXT,
    "providerKey" TEXT,
    "modelId" TEXT,
    "alias" TEXT,
    "mode" TEXT,
    "promptTemplateVersionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Queued',
    "errorCategory" TEXT,
    "safeError" TEXT,
    "providerRequestId" TEXT,
    "inputChars" INTEGER NOT NULL DEFAULT 0,
    "outputChars" INTEGER NOT NULL DEFAULT 0,
    "removedFields" JSONB NOT NULL DEFAULT '[]',
    "injectionFlags" JSONB NOT NULL DEFAULT '[]',
    "validation" JSONB,
    "payload" JSONB,
    "payloadExpiresAt" TIMESTAMP(3),
    "result" JSONB,
    "reservationId" TEXT,
    "idempotencyKey" TEXT,
    "correlationId" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_request_events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_request_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_usage_records" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "membershipId" TEXT,
    "requestId" TEXT,
    "useCaseKey" TEXT NOT NULL,
    "providerKey" TEXT NOT NULL,
    "modelId" TEXT,
    "alias" TEXT,
    "mode" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "cachedTokens" INTEGER NOT NULL DEFAULT 0,
    "requests" INTEGER NOT NULL DEFAULT 1,
    "estimatedCost" DECIMAL(14,6),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "costKnown" BOOLEAN NOT NULL DEFAULT false,
    "priceTableId" TEXT,
    "priceTableVersion" INTEGER,
    "outcome" TEXT NOT NULL,
    "errorCategory" TEXT,
    "durationMs" INTEGER,
    "correlationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_budgets" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "scopeRef" TEXT,
    "period" TEXT NOT NULL DEFAULT 'Monthly',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "softLimit" DECIMAL(14,6) NOT NULL,
    "hardLimit" DECIMAL(14,6) NOT NULL,
    "notifyMembershipIds" JSONB NOT NULL DEFAULT '[]',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "warnedPeriodKey" TEXT,
    "exhaustedPeriodKey" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdByMembershipId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_budget_reservations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "budgetId" TEXT NOT NULL,
    "requestId" TEXT,
    "periodKey" TEXT NOT NULL,
    "amount" DECIMAL(14,6) NOT NULL,
    "actualAmount" DECIMAL(14,6),
    "status" TEXT NOT NULL DEFAULT 'Held',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_budget_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_action_proposals" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Awaiting Confirmation',
    "source" TEXT NOT NULL DEFAULT 'User',
    "requestId" TEXT,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "targetVersion" INTEGER,
    "currentValues" JSONB NOT NULL DEFAULT '{}',
    "proposedValues" JSONB NOT NULL DEFAULT '{}',
    "reason" TEXT NOT NULL,
    "evidence" JSONB NOT NULL DEFAULT '[]',
    "requiredPermission" TEXT NOT NULL,
    "approvalRequired" BOOLEAN NOT NULL DEFAULT false,
    "impact" TEXT,
    "proposedByMembershipId" TEXT,
    "confirmedByMembershipId" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "result" JSONB,
    "undoData" JSONB,
    "undoneAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_action_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_action_approvals" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "approverMembershipId" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_action_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_action_executions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'Execute',
    "status" TEXT NOT NULL,
    "result" JSONB,
    "errorMessage" TEXT,
    "executedByMembershipId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ai_action_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_evaluation_scenarios" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "useCaseKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "expectations" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdByMembershipId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_evaluation_scenarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_evaluation_runs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "providerKey" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Queued',
    "scenarioIds" JSONB NOT NULL DEFAULT '[]',
    "passed" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "errored" INTEGER NOT NULL DEFAULT 0,
    "estimatedCost" DECIMAL(14,6),
    "createdByMembershipId" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_evaluation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_evaluation_results" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "reasons" JSONB NOT NULL DEFAULT '[]',
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_evaluation_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_feedback" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "membershipId" TEXT,
    "requestId" TEXT,
    "proposalId" TEXT,
    "scenarioId" TEXT,
    "rating" TEXT NOT NULL,
    "reason" TEXT,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_providers_key_key" ON "ai_providers"("key");

-- CreateIndex
CREATE UNIQUE INDEX "ai_provider_connections_publicId_key" ON "ai_provider_connections"("publicId");

-- CreateIndex
CREATE INDEX "ai_provider_connections_organizationId_status_idx" ON "ai_provider_connections"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ai_provider_connections_organizationId_providerKey_mode_key" ON "ai_provider_connections"("organizationId", "providerKey", "mode");

-- CreateIndex
CREATE UNIQUE INDEX "ai_models_providerKey_modelId_key" ON "ai_models"("providerKey", "modelId");

-- CreateIndex
CREATE INDEX "ai_model_aliases_organizationId_alias_idx" ON "ai_model_aliases"("organizationId", "alias");

-- CreateIndex
CREATE UNIQUE INDEX "ai_model_aliases_organizationId_alias_providerKey_key" ON "ai_model_aliases"("organizationId", "alias", "providerKey");

-- CreateIndex
CREATE INDEX "ai_price_tables_providerKey_status_idx" ON "ai_price_tables"("providerKey", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ai_price_tables_organizationId_providerKey_version_key" ON "ai_price_tables"("organizationId", "providerKey", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ai_price_entries_priceTableId_modelId_key" ON "ai_price_entries"("priceTableId", "modelId");

-- CreateIndex
CREATE UNIQUE INDEX "ai_use_cases_organizationId_key_key" ON "ai_use_cases"("organizationId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "ai_routing_policies_organizationId_useCaseKey_key" ON "ai_routing_policies"("organizationId", "useCaseKey");

-- CreateIndex
CREATE UNIQUE INDEX "ai_policies_organizationId_key" ON "ai_policies"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ai_redaction_rules_organizationId_classification_key" ON "ai_redaction_rules"("organizationId", "classification");

-- CreateIndex
CREATE UNIQUE INDEX "ai_prompt_templates_key_key" ON "ai_prompt_templates"("key");

-- CreateIndex
CREATE UNIQUE INDEX "ai_prompt_template_versions_templateId_version_key" ON "ai_prompt_template_versions"("templateId", "version");

-- CreateIndex
CREATE INDEX "ai_requests_organizationId_createdAt_idx" ON "ai_requests"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_requests_organizationId_membershipId_useCaseKey_idx" ON "ai_requests"("organizationId", "membershipId", "useCaseKey");

-- CreateIndex
CREATE INDEX "ai_requests_providerRequestId_idx" ON "ai_requests"("providerRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "ai_requests_organizationId_idempotencyKey_key" ON "ai_requests"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "ai_request_events_requestId_seq_key" ON "ai_request_events"("requestId", "seq");

-- CreateIndex
CREATE INDEX "ai_usage_records_organizationId_createdAt_idx" ON "ai_usage_records"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_usage_records_organizationId_useCaseKey_createdAt_idx" ON "ai_usage_records"("organizationId", "useCaseKey", "createdAt");

-- CreateIndex
CREATE INDEX "ai_usage_records_organizationId_membershipId_createdAt_idx" ON "ai_usage_records"("organizationId", "membershipId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_budgets_organizationId_active_idx" ON "ai_budgets"("organizationId", "active");

-- CreateIndex
CREATE INDEX "ai_budget_reservations_budgetId_periodKey_status_idx" ON "ai_budget_reservations"("budgetId", "periodKey", "status");

-- CreateIndex
CREATE INDEX "ai_budget_reservations_status_expiresAt_idx" ON "ai_budget_reservations"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ai_action_proposals_publicId_key" ON "ai_action_proposals"("publicId");

-- CreateIndex
CREATE INDEX "ai_action_proposals_organizationId_status_idx" ON "ai_action_proposals"("organizationId", "status");

-- CreateIndex
CREATE INDEX "ai_action_proposals_organizationId_proposedByMembershipId_c_idx" ON "ai_action_proposals"("organizationId", "proposedByMembershipId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_action_approvals_proposalId_idx" ON "ai_action_approvals"("proposalId");

-- CreateIndex
CREATE INDEX "ai_action_executions_proposalId_idx" ON "ai_action_executions"("proposalId");

-- CreateIndex
CREATE INDEX "ai_evaluation_scenarios_organizationId_useCaseKey_idx" ON "ai_evaluation_scenarios"("organizationId", "useCaseKey");

-- CreateIndex
CREATE INDEX "ai_evaluation_runs_organizationId_status_idx" ON "ai_evaluation_runs"("organizationId", "status");

-- CreateIndex
CREATE INDEX "ai_evaluation_results_runId_idx" ON "ai_evaluation_results"("runId");

-- CreateIndex
CREATE INDEX "ai_feedback_organizationId_createdAt_idx" ON "ai_feedback"("organizationId", "createdAt");

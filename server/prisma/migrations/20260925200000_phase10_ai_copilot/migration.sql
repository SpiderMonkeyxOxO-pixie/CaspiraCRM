-- CreateTable
CREATE TABLE "ai_copilot_conversations" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "membershipId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'ask',
    "status" TEXT NOT NULL DEFAULT 'Active',
    "departmentId" TEXT,
    "teamId" TEXT,
    "primaryContext" JSONB,
    "summary" JSONB,
    "summaryThroughSeq" INTEGER NOT NULL DEFAULT 0,
    "storageMode" TEXT NOT NULL DEFAULT 'CRM',
    "providerConversationId" TEXT,
    "lastMessageAt" TIMESTAMP(3),
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "retentionUntil" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_copilot_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_copilot_messages" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Completed',
    "content" TEXT NOT NULL DEFAULT '',
    "intent" TEXT,
    "confidence" TEXT,
    "limitations" JSONB NOT NULL DEFAULT '[]',
    "freshness" JSONB,
    "requestIds" JSONB NOT NULL DEFAULT '[]',
    "providerKey" TEXT,
    "modelId" TEXT,
    "promptVersion" TEXT,
    "usage" JSONB,
    "errorCategory" TEXT,
    "safeError" TEXT,
    "parentMessageId" TEXT,
    "workflowRunId" TEXT,
    "idempotencyKey" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_copilot_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_copilot_message_parts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_copilot_message_parts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_copilot_citations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "citationKey" TEXT NOT NULL,
    "recordType" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "field" TEXT,
    "value" JSONB,
    "masked" BOOLEAN NOT NULL DEFAULT false,
    "recordTimestamp" TIMESTAMP(3),
    "sourceVersion" TEXT,
    "route" TEXT,
    "retrievalMethod" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Valid',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_copilot_citations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_copilot_context_links" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "recordType" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "addedByMembershipId" TEXT,
    "removedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_copilot_context_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_copilot_tool_calls" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "conversationId" TEXT,
    "messageId" TEXT,
    "workflowRunId" TEXT,
    "seq" INTEGER NOT NULL,
    "toolName" TEXT NOT NULL,
    "toolVersion" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "decisionReason" TEXT,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
    "approvedByMembershipId" TEXT,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_copilot_tool_calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_copilot_tool_results" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "toolCallId" TEXT NOT NULL,
    "result" JSONB,
    "recordRefs" JSONB NOT NULL DEFAULT '[]',
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "freshness" JSONB,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_copilot_tool_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_copilot_memories" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "sensitivity" TEXT NOT NULL DEFAULT 'Internal',
    "source" TEXT NOT NULL,
    "sourceMessageId" TEXT,
    "status" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_copilot_memories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_copilot_memory_events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "memoryId" TEXT NOT NULL,
    "membershipId" TEXT,
    "event" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_copilot_memory_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_retrieval_queries" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "membershipId" TEXT,
    "conversationId" TEXT,
    "messageId" TEXT,
    "workflowRunId" TEXT,
    "queryText" TEXT NOT NULL,
    "filters" JSONB NOT NULL DEFAULT '{}',
    "method" TEXT NOT NULL,
    "resultCount" INTEGER NOT NULL DEFAULT 0,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_retrieval_queries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_retrieval_results" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "queryId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "recordType" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "chunkId" TEXT,
    "score" DOUBLE PRECISION NOT NULL,
    "method" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_retrieval_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_source_chunks" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sourceModule" TEXT NOT NULL,
    "recordType" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "sourceVersion" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "sectionLabel" TEXT,
    "text" TEXT NOT NULL,
    "textHash" TEXT NOT NULL,
    "sensitivity" TEXT NOT NULL DEFAULT 'Internal',
    "permissionMeta" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_source_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_source_embeddings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "chunkId" TEXT NOT NULL,
    "embeddingModel" TEXT NOT NULL,
    "embeddingVersion" TEXT NOT NULL,
    "dimensions" INTEGER NOT NULL,
    "vector" DOUBLE PRECISION[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_source_embeddings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_indexing_jobs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "recordType" TEXT,
    "recordId" TEXT,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "embeddingModel" TEXT,
    "embeddingVersion" TEXT,
    "chunks" INTEGER NOT NULL DEFAULT 0,
    "usageTokens" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ai_indexing_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_workflow_templates" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_workflow_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_workflow_versions" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "steps" JSONB NOT NULL,
    "limits" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Published',
    "checksum" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_workflow_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_workflow_runs" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "conversationId" TEXT,
    "messageId" TEXT,
    "templateKey" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Ready',
    "input" JSONB NOT NULL DEFAULT '{}',
    "scope" JSONB NOT NULL DEFAULT '{}',
    "limits" JSONB NOT NULL DEFAULT '{}',
    "counters" JSONB NOT NULL DEFAULT '{}',
    "result" JSONB,
    "errorCategory" TEXT,
    "safeError" TEXT,
    "idempotencyKey" TEXT,
    "expiresAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_workflow_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_workflow_steps" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "stepType" TEXT NOT NULL,
    "input" JSONB NOT NULL DEFAULT '{}',
    "scope" JSONB NOT NULL DEFAULT '{}',
    "toolName" TEXT,
    "outputRef" JSONB,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "errorCategory" TEXT,
    "usage" JSONB,
    "approvalState" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ai_workflow_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_clarification_requests" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "conversationId" TEXT,
    "messageId" TEXT,
    "workflowRunId" TEXT,
    "question" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "options" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'Open',
    "answer" JSONB,
    "answeredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_clarification_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_copilot_conversations_publicId_key" ON "ai_copilot_conversations"("publicId");

-- CreateIndex
CREATE INDEX "ai_copilot_conversations_organizationId_membershipId_lastMe_idx" ON "ai_copilot_conversations"("organizationId", "membershipId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "ai_copilot_conversations_organizationId_status_idx" ON "ai_copilot_conversations"("organizationId", "status");

-- CreateIndex
CREATE INDEX "ai_copilot_conversations_retentionUntil_idx" ON "ai_copilot_conversations"("retentionUntil");

-- CreateIndex
CREATE INDEX "ai_copilot_messages_conversationId_createdAt_idx" ON "ai_copilot_messages"("conversationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ai_copilot_messages_conversationId_seq_key" ON "ai_copilot_messages"("conversationId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "ai_copilot_messages_organizationId_idempotencyKey_key" ON "ai_copilot_messages"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "ai_copilot_message_parts_messageId_seq_key" ON "ai_copilot_message_parts"("messageId", "seq");

-- CreateIndex
CREATE INDEX "ai_copilot_citations_messageId_idx" ON "ai_copilot_citations"("messageId");

-- CreateIndex
CREATE INDEX "ai_copilot_citations_organizationId_recordType_recordId_idx" ON "ai_copilot_citations"("organizationId", "recordType", "recordId");

-- CreateIndex
CREATE INDEX "ai_copilot_context_links_conversationId_idx" ON "ai_copilot_context_links"("conversationId");

-- CreateIndex
CREATE INDEX "ai_copilot_tool_calls_messageId_idx" ON "ai_copilot_tool_calls"("messageId");

-- CreateIndex
CREATE INDEX "ai_copilot_tool_calls_workflowRunId_idx" ON "ai_copilot_tool_calls"("workflowRunId");

-- CreateIndex
CREATE INDEX "ai_copilot_tool_calls_organizationId_status_idx" ON "ai_copilot_tool_calls"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ai_copilot_tool_results_toolCallId_key" ON "ai_copilot_tool_results"("toolCallId");

-- CreateIndex
CREATE INDEX "ai_copilot_memories_organizationId_membershipId_status_idx" ON "ai_copilot_memories"("organizationId", "membershipId", "status");

-- CreateIndex
CREATE INDEX "ai_copilot_memory_events_memoryId_idx" ON "ai_copilot_memory_events"("memoryId");

-- CreateIndex
CREATE INDEX "ai_retrieval_queries_organizationId_createdAt_idx" ON "ai_retrieval_queries"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_retrieval_results_queryId_idx" ON "ai_retrieval_results"("queryId");

-- CreateIndex
CREATE INDEX "ai_source_chunks_organizationId_recordType_recordId_idx" ON "ai_source_chunks"("organizationId", "recordType", "recordId");

-- CreateIndex
CREATE INDEX "ai_source_chunks_organizationId_status_idx" ON "ai_source_chunks"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ai_source_chunks_organizationId_recordType_recordId_chunkIn_key" ON "ai_source_chunks"("organizationId", "recordType", "recordId", "chunkIndex");

-- CreateIndex
CREATE INDEX "ai_source_embeddings_organizationId_embeddingModel_embeddin_idx" ON "ai_source_embeddings"("organizationId", "embeddingModel", "embeddingVersion");

-- CreateIndex
CREATE UNIQUE INDEX "ai_source_embeddings_chunkId_embeddingModel_embeddingVersio_key" ON "ai_source_embeddings"("chunkId", "embeddingModel", "embeddingVersion");

-- CreateIndex
CREATE INDEX "ai_indexing_jobs_organizationId_status_idx" ON "ai_indexing_jobs"("organizationId", "status");

-- CreateIndex
CREATE INDEX "ai_indexing_jobs_status_createdAt_idx" ON "ai_indexing_jobs"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ai_workflow_templates_key_key" ON "ai_workflow_templates"("key");

-- CreateIndex
CREATE UNIQUE INDEX "ai_workflow_versions_templateId_version_key" ON "ai_workflow_versions"("templateId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ai_workflow_runs_publicId_key" ON "ai_workflow_runs"("publicId");

-- CreateIndex
CREATE INDEX "ai_workflow_runs_organizationId_membershipId_createdAt_idx" ON "ai_workflow_runs"("organizationId", "membershipId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_workflow_runs_organizationId_status_idx" ON "ai_workflow_runs"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ai_workflow_runs_organizationId_idempotencyKey_key" ON "ai_workflow_runs"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "ai_workflow_steps_runId_seq_key" ON "ai_workflow_steps"("runId", "seq");

-- CreateIndex
CREATE INDEX "ai_clarification_requests_conversationId_status_idx" ON "ai_clarification_requests"("conversationId", "status");


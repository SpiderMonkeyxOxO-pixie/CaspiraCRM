-- DropIndex
DROP INDEX "catalog_items_sku_key";

-- DropIndex
DROP INDEX "contracts_contractNumber_key";

-- DropIndex
DROP INDEX "orders_orderNumber_key";

-- DropIndex
DROP INDEX "price_books_code_key";

-- DropIndex
DROP INDEX "quotes_quoteNumber_key";

-- AlterTable
ALTER TABLE "catalog_items" ADD COLUMN     "createdByMembershipId" TEXT,
ADD COLUMN     "organizationId" TEXT,
ADD COLUMN     "ownerMembershipId" TEXT,
ADD COLUMN     "updatedByMembershipId" TEXT,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1,
ALTER COLUMN "standardPrice" SET DATA TYPE DECIMAL(14,2),
ALTER COLUMN "costPreview" SET DATA TYPE DECIMAL(14,2),
ALTER COLUMN "promotionalPrice" SET DATA TYPE DECIMAL(14,2);

-- AlterTable
ALTER TABLE "contract_line_items" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "lineSubtotal" DECIMAL(14,2),
ADD COLUMN     "lineTotal" DECIMAL(14,2),
ADD COLUMN     "taxAmount" DECIMAL(14,2),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1,
ALTER COLUMN "listPriceSnapshot" SET DATA TYPE DECIMAL(14,2),
ALTER COLUMN "priceBookPriceSnapshot" SET DATA TYPE DECIMAL(14,2),
ALTER COLUMN "unitPrice" SET DATA TYPE DECIMAL(14,2),
ALTER COLUMN "discountValue" SET DATA TYPE DECIMAL(14,2);

-- AlterTable
ALTER TABLE "contracts" ADD COLUMN     "activatedByMembershipId" TEXT,
ADD COLUMN     "activationDate" TIMESTAMP(3),
ADD COLUMN     "archivedByMembershipId" TEXT,
ADD COLUMN     "contractValue" DECIMAL(14,2),
ADD COLUMN     "conversionIdempotencyKey" TEXT,
ADD COLUMN     "createdByMembershipId" TEXT,
ADD COLUMN     "organizationId" TEXT,
ADD COLUMN     "ownerMembershipId" TEXT,
ADD COLUMN     "renewalOwnerMembershipId" TEXT,
ADD COLUMN     "updatedByMembershipId" TEXT,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "crm_notes" ADD COLUMN     "dealId" TEXT;

-- AlterTable
ALTER TABLE "crm_record_tags" ADD COLUMN     "dealId" TEXT;

-- AlterTable
ALTER TABLE "deal_line_items" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "descriptionSnapshot" TEXT,
ADD COLUMN     "displayOrder" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lineSubtotal" DECIMAL(14,2),
ADD COLUMN     "lineTotal" DECIMAL(14,2),
ADD COLUMN     "nameSnapshot" TEXT,
ADD COLUMN     "priceBookEntryId" TEXT,
ADD COLUMN     "skuSnapshot" TEXT,
ADD COLUMN     "taxAmount" DECIMAL(14,2),
ADD COLUMN     "unitSnapshot" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1,
ALTER COLUMN "unitPrice" SET DATA TYPE DECIMAL(14,2),
ALTER COLUMN "discountValue" SET DATA TYPE DECIMAL(14,2);

-- AlterTable
ALTER TABLE "deals" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "archivedByMembershipId" TEXT,
ADD COLUMN     "createdByMembershipId" TEXT,
ADD COLUMN     "dealNumber" TEXT,
ADD COLUMN     "forecastCategory" TEXT,
ADD COLUMN     "handoffOwnerMembershipId" TEXT,
ADD COLUMN     "internalNote" TEXT,
ADD COLUMN     "lossCompetitor" TEXT,
ADD COLUMN     "onHoldReviewDate" TIMESTAMP(3),
ADD COLUMN     "organizationId" TEXT,
ADD COLUMN     "ownerMembershipId" TEXT,
ADD COLUMN     "pipelineId" TEXT,
ADD COLUMN     "pipelineStageId" TEXT,
ADD COLUMN     "tags" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "updatedByMembershipId" TEXT,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "order_line_items" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "lineSubtotal" DECIMAL(14,2),
ADD COLUMN     "lineTotal" DECIMAL(14,2),
ADD COLUMN     "taxAmount" DECIMAL(14,2),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1,
ALTER COLUMN "listPriceSnapshot" SET DATA TYPE DECIMAL(14,2),
ALTER COLUMN "priceBookPriceSnapshot" SET DATA TYPE DECIMAL(14,2),
ALTER COLUMN "unitPrice" SET DATA TYPE DECIMAL(14,2),
ALTER COLUMN "discountValue" SET DATA TYPE DECIMAL(14,2);

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "archivedByMembershipId" TEXT,
ADD COLUMN     "confirmedByMembershipId" TEXT,
ADD COLUMN     "conversionIdempotencyKey" TEXT,
ADD COLUMN     "createdByMembershipId" TEXT,
ADD COLUMN     "discountTotal" DECIMAL(14,2),
ADD COLUMN     "grandTotal" DECIMAL(14,2),
ADD COLUMN     "organizationId" TEXT,
ADD COLUMN     "ownerMembershipId" TEXT,
ADD COLUMN     "subtotal" DECIMAL(14,2),
ADD COLUMN     "taxTotal" DECIMAL(14,2),
ADD COLUMN     "updatedByMembershipId" TEXT,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "price_book_entries" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "adjustmentValue" SET DATA TYPE DECIMAL(14,2);

-- AlterTable
ALTER TABLE "price_books" ADD COLUMN     "createdByMembershipId" TEXT,
ADD COLUMN     "organizationId" TEXT,
ADD COLUMN     "ownerMembershipId" TEXT,
ADD COLUMN     "updatedByMembershipId" TEXT,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "quote_line_items" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "isOverridden" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lineSubtotal" DECIMAL(14,2),
ADD COLUMN     "lineTotal" DECIMAL(14,2),
ADD COLUMN     "overrideReason" TEXT,
ADD COLUMN     "skuSnapshot" TEXT,
ADD COLUMN     "taxAmount" DECIMAL(14,2),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1,
ALTER COLUMN "listPrice" SET DATA TYPE DECIMAL(14,2),
ALTER COLUMN "priceBookPrice" SET DATA TYPE DECIMAL(14,2),
ALTER COLUMN "unitPrice" SET DATA TYPE DECIMAL(14,2),
ALTER COLUMN "discountValue" SET DATA TYPE DECIMAL(14,2);

-- AlterTable
ALTER TABLE "quotes" ADD COLUMN     "acceptedAt" TIMESTAMP(3),
ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedByMembershipId" TEXT,
ADD COLUMN     "archivedByMembershipId" TEXT,
ADD COLUMN     "createdByMembershipId" TEXT,
ADD COLUMN     "discountTotal" DECIMAL(14,2),
ADD COLUMN     "grandTotal" DECIMAL(14,2),
ADD COLUMN     "organizationId" TEXT,
ADD COLUMN     "ownerMembershipId" TEXT,
ADD COLUMN     "rejectedAt" TIMESTAMP(3),
ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "rowVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "subtotal" DECIMAL(14,2),
ADD COLUMN     "supersededByQuoteId" TEXT,
ADD COLUMN     "taxTotal" DECIMAL(14,2),
ADD COLUMN     "updatedByMembershipId" TEXT;

-- CreateTable
CREATE TABLE "sales_pipelines" (
    "id" TEXT NOT NULL,
    "publicId" TEXT,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "currencyPolicy" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "wipLimits" JSONB,
    "createdByMembershipId" TEXT,
    "updatedByMembershipId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "sales_pipelines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_pipeline_stages" (
    "id" TEXT NOT NULL,
    "publicId" TEXT,
    "organizationId" TEXT NOT NULL,
    "pipelineId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "classification" TEXT NOT NULL DEFAULT 'Open',
    "probability" INTEGER NOT NULL DEFAULT 0,
    "requiredFields" JSONB NOT NULL DEFAULT '[]',
    "entryRules" JSONB NOT NULL DEFAULT '[]',
    "exitRules" JSONB NOT NULL DEFAULT '[]',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "sales_pipeline_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal_stage_history" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "organizationId" TEXT,
    "fromStageId" TEXT,
    "fromStageName" TEXT,
    "fromProbability" INTEGER,
    "toStageId" TEXT,
    "toStageName" TEXT,
    "toProbability" INTEGER,
    "changedByMembershipId" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,
    "timeInPreviousStageSeconds" INTEGER,
    "correlationId" TEXT,

    CONSTRAINT "deal_stage_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_approvals" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "quoteId" TEXT,
    "requestedByMembershipId" TEXT NOT NULL,
    "requiredPermissionOrRole" TEXT,
    "reason" TEXT,
    "snapshot" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "decidedByMembershipId" TEXT,
    "decisionReason" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "sales_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_obligations" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "organizationId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "ownerMembershipId" TEXT,
    "dueDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'Open',
    "completedDate" TIMESTAMP(3),
    "completedByMembershipId" TEXT,
    "waiveReason" TEXT,
    "evidenceNote" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contract_obligations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_renewal_reviews" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "renewalOwnerMembershipId" TEXT,
    "renewalNoticeDeadline" TIMESTAMP(3),
    "proposedStartDate" TIMESTAMP(3),
    "proposedEndDate" TIMESTAMP(3),
    "proposedValue" DECIMAL(14,2),
    "decision" TEXT,
    "decisionReason" TEXT,
    "decidedByMembershipId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "relatedNewContractId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contract_renewal_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_document_counters" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "sales_document_counters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sales_pipelines_publicId_key" ON "sales_pipelines"("publicId");

-- CreateIndex
CREATE INDEX "sales_pipelines_organizationId_idx" ON "sales_pipelines"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "sales_pipeline_stages_publicId_key" ON "sales_pipeline_stages"("publicId");

-- CreateIndex
CREATE INDEX "sales_pipeline_stages_organizationId_idx" ON "sales_pipeline_stages"("organizationId");

-- CreateIndex
CREATE INDEX "sales_pipeline_stages_pipelineId_idx" ON "sales_pipeline_stages"("pipelineId");

-- CreateIndex
CREATE INDEX "deal_stage_history_dealId_idx" ON "deal_stage_history"("dealId");

-- CreateIndex
CREATE INDEX "deal_stage_history_organizationId_idx" ON "deal_stage_history"("organizationId");

-- CreateIndex
CREATE INDEX "sales_approvals_organizationId_idx" ON "sales_approvals"("organizationId");

-- CreateIndex
CREATE INDEX "sales_approvals_resourceType_resourceId_idx" ON "sales_approvals"("resourceType", "resourceId");

-- CreateIndex
CREATE INDEX "sales_approvals_quoteId_idx" ON "sales_approvals"("quoteId");

-- CreateIndex
CREATE INDEX "contract_obligations_contractId_idx" ON "contract_obligations"("contractId");

-- CreateIndex
CREATE INDEX "contract_obligations_organizationId_idx" ON "contract_obligations"("organizationId");

-- CreateIndex
CREATE INDEX "contract_renewal_reviews_contractId_idx" ON "contract_renewal_reviews"("contractId");

-- CreateIndex
CREATE UNIQUE INDEX "sales_document_counters_organizationId_docType_key" ON "sales_document_counters"("organizationId", "docType");

-- CreateIndex
CREATE INDEX "activities_dealId_idx" ON "activities"("dealId");

-- CreateIndex
CREATE INDEX "catalog_items_organizationId_idx" ON "catalog_items"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_items_organizationId_sku_key" ON "catalog_items"("organizationId", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "contracts_conversionIdempotencyKey_key" ON "contracts"("conversionIdempotencyKey");

-- CreateIndex
CREATE INDEX "contracts_organizationId_idx" ON "contracts"("organizationId");

-- CreateIndex
CREATE INDEX "contracts_sourceOrderId_idx" ON "contracts"("sourceOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "contracts_organizationId_contractNumber_key" ON "contracts"("organizationId", "contractNumber");

-- CreateIndex
CREATE INDEX "crm_notes_dealId_idx" ON "crm_notes"("dealId");

-- CreateIndex
CREATE INDEX "crm_record_tags_dealId_idx" ON "crm_record_tags"("dealId");

-- CreateIndex
CREATE UNIQUE INDEX "crm_record_tags_tagId_dealId_key" ON "crm_record_tags"("tagId", "dealId");

-- CreateIndex
CREATE INDEX "deals_organizationId_idx" ON "deals"("organizationId");

-- CreateIndex
CREATE INDEX "deals_pipelineId_idx" ON "deals"("pipelineId");

-- CreateIndex
CREATE INDEX "deals_pipelineStageId_idx" ON "deals"("pipelineStageId");

-- CreateIndex
CREATE INDEX "deals_ownerMembershipId_idx" ON "deals"("ownerMembershipId");

-- CreateIndex
CREATE UNIQUE INDEX "deals_organizationId_dealNumber_key" ON "deals"("organizationId", "dealNumber");

-- CreateIndex
CREATE UNIQUE INDEX "orders_conversionIdempotencyKey_key" ON "orders"("conversionIdempotencyKey");

-- CreateIndex
CREATE INDEX "orders_organizationId_idx" ON "orders"("organizationId");

-- CreateIndex
CREATE INDEX "orders_sourceQuoteId_idx" ON "orders"("sourceQuoteId");

-- CreateIndex
CREATE UNIQUE INDEX "orders_organizationId_orderNumber_key" ON "orders"("organizationId", "orderNumber");

-- CreateIndex
CREATE INDEX "price_book_entries_priceBookId_idx" ON "price_book_entries"("priceBookId");

-- CreateIndex
CREATE INDEX "price_book_entries_catalogItemId_idx" ON "price_book_entries"("catalogItemId");

-- CreateIndex
CREATE INDEX "price_books_organizationId_idx" ON "price_books"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "price_books_organizationId_code_key" ON "price_books"("organizationId", "code");

-- CreateIndex
CREATE INDEX "quotes_organizationId_idx" ON "quotes"("organizationId");

-- CreateIndex
CREATE INDEX "quotes_dealId_idx" ON "quotes"("dealId");

-- CreateIndex
CREATE INDEX "quotes_rootId_idx" ON "quotes"("rootId");

-- CreateIndex
CREATE UNIQUE INDEX "quotes_organizationId_quoteNumber_version_key" ON "quotes"("organizationId", "quoteNumber", "version");

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "sales_pipelines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_pipelineStageId_fkey" FOREIGN KEY ("pipelineStageId") REFERENCES "sales_pipeline_stages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_ownerMembershipId_fkey" FOREIGN KEY ("ownerMembershipId") REFERENCES "organization_memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_notes" ADD CONSTRAINT "crm_notes_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_record_tags" ADD CONSTRAINT "crm_record_tags_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_ownerMembershipId_fkey" FOREIGN KEY ("ownerMembershipId") REFERENCES "organization_memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_books" ADD CONSTRAINT "price_books_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_books" ADD CONSTRAINT "price_books_ownerMembershipId_fkey" FOREIGN KEY ("ownerMembershipId") REFERENCES "organization_memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_ownerMembershipId_fkey" FOREIGN KEY ("ownerMembershipId") REFERENCES "organization_memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_ownerMembershipId_fkey" FOREIGN KEY ("ownerMembershipId") REFERENCES "organization_memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_ownerMembershipId_fkey" FOREIGN KEY ("ownerMembershipId") REFERENCES "organization_memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_renewalOwnerMembershipId_fkey" FOREIGN KEY ("renewalOwnerMembershipId") REFERENCES "organization_memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_pipelines" ADD CONSTRAINT "sales_pipelines_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_pipeline_stages" ADD CONSTRAINT "sales_pipeline_stages_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "sales_pipelines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_stage_history" ADD CONSTRAINT "deal_stage_history_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_approvals" ADD CONSTRAINT "sales_approvals_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_approvals" ADD CONSTRAINT "sales_approvals_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_obligations" ADD CONSTRAINT "contract_obligations_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_renewal_reviews" ADD CONSTRAINT "contract_renewal_reviews_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_document_counters" ADD CONSTRAINT "sales_document_counters_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fullName" TEXT,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'User',
    "department" TEXT,
    "jobTitle" TEXT,
    "team" TEXT,
    "shift" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "workingHour" TEXT,
    "avatarUrl" TEXT,
    "fcmToken" TEXT,
    "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
    "twoFactorSecret" TEXT,
    "resetToken" TEXT,
    "resetTokenExpires" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "key" TEXT,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'Custom',
    "isBuiltIn" BOOLEAN NOT NULL DEFAULT false,
    "department" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "purpose" TEXT,
    "description" TEXT,
    "recommendedScope" TEXT,
    "defaultScope" TEXT NOT NULL,
    "allowedScopes" JSONB NOT NULL DEFAULT '[]',
    "isOrdinaryRecordOwner" BOOLEAN NOT NULL DEFAULT false,
    "customerAccountRestricted" BOOLEAN NOT NULL DEFAULT false,
    "permissionGrants" JSONB NOT NULL DEFAULT '[]',
    "sensitiveFields" JSONB NOT NULL DEFAULT '{}',
    "approvalRules" JSONB NOT NULL DEFAULT '{}',
    "notes" JSONB NOT NULL DEFAULT '[]',
    "duplicatedFromId" TEXT,
    "archiveReason" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "companies" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "industry" TEXT,
    "website" TEXT,
    "phone" TEXT,
    "addressLine1" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postalCode" TEXT,
    "country" TEXT,
    "size" TEXT,
    "annualRevenue" DOUBLE PRECISION,
    "lifecycleStage" TEXT DEFAULT 'Lead',
    "tags" JSONB NOT NULL DEFAULT '[]',
    "ownerId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "archiveReason" TEXT,
    "archivedAt" TIMESTAMP(3),
    "statusBeforeArchive" TEXT,
    "customFields" JSONB NOT NULL DEFAULT '{}',
    "notes" JSONB NOT NULL DEFAULT '[]',
    "activityLog" JSONB NOT NULL DEFAULT '[]',
    "files" JSONB NOT NULL DEFAULT '[]',
    "auditLog" JSONB NOT NULL DEFAULT '[]',
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "priceBookIds" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "jobTitle" TEXT,
    "companyId" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "emailConsent" BOOLEAN NOT NULL DEFAULT false,
    "smsConsent" BOOLEAN NOT NULL DEFAULT false,
    "doNotContact" BOOLEAN NOT NULL DEFAULT false,
    "tags" JSONB NOT NULL DEFAULT '[]',
    "ownerId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "archiveReason" TEXT,
    "archivedAt" TIMESTAMP(3),
    "notes" JSONB NOT NULL DEFAULT '[]',
    "activityLog" JSONB NOT NULL DEFAULT '[]',
    "files" JSONB NOT NULL DEFAULT '[]',
    "auditLog" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "name" TEXT,
    "companyName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "source" TEXT,
    "status" TEXT NOT NULL DEFAULT 'New',
    "score" INTEGER DEFAULT 0,
    "priority" TEXT DEFAULT 'Medium',
    "campaignId" TEXT,
    "ownerId" TEXT,
    "convertedContactId" TEXT,
    "convertedCompanyId" TEXT,
    "convertedDealId" TEXT,
    "tasks" JSONB NOT NULL DEFAULT '[]',
    "notes" JSONB NOT NULL DEFAULT '[]',
    "activityLog" JSONB NOT NULL DEFAULT '[]',
    "files" JSONB NOT NULL DEFAULT '[]',
    "auditLog" JSONB NOT NULL DEFAULT '[]',
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "archiveReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deals" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pipeline" TEXT,
    "stage" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Open',
    "dealType" TEXT,
    "source" TEXT,
    "companyId" TEXT,
    "primaryContactId" TEXT,
    "additionalContactIds" JSONB NOT NULL DEFAULT '[]',
    "contactRoles" JSONB NOT NULL DEFAULT '[]',
    "ownerId" TEXT,
    "assignedTeam" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "value" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "probability" INTEGER DEFAULT 0,
    "expectedClosingDate" TIMESTAMP(3),
    "actualClosingDate" TIMESTAMP(3),
    "billingFrequency" TEXT DEFAULT 'One-time',
    "priority" TEXT DEFAULT 'Medium',
    "dealHealth" TEXT DEFAULT 'Healthy',
    "healthReason" TEXT,
    "nextAction" TEXT,
    "competitors" JSONB NOT NULL DEFAULT '[]',
    "winReason" TEXT,
    "lossReason" TEXT,
    "cancelReason" TEXT,
    "holdReason" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "archiveReason" TEXT,
    "notes" JSONB NOT NULL DEFAULT '[]',
    "activityLog" JSONB NOT NULL DEFAULT '[]',
    "files" JSONB NOT NULL DEFAULT '[]',
    "auditLog" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal_line_items" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "catalogItemId" TEXT,
    "priceBookId" TEXT,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "unitPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "discountType" TEXT,
    "discountValue" DOUBLE PRECISION,
    "taxCategory" TEXT DEFAULT 'Standard',
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "deal_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activities" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'Task',
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Open',
    "priority" TEXT DEFAULT 'Medium',
    "ownerId" TEXT,
    "companyId" TEXT,
    "contactId" TEXT,
    "dealId" TEXT,
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_items" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "type" TEXT NOT NULL DEFAULT 'Product',
    "category" TEXT,
    "shortDescription" TEXT,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "billingModel" TEXT NOT NULL DEFAULT 'One Time',
    "billingInterval" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'Each',
    "standardPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "alternativePrices" JSONB NOT NULL DEFAULT '[]',
    "costPreview" DOUBLE PRECISION,
    "taxCategory" TEXT NOT NULL DEFAULT 'Standard',
    "discountEligible" BOOLEAN NOT NULL DEFAULT true,
    "minQuantity" INTEGER,
    "maxQuantity" INTEGER,
    "effectiveDate" TIMESTAMP(3),
    "expirationDate" TIMESTAMP(3),
    "ownerId" TEXT,
    "tags" JSONB NOT NULL DEFAULT '[]',
    "includedItems" JSONB NOT NULL DEFAULT '[]',
    "optionalAddOnIds" JSONB NOT NULL DEFAULT '[]',
    "compatibleParentIds" JSONB NOT NULL DEFAULT '[]',
    "termsSummary" TEXT,
    "internalNotes" TEXT,
    "customerFacingDescription" TEXT,
    "usageConfig" JSONB,
    "recurringConfig" JSONB,
    "tieredPricing" JSONB NOT NULL DEFAULT '[]',
    "promotionalPrice" DOUBLE PRECISION,
    "promotionalUntil" TIMESTAMP(3),
    "upcomingPriceChange" JSONB,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "archiveReason" TEXT,
    "archivedAt" TIMESTAMP(3),
    "statusBeforeArchive" TEXT,
    "files" JSONB NOT NULL DEFAULT '[]',
    "activityLog" JSONB NOT NULL DEFAULT '[]',
    "auditLog" JSONB NOT NULL DEFAULT '[]',
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "catalog_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_books" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "priority" INTEGER NOT NULL DEFAULT 50,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "market" TEXT,
    "customerSegment" TEXT,
    "companyIds" JSONB NOT NULL DEFAULT '[]',
    "salesChannel" TEXT,
    "categories" JSONB NOT NULL DEFAULT '[]',
    "dealTypes" JSONB NOT NULL DEFAULT '[]',
    "contractTypes" JSONB NOT NULL DEFAULT '[]',
    "effectiveDate" TIMESTAMP(3),
    "expirationDate" TIMESTAMP(3),
    "ownerId" TEXT,
    "tags" JSONB NOT NULL DEFAULT '[]',
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "archiveReason" TEXT,
    "archivedAt" TIMESTAMP(3),
    "statusBeforeArchive" TEXT,
    "activityLog" JSONB NOT NULL DEFAULT '[]',
    "auditLog" JSONB NOT NULL DEFAULT '[]',
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "price_books_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_book_entries" (
    "id" TEXT NOT NULL,
    "priceBookId" TEXT NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "adjustmentType" TEXT NOT NULL DEFAULT 'Fixed Price',
    "adjustmentValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tiers" JSONB NOT NULL DEFAULT '[]',
    "minQuantity" INTEGER,
    "maxQuantity" INTEGER,
    "billingInterval" TEXT,
    "effectiveDate" TIMESTAMP(3),
    "expirationDate" TIMESTAMP(3),
    "notes" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "price_book_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotes" (
    "id" TEXT NOT NULL,
    "quoteNumber" TEXT NOT NULL,
    "title" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "rootId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "approvalStatus" TEXT,
    "companyId" TEXT,
    "primaryContactId" TEXT,
    "dealId" TEXT,
    "priceBookId" TEXT,
    "ownerId" TEXT,
    "assignedTeam" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "validUntilDate" TIMESTAMP(3),
    "paymentTerms" TEXT,
    "billingSchedule" TEXT,
    "customerNote" TEXT,
    "internalNote" TEXT,
    "customerResponse" JSONB,
    "changeSummary" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "archiveReason" TEXT,
    "archivedAt" TIMESTAMP(3),
    "statusBeforeArchive" TEXT,
    "activityLog" JSONB NOT NULL DEFAULT '[]',
    "auditLog" JSONB NOT NULL DEFAULT '[]',
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_line_items" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "catalogItemId" TEXT,
    "priceBookIdUsed" TEXT,
    "isCustomLine" BOOLEAN NOT NULL DEFAULT false,
    "included" BOOLEAN NOT NULL DEFAULT true,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'Each',
    "billingModel" TEXT NOT NULL DEFAULT 'One Time',
    "billingInterval" TEXT,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "listPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "priceBookPrice" DOUBLE PRECISION,
    "unitPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "discountType" TEXT,
    "discountValue" DOUBLE PRECISION,
    "taxCategory" TEXT NOT NULL DEFAULT 'Standard',
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "quote_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "orderType" TEXT NOT NULL DEFAULT 'Product Order',
    "companyId" TEXT,
    "contactId" TEXT,
    "dealId" TEXT,
    "sourceQuoteId" TEXT,
    "sourceQuoteVersion" INTEGER,
    "ownerId" TEXT,
    "assignedTeam" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "orderDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestedDate" TIMESTAMP(3),
    "confirmedDate" TIMESTAMP(3),
    "paymentTerms" TEXT,
    "billingSchedule" TEXT,
    "billingContactId" TEXT,
    "billingAddress" JSONB,
    "serviceAddress" JSONB,
    "deliveryInstructions" TEXT,
    "serviceStartInstructions" TEXT,
    "customerReference" TEXT,
    "internalNote" TEXT,
    "customerNote" TEXT,
    "cancellationReason" TEXT,
    "cancellationEffectiveDate" TIMESTAMP(3),
    "holdReason" TEXT,
    "holdReviewDate" TIMESTAMP(3),
    "invoiceRequestedAt" TIMESTAMP(3),
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "archiveReason" TEXT,
    "archivedAt" TIMESTAMP(3),
    "statusBeforeArchive" TEXT,
    "files" JSONB NOT NULL DEFAULT '[]',
    "activityLog" JSONB NOT NULL DEFAULT '[]',
    "auditLog" JSONB NOT NULL DEFAULT '[]',
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_line_items" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "catalogItemId" TEXT,
    "isCustomLine" BOOLEAN NOT NULL DEFAULT false,
    "lineKind" TEXT NOT NULL DEFAULT 'Product',
    "name" TEXT NOT NULL,
    "description" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'Each',
    "billingModel" TEXT NOT NULL DEFAULT 'One Time',
    "billingInterval" TEXT,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "listPriceSnapshot" DOUBLE PRECISION,
    "priceBookIdUsed" TEXT,
    "priceBookPriceSnapshot" DOUBLE PRECISION,
    "unitPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "discountType" TEXT,
    "discountValue" DOUBLE PRECISION,
    "taxCategory" TEXT NOT NULL DEFAULT 'Standard',
    "order" INTEGER NOT NULL DEFAULT 0,
    "quantityFulfilled" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "deliveryStatus" TEXT NOT NULL DEFAULT 'Not Started',
    "requestedDeliveryDate" TIMESTAMP(3),
    "completedDate" TIMESTAMP(3),
    "deliveryReferencePreview" TEXT,
    "serviceStartDate" TIMESTAMP(3),
    "responsibleOwnerId" TEXT,
    "responsibleOwnerName" TEXT,
    "setupStatus" TEXT NOT NULL DEFAULT 'Not Started',
    "activationStatus" TEXT NOT NULL DEFAULT 'Not Started',
    "completionPercentage" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "nextMilestone" TEXT,
    "fulfillmentNotes" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "order_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contracts" (
    "id" TEXT NOT NULL,
    "contractNumber" TEXT NOT NULL,
    "contractType" TEXT NOT NULL DEFAULT 'One-Time Agreement',
    "companyId" TEXT,
    "contactId" TEXT,
    "dealId" TEXT,
    "sourceQuoteId" TEXT,
    "sourceQuoteVersion" INTEGER,
    "sourceOrderId" TEXT,
    "parentContractId" TEXT,
    "ownerId" TEXT,
    "assignedTeam" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "effectiveDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "termMonths" INTEGER,
    "renewalType" TEXT NOT NULL DEFAULT 'Manual Renew',
    "renewalNoticeDays" INTEGER NOT NULL DEFAULT 60,
    "paymentTerms" TEXT,
    "billingSchedule" TEXT,
    "billingContactId" TEXT,
    "internalSignatoryName" TEXT,
    "internalSignatoryTitle" TEXT,
    "internalSignedAt" TIMESTAMP(3),
    "customerSignatoryName" TEXT,
    "customerSignatoryTitle" TEXT,
    "customerSignedAt" TIMESTAMP(3),
    "sentForSignatureAt" TIMESTAMP(3),
    "signedAt" TIMESTAMP(3),
    "terminationReason" TEXT,
    "terminationEffectiveDate" TIMESTAMP(3),
    "cancellationReason" TEXT,
    "amendmentHistory" JSONB NOT NULL DEFAULT '[]',
    "internalNote" TEXT,
    "customerNote" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "archiveReason" TEXT,
    "archivedAt" TIMESTAMP(3),
    "statusBeforeArchive" TEXT,
    "files" JSONB NOT NULL DEFAULT '[]',
    "activityLog" JSONB NOT NULL DEFAULT '[]',
    "auditLog" JSONB NOT NULL DEFAULT '[]',
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_line_items" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "catalogItemId" TEXT,
    "isCustomLine" BOOLEAN NOT NULL DEFAULT false,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'Each',
    "billingModel" TEXT NOT NULL DEFAULT 'One Time',
    "billingInterval" TEXT,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "listPriceSnapshot" DOUBLE PRECISION,
    "priceBookIdUsed" TEXT,
    "priceBookPriceSnapshot" DOUBLE PRECISION,
    "unitPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "discountType" TEXT,
    "discountValue" DOUBLE PRECISION,
    "taxCategory" TEXT NOT NULL DEFAULT 'Standard',
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "contract_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tickets" (
    "id" TEXT NOT NULL,
    "ticketNumber" TEXT NOT NULL,
    "companyId" TEXT,
    "contactId" TEXT,
    "subject" TEXT NOT NULL,
    "description" TEXT,
    "source" TEXT NOT NULL DEFAULT 'Portal',
    "category" TEXT NOT NULL DEFAULT 'General',
    "priority" TEXT NOT NULL DEFAULT 'Medium',
    "department" TEXT NOT NULL DEFAULT 'Support',
    "assignedAgentId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'New',
    "slaResponseDeadline" TIMESTAMP(3),
    "slaResolutionDeadline" TIMESTAMP(3),
    "firstRespondedAt" TIMESTAMP(3),
    "publicReplies" JSONB NOT NULL DEFAULT '[]',
    "privateNotes" JSONB NOT NULL DEFAULT '[]',
    "escalations" JSONB NOT NULL DEFAULT '[]',
    "resolutionSummary" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "csatScore" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "companyId" TEXT,
    "dealId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Planning',
    "ownerId" TEXT,
    "startDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "description" TEXT,
    "customerVisible" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "milestones" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3),
    "completed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "milestones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "assigneeId" TEXT,
    "watchers" JSONB NOT NULL DEFAULT '[]',
    "priority" TEXT NOT NULL DEFAULT 'Medium',
    "status" TEXT NOT NULL DEFAULT 'To Do',
    "dueDate" TIMESTAMP(3),
    "estimateHours" DOUBLE PRECISION,
    "loggedHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "timeEntries" JSONB NOT NULL DEFAULT '[]',
    "dependsOnId" TEXT,
    "recurring" BOOLEAN NOT NULL DEFAULT false,
    "comments" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'Email',
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "budget" DOUBLE PRECISION,
    "goal" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "segments" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_forms" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fields" JSONB NOT NULL DEFAULT '[]',
    "submissions" INTEGER NOT NULL DEFAULT 0,
    "campaignId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketing_forms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketing_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "orderId" TEXT,
    "dealId" TEXT,
    "companyId" TEXT,
    "items" JSONB NOT NULL DEFAULT '[]',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "subtotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tax" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "amountPaid" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "amountDue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "approvedBy" TEXT,
    "voidReason" TEXT,
    "issueDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'Bank Transfer',
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_notes" (
    "id" TEXT NOT NULL,
    "creditNoteNumber" TEXT NOT NULL,
    "invoiceId" TEXT,
    "companyName" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" TEXT NOT NULL,
    "expenseNumber" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL DEFAULT 'Other',
    "amount" DOUBLE PRECISION NOT NULL,
    "submittedById" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "reviewedBy" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurring_invoices" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "items" JSONB NOT NULL DEFAULT '[]',
    "interval" TEXT NOT NULL DEFAULT 'Monthly',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastGeneratedAt" TIMESTAMP(3),
    "invoicesGenerated" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recurring_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "roles_key_key" ON "roles"("key");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_items_sku_key" ON "catalog_items"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "price_books_code_key" ON "price_books"("code");

-- CreateIndex
CREATE UNIQUE INDEX "quotes_quoteNumber_key" ON "quotes"("quoteNumber");

-- CreateIndex
CREATE UNIQUE INDEX "orders_orderNumber_key" ON "orders"("orderNumber");

-- CreateIndex
CREATE UNIQUE INDEX "contracts_contractNumber_key" ON "contracts"("contractNumber");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_ticketNumber_key" ON "tickets"("ticketNumber");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_invoiceNumber_key" ON "invoices"("invoiceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "credit_notes_creditNoteNumber_key" ON "credit_notes"("creditNoteNumber");

-- CreateIndex
CREATE UNIQUE INDEX "expenses_expenseNumber_key" ON "expenses"("expenseNumber");

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_primaryContactId_fkey" FOREIGN KEY ("primaryContactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_line_items" ADD CONSTRAINT "deal_line_items_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_line_items" ADD CONSTRAINT "deal_line_items_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "catalog_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_books" ADD CONSTRAINT "price_books_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_book_entries" ADD CONSTRAINT "price_book_entries_priceBookId_fkey" FOREIGN KEY ("priceBookId") REFERENCES "price_books"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_book_entries" ADD CONSTRAINT "price_book_entries_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "catalog_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_primaryContactId_fkey" FOREIGN KEY ("primaryContactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_priceBookId_fkey" FOREIGN KEY ("priceBookId") REFERENCES "price_books"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_line_items" ADD CONSTRAINT "quote_line_items_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_line_items" ADD CONSTRAINT "quote_line_items_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "catalog_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_sourceQuoteId_fkey" FOREIGN KEY ("sourceQuoteId") REFERENCES "quotes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_line_items" ADD CONSTRAINT "order_line_items_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_line_items" ADD CONSTRAINT "order_line_items_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "catalog_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_sourceQuoteId_fkey" FOREIGN KEY ("sourceQuoteId") REFERENCES "quotes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_sourceOrderId_fkey" FOREIGN KEY ("sourceOrderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_parentContractId_fkey" FOREIGN KEY ("parentContractId") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_line_items" ADD CONSTRAINT "contract_line_items_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_line_items" ADD CONSTRAINT "contract_line_items_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "catalog_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_assignedAgentId_fkey" FOREIGN KEY ("assignedAgentId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_dependsOnId_fkey" FOREIGN KEY ("dependsOnId") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_forms" ADD CONSTRAINT "marketing_forms_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_invoices" ADD CONSTRAINT "recurring_invoices_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;


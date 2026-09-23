-- AlterTable
ALTER TABLE "credit_notes" ADD COLUMN     "appliedAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedByMembershipId" TEXT,
ADD COLUMN     "companyId" TEXT,
ADD COLUMN     "createdByMembershipId" TEXT,
ADD COLUMN     "creditDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "exceptionReason" TEXT,
ADD COLUMN     "journalEntryId" TEXT,
ADD COLUMN     "lines" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "postedAt" TIMESTAMP(3),
ADD COLUMN     "postedByMembershipId" TEXT,
ADD COLUMN     "remainingAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'Draft',
ADD COLUMN     "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "taxAdjustment" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "expenses" ADD COLUMN     "amountBeforeTax" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "baseAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "billable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "costCenterId" TEXT,
ADD COLUMN     "customerCompanyId" TEXT,
ADD COLUMN     "exchangeRate" DECIMAL(20,10) NOT NULL DEFAULT 1,
ADD COLUMN     "expenseAccountId" TEXT,
ADD COLUMN     "expenseReportId" TEXT,
ADD COLUMN     "journalEntryId" TEXT,
ADD COLUMN     "merchant" TEXT,
ADD COLUMN     "paymentMethod" TEXT,
ADD COLUMN     "policyException" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "policyExceptionReason" TEXT,
ADD COLUMN     "projectId" TEXT,
ADD COLUMN     "receiptMetadata" JSONB,
ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "submittedAt" TIMESTAMP(3),
ADD COLUMN     "taxAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "taxRateId" TEXT,
ADD COLUMN     "taxSnapshot" JSONB,
ADD COLUMN     "vendorId" TEXT;

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "billingAddress" JSONB,
ADD COLUMN     "contactId" TEXT,
ADD COLUMN     "contractId" TEXT,
ADD COLUMN     "discountTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "disputeReason" TEXT,
ADD COLUMN     "exchangeRate" DECIMAL(20,10) NOT NULL DEFAULT 1,
ADD COLUMN     "journalEntryId" TEXT,
ADD COLUMN     "paymentTermsDays" INTEGER,
ADD COLUMN     "postedAt" TIMESTAMP(3),
ADD COLUMN     "postedByMembershipId" TEXT,
ADD COLUMN     "projectId" TEXT,
ADD COLUMN     "submittedAt" TIMESTAMP(3),
ADD COLUMN     "submittedByMembershipId" TEXT,
ADD COLUMN     "writtenOffAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedByMembershipId" TEXT,
ADD COLUMN     "cancelledReason" TEXT,
ADD COLUMN     "companyId" TEXT,
ADD COLUMN     "createdByMembershipId" TEXT,
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'USD',
ADD COLUMN     "direction" TEXT NOT NULL DEFAULT 'Incoming',
ADD COLUMN     "exchangeRate" DECIMAL(20,10) NOT NULL DEFAULT 1,
ADD COLUMN     "financialAccountId" TEXT,
ADD COLUMN     "journalEntryId" TEXT,
ADD COLUMN     "paymentNumber" TEXT,
ADD COLUMN     "postedAt" TIMESTAMP(3),
ADD COLUMN     "postedByMembershipId" TEXT,
ADD COLUMN     "reversalJournalId" TEXT,
ADD COLUMN     "reversalReason" TEXT,
ADD COLUMN     "reversedAt" TIMESTAMP(3),
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'Draft',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "vendorId" TEXT,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1,
ALTER COLUMN "invoiceId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "finance_settings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "baseCurrency" TEXT NOT NULL DEFAULT 'USD',
    "separationOfDuties" BOOLEAN NOT NULL DEFAULT true,
    "journalApprovalRequired" BOOLEAN NOT NULL DEFAULT true,
    "invoiceApprovalThreshold" DECIMAL(18,2) NOT NULL DEFAULT 10000,
    "expensePolicyLimit" DECIMAL(18,2),
    "receivableAccountId" TEXT,
    "payableAccountId" TEXT,
    "revenueAccountId" TEXT,
    "expenseAccountId" TEXT,
    "taxPayableAccountId" TEXT,
    "taxRecoverableAccountId" TEXT,
    "employeePayableAccountId" TEXT,
    "updatedByMembershipId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "finance_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_overrides" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "rule" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "actorMembershipId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finance_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fiscal_years" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Open',
    "createdByMembershipId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fiscal_years_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fiscal_periods" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "fiscalYearId" TEXT NOT NULL,
    "periodNumber" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Open',
    "softClosedByMembershipId" TEXT,
    "softClosedAt" TIMESTAMP(3),
    "closedByMembershipId" TEXT,
    "closedAt" TIMESTAMP(3),
    "reopenedByMembershipId" TEXT,
    "reopenedAt" TIMESTAMP(3),
    "reopenReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fiscal_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_accounts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL,
    "subtype" TEXT,
    "parentId" TEXT,
    "normalBalance" TEXT NOT NULL,
    "currency" TEXT,
    "postingAllowed" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdByMembershipId" TEXT,
    "updatedByMembershipId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" TIMESTAMP(3),
    "archiveReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ledger_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_centers" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "parentId" TEXT,
    "department" TEXT,
    "projectId" TEXT,
    "ownerMembershipId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cost_centers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_rates" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "rateBasisPoints" INTEGER NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'Both',
    "recoverable" BOOLEAN NOT NULL DEFAULT false,
    "inclusive" BOOLEAN NOT NULL DEFAULT false,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "salesAccountId" TEXT,
    "purchaseAccountId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exchange_rates" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "baseCurrency" TEXT NOT NULL,
    "quoteCurrency" TEXT NOT NULL,
    "rate" DECIMAL(20,10) NOT NULL,
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "enteredByMembershipId" TEXT,
    "approvedByMembershipId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exchange_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "entryNumber" TEXT NOT NULL,
    "entryDate" TIMESTAMP(3) NOT NULL,
    "periodId" TEXT,
    "description" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL DEFAULT 'Manual',
    "sourceId" TEXT,
    "reference" TEXT,
    "currency" TEXT NOT NULL,
    "exchangeRate" DECIMAL(20,10) NOT NULL DEFAULT 1,
    "exchangeRateId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "totalDebit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalCredit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "createdByMembershipId" TEXT,
    "submittedByMembershipId" TEXT,
    "submittedAt" TIMESTAMP(3),
    "approvedByMembershipId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "postedByMembershipId" TEXT,
    "postedAt" TIMESTAMP(3),
    "reversalOfId" TEXT,
    "reversedAt" TIMESTAMP(3),
    "reversalReason" TEXT,
    "cancelledReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_lines" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "journalEntryId" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "accountId" TEXT NOT NULL,
    "costCenterId" TEXT,
    "projectId" TEXT,
    "companyId" TEXT,
    "description" TEXT,
    "debit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL,
    "baseDebit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "baseCredit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "taxRateId" TEXT,
    "taxSnapshot" JSONB,

    CONSTRAINT "journal_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendors" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "vendorCode" TEXT NOT NULL,
    "paymentTermsDays" INTEGER NOT NULL DEFAULT 30,
    "taxRateId" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "defaultPayableAccountId" TEXT,
    "defaultExpenseAccountId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_reports" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "reportNumber" TEXT NOT NULL,
    "submitterMembershipId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "totals" JSONB NOT NULL DEFAULT '{}',
    "submittedAt" TIMESTAMP(3),
    "approvedByMembershipId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedByMembershipId" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "postedByMembershipId" TEXT,
    "postedAt" TIMESTAMP(3),
    "journalEntryId" TEXT,
    "reimbursedByMembershipId" TEXT,
    "reimbursedAt" TIMESTAMP(3),
    "reimbursementReference" TEXT,
    "cancelledReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expense_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_bills" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "billNumber" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "vendorReference" TEXT NOT NULL,
    "billDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3),
    "currency" TEXT NOT NULL,
    "exchangeRate" DECIMAL(20,10) NOT NULL DEFAULT 1,
    "paymentTermsDays" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "subtotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "tax" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "amountPaid" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "amountDue" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "payableAccountId" TEXT,
    "costCenterId" TEXT,
    "projectId" TEXT,
    "description" TEXT,
    "createdByMembershipId" TEXT,
    "submittedByMembershipId" TEXT,
    "submittedAt" TIMESTAMP(3),
    "approvedByMembershipId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "postedByMembershipId" TEXT,
    "postedAt" TIMESTAMP(3),
    "journalEntryId" TEXT,
    "disputeReason" TEXT,
    "voidReason" TEXT,
    "voidedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendor_bills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_bill_lines" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(18,4) NOT NULL,
    "accountId" TEXT NOT NULL,
    "costCenterId" TEXT,
    "projectId" TEXT,
    "taxRateId" TEXT,
    "taxSnapshot" JSONB,
    "lineSubtotal" DECIMAL(18,2) NOT NULL,
    "taxAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "vendor_bill_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_lines" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "productId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unitPrice" DECIMAL(18,4) NOT NULL,
    "discountAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "taxRateId" TEXT,
    "taxSnapshot" JSONB,
    "lineSubtotal" DECIMAL(18,2) NOT NULL,
    "taxAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(18,2) NOT NULL,
    "revenueAccountId" TEXT,
    "costCenterId" TEXT,
    "projectId" TEXT,
    "orderId" TEXT,

    CONSTRAINT "invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_accounts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "maskedReference" TEXT,
    "currency" TEXT NOT NULL,
    "ledgerAccountId" TEXT NOT NULL,
    "openingJournalId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdByMembershipId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "financial_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_allocations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "billId" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "allocationDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByMembershipId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "reversedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "statement_imports" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "financialAccountId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "checksum" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "columnMapping" JSONB NOT NULL DEFAULT '{}',
    "importedByMembershipId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Imported',
    "lineCount" INTEGER NOT NULL DEFAULT 0,
    "duplicateCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "statement_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "statement_lines" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "financialAccountId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "transactionDate" TIMESTAMP(3) NOT NULL,
    "valueDate" TIMESTAMP(3),
    "description" TEXT NOT NULL,
    "reference" TEXT,
    "direction" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "runningBalance" DECIMAL(18,2),
    "fingerprint" TEXT NOT NULL,
    "reconciliationStatus" TEXT NOT NULL DEFAULT 'Unmatched',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "statement_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_sessions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "financialAccountId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "openingBalance" DECIMAL(18,2) NOT NULL,
    "closingBalance" DECIMAL(18,2) NOT NULL,
    "statementBalance" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "ledgerBalance" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "difference" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'Open',
    "preparedByMembershipId" TEXT,
    "submittedAt" TIMESTAMP(3),
    "approvedByMembershipId" TEXT,
    "completedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reconciliation_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_matches" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "statementLineId" TEXT NOT NULL,
    "journalLineId" TEXT,
    "paymentId" TEXT,
    "matchType" TEXT NOT NULL DEFAULT 'Manual',
    "amount" DECIMAL(18,2) NOT NULL,
    "reason" TEXT,
    "createdByMembershipId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "reversedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reconciliation_matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budgets" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fiscalYearId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "ownerMembershipId" TEXT,
    "department" TEXT,
    "currentVersionId" TEXT,
    "activeVersionId" TEXT,
    "createdByMembershipId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_versions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "budgetId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "notes" TEXT,
    "total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "createdByMembershipId" TEXT,
    "submittedAt" TIMESTAMP(3),
    "approvedByMembershipId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "activatedByMembershipId" TEXT,
    "activatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "budget_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_lines" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "budgetVersionId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "costCenterId" TEXT,
    "department" TEXT,
    "projectId" TEXT,
    "periodId" TEXT,
    "plannedAmount" DECIMAL(18,2) NOT NULL,
    "notes" TEXT,

    CONSTRAINT "budget_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "finance_settings_organizationId_key" ON "finance_settings"("organizationId");

-- CreateIndex
CREATE INDEX "finance_overrides_organizationId_createdAt_idx" ON "finance_overrides"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "fiscal_years_organizationId_startDate_idx" ON "fiscal_years"("organizationId", "startDate");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_years_organizationId_name_key" ON "fiscal_years"("organizationId", "name");

-- CreateIndex
CREATE INDEX "fiscal_periods_organizationId_startDate_idx" ON "fiscal_periods"("organizationId", "startDate");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_periods_fiscalYearId_periodNumber_key" ON "fiscal_periods"("fiscalYearId", "periodNumber");

-- CreateIndex
CREATE INDEX "ledger_accounts_organizationId_type_idx" ON "ledger_accounts"("organizationId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_accounts_organizationId_code_key" ON "ledger_accounts"("organizationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "cost_centers_organizationId_code_key" ON "cost_centers"("organizationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "tax_rates_organizationId_code_key" ON "tax_rates"("organizationId", "code");

-- CreateIndex
CREATE INDEX "exchange_rates_organizationId_baseCurrency_quoteCurrency_ef_idx" ON "exchange_rates"("organizationId", "baseCurrency", "quoteCurrency", "effectiveDate");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_reversalOfId_key" ON "journal_entries"("reversalOfId");

-- CreateIndex
CREATE INDEX "journal_entries_organizationId_status_entryDate_idx" ON "journal_entries"("organizationId", "status", "entryDate");

-- CreateIndex
CREATE INDEX "journal_entries_sourceType_sourceId_idx" ON "journal_entries"("sourceType", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_organizationId_entryNumber_key" ON "journal_entries"("organizationId", "entryNumber");

-- CreateIndex
CREATE INDEX "journal_lines_journalEntryId_idx" ON "journal_lines"("journalEntryId");

-- CreateIndex
CREATE INDEX "journal_lines_organizationId_accountId_idx" ON "journal_lines"("organizationId", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "vendors_organizationId_vendorCode_key" ON "vendors"("organizationId", "vendorCode");

-- CreateIndex
CREATE UNIQUE INDEX "vendors_organizationId_companyId_key" ON "vendors"("organizationId", "companyId");

-- CreateIndex
CREATE INDEX "expense_reports_organizationId_submitterMembershipId_idx" ON "expense_reports"("organizationId", "submitterMembershipId");

-- CreateIndex
CREATE UNIQUE INDEX "expense_reports_organizationId_reportNumber_key" ON "expense_reports"("organizationId", "reportNumber");

-- CreateIndex
CREATE INDEX "vendor_bills_organizationId_status_idx" ON "vendor_bills"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_bills_organizationId_billNumber_key" ON "vendor_bills"("organizationId", "billNumber");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_bills_organizationId_vendorId_vendorReference_key" ON "vendor_bills"("organizationId", "vendorId", "vendorReference");

-- CreateIndex
CREATE INDEX "vendor_bill_lines_billId_idx" ON "vendor_bill_lines"("billId");

-- CreateIndex
CREATE INDEX "invoice_lines_invoiceId_idx" ON "invoice_lines"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "financial_accounts_organizationId_name_key" ON "financial_accounts"("organizationId", "name");

-- CreateIndex
CREATE INDEX "payment_allocations_paymentId_idx" ON "payment_allocations"("paymentId");

-- CreateIndex
CREATE INDEX "payment_allocations_invoiceId_idx" ON "payment_allocations"("invoiceId");

-- CreateIndex
CREATE INDEX "payment_allocations_billId_idx" ON "payment_allocations"("billId");

-- CreateIndex
CREATE UNIQUE INDEX "statement_imports_financialAccountId_checksum_key" ON "statement_imports"("financialAccountId", "checksum");

-- CreateIndex
CREATE INDEX "statement_lines_organizationId_reconciliationStatus_idx" ON "statement_lines"("organizationId", "reconciliationStatus");

-- CreateIndex
CREATE UNIQUE INDEX "statement_lines_financialAccountId_fingerprint_key" ON "statement_lines"("financialAccountId", "fingerprint");

-- CreateIndex
CREATE INDEX "reconciliation_sessions_organizationId_financialAccountId_idx" ON "reconciliation_sessions"("organizationId", "financialAccountId");

-- CreateIndex
CREATE INDEX "reconciliation_matches_sessionId_idx" ON "reconciliation_matches"("sessionId");

-- CreateIndex
CREATE INDEX "reconciliation_matches_statementLineId_idx" ON "reconciliation_matches"("statementLineId");

-- CreateIndex
CREATE UNIQUE INDEX "budgets_organizationId_name_fiscalYearId_key" ON "budgets"("organizationId", "name", "fiscalYearId");

-- CreateIndex
CREATE UNIQUE INDEX "budget_versions_budgetId_versionNumber_key" ON "budget_versions"("budgetId", "versionNumber");

-- CreateIndex
CREATE INDEX "budget_lines_budgetVersionId_idx" ON "budget_lines"("budgetVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_organizationId_paymentNumber_key" ON "payments"("organizationId", "paymentNumber");

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_expenseReportId_fkey" FOREIGN KEY ("expenseReportId") REFERENCES "expense_reports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_periods" ADD CONSTRAINT "fiscal_periods_fiscalYearId_fkey" FOREIGN KEY ("fiscalYearId") REFERENCES "fiscal_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ledger_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "cost_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "fiscal_periods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_bills" ADD CONSTRAINT "vendor_bills_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_bill_lines" ADD CONSTRAINT "vendor_bill_lines_billId_fkey" FOREIGN KEY ("billId") REFERENCES "vendor_bills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_billId_fkey" FOREIGN KEY ("billId") REFERENCES "vendor_bills"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "statement_lines" ADD CONSTRAINT "statement_lines_importId_fkey" FOREIGN KEY ("importId") REFERENCES "statement_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_matches" ADD CONSTRAINT "reconciliation_matches_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "reconciliation_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_matches" ADD CONSTRAINT "reconciliation_matches_statementLineId_fkey" FOREIGN KEY ("statementLineId") REFERENCES "statement_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_fiscalYearId_fkey" FOREIGN KEY ("fiscalYearId") REFERENCES "fiscal_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_versions" ADD CONSTRAINT "budget_versions_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "budgets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_budgetVersionId_fkey" FOREIGN KEY ("budgetVersionId") REFERENCES "budget_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Backfills for records created before the ledger existed. They keep their
-- figures but have no journal, so they're marked "Legacy Recorded" and the
-- official (posted-journal) reports don't include them.
-- ---------------------------------------------------------------------------
INSERT INTO "invoice_lines" ("id", "organizationId", "invoiceId", "lineNumber", "description", "quantity", "unitPrice", "discountAmount", "taxSnapshot", "lineSubtotal", "taxAmount", "lineTotal")
SELECT 'il_' || md5(i."id" || ':' || e.ord::text), i."organizationId", i."id", e.ord::int,
       COALESCE(NULLIF(e.item->>'name', ''), 'Line'),
       CASE WHEN (e.item->>'qty') ~ '^[0-9]+(\.[0-9]+)?$' THEN (e.item->>'qty')::numeric ELSE 1 END,
       CASE WHEN (e.item->>'unitPrice') ~ '^[0-9]+(\.[0-9]+)?$' THEN (e.item->>'unitPrice')::numeric ELSE 0 END,
       0,
       jsonb_build_object('taxCategory', e.item->>'taxCategory', 'legacy', true),
       CASE WHEN (e.item->>'lineSubtotal') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (e.item->>'lineSubtotal')::numeric ELSE 0 END,
       CASE WHEN (e.item->>'taxAmount') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (e.item->>'taxAmount')::numeric ELSE 0 END,
       CASE WHEN (e.item->>'lineTotal') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (e.item->>'lineTotal')::numeric ELSE 0 END
FROM "invoices" i
CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(i."items") = 'array' THEN i."items" ELSE '[]'::jsonb END) WITH ORDINALITY AS e(item, ord)
WHERE i."organizationId" IS NOT NULL;

UPDATE "payments" p
SET "status" = 'Legacy Recorded', "direction" = 'Incoming', "currency" = i."currency", "companyId" = i."companyId",
    "createdByMembershipId" = p."recordedByMembershipId"
FROM "invoices" i
WHERE p."invoiceId" = i."id";

INSERT INTO "payment_allocations" ("id", "organizationId", "paymentId", "invoiceId", "amount", "allocationDate", "createdByMembershipId", "status", "createdAt")
SELECT 'pa_' || md5(p."id"), p."organizationId", p."id", p."invoiceId", p."amount", p."date", p."recordedByMembershipId", 'Active', p."createdAt"
FROM "payments" p
WHERE p."organizationId" IS NOT NULL AND p."invoiceId" IS NOT NULL;

UPDATE "credit_notes" c
SET "status" = 'Legacy Recorded', "subtotal" = c."amount", "appliedAmount" = c."amount", "remainingAmount" = 0,
    "creditDate" = c."createdAt", "createdByMembershipId" = c."issuedByMembershipId",
    "companyId" = (SELECT i."companyId" FROM "invoices" i WHERE i."id" = c."invoiceId");

UPDATE "expenses" SET "amountBeforeTax" = "amount", "baseAmount" = "amount", "submittedAt" = "createdAt";
-- DropIndex
DROP INDEX "credit_notes_creditNoteNumber_key";

-- DropIndex
DROP INDEX "expenses_expenseNumber_key";

-- DropIndex
DROP INDEX "invoices_invoiceNumber_key";

-- AlterTable
ALTER TABLE "credit_notes" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'USD',
ADD COLUMN     "issuedByMembershipId" TEXT,
ADD COLUMN     "organizationId" TEXT,
ALTER COLUMN "amount" SET DATA TYPE DECIMAL(14,2);

-- AlterTable
ALTER TABLE "expenses" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'USD',
ADD COLUMN     "organizationId" TEXT,
ADD COLUMN     "reviewNote" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedByMembershipId" TEXT,
ADD COLUMN     "submittedByMembershipId" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1,
ALTER COLUMN "amount" SET DATA TYPE DECIMAL(14,2);

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "amountCredited" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedByMembershipId" TEXT,
ADD COLUMN     "createdByMembershipId" TEXT,
ADD COLUMN     "organizationId" TEXT,
ADD COLUMN     "paidAt" TIMESTAMP(3),
ADD COLUMN     "recurringInvoiceId" TEXT,
ADD COLUMN     "sentAt" TIMESTAMP(3),
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'Manual',
ADD COLUMN     "updatedByMembershipId" TEXT,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "voidedAt" TIMESTAMP(3),
ADD COLUMN     "voidedByMembershipId" TEXT,
ALTER COLUMN "subtotal" SET DATA TYPE DECIMAL(14,2),
ALTER COLUMN "tax" SET DATA TYPE DECIMAL(14,2),
ALTER COLUMN "total" SET DATA TYPE DECIMAL(14,2),
ALTER COLUMN "amountPaid" SET DATA TYPE DECIMAL(14,2),
ALTER COLUMN "amountDue" SET DATA TYPE DECIMAL(14,2);

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "note" TEXT,
ADD COLUMN     "organizationId" TEXT,
ADD COLUMN     "recordedByMembershipId" TEXT,
ADD COLUMN     "reference" TEXT,
ALTER COLUMN "amount" SET DATA TYPE DECIMAL(14,2);

-- AlterTable
ALTER TABLE "recurring_invoices" ADD COLUMN     "createdByMembershipId" TEXT,
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'USD',
ADD COLUMN     "dueDays" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "organizationId" TEXT,
ADD COLUMN     "updatedByMembershipId" TEXT,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateIndex
CREATE INDEX "credit_notes_organizationId_idx" ON "credit_notes"("organizationId");

-- CreateIndex
CREATE INDEX "credit_notes_invoiceId_idx" ON "credit_notes"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "credit_notes_organizationId_creditNoteNumber_key" ON "credit_notes"("organizationId", "creditNoteNumber");

-- CreateIndex
CREATE INDEX "expenses_organizationId_idx" ON "expenses"("organizationId");

-- CreateIndex
CREATE INDEX "expenses_submittedByMembershipId_idx" ON "expenses"("submittedByMembershipId");

-- CreateIndex
CREATE UNIQUE INDEX "expenses_organizationId_expenseNumber_key" ON "expenses"("organizationId", "expenseNumber");

-- CreateIndex
CREATE INDEX "invoices_organizationId_idx" ON "invoices"("organizationId");

-- CreateIndex
CREATE INDEX "invoices_orderId_idx" ON "invoices"("orderId");

-- CreateIndex
CREATE INDEX "invoices_companyId_idx" ON "invoices"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_organizationId_invoiceNumber_key" ON "invoices"("organizationId", "invoiceNumber");

-- CreateIndex
CREATE INDEX "payments_invoiceId_idx" ON "payments"("invoiceId");

-- CreateIndex
CREATE INDEX "payments_organizationId_idx" ON "payments"("organizationId");

-- CreateIndex
CREATE INDEX "recurring_invoices_organizationId_idx" ON "recurring_invoices"("organizationId");

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_recurringInvoiceId_fkey" FOREIGN KEY ("recurringInvoiceId") REFERENCES "recurring_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_createdByMembershipId_fkey" FOREIGN KEY ("createdByMembershipId") REFERENCES "organization_memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_submittedByMembershipId_fkey" FOREIGN KEY ("submittedByMembershipId") REFERENCES "organization_memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_invoices" ADD CONSTRAINT "recurring_invoices_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;


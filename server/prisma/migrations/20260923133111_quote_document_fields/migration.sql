-- AlterTable
ALTER TABLE "quote_line_items" ADD COLUMN     "sectionTitle" TEXT;

-- AlterTable
ALTER TABLE "quotes" ADD COLUMN     "assumptions" TEXT,
ADD COLUMN     "documentLayout" JSONB,
ADD COLUMN     "issueDate" TIMESTAMP(3),
ADD COLUMN     "minimumCommitment" TEXT,
ADD COLUMN     "overallDiscountType" TEXT,
ADD COLUMN     "sendPreview" JSONB,
ADD COLUMN     "serviceStartEstimate" TEXT,
ADD COLUMN     "termsAndConditions" TEXT;

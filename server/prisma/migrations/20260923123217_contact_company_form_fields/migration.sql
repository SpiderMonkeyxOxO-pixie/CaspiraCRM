-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "accountHealth" TEXT,
ADD COLUMN     "accountTier" TEXT,
ADD COLUMN     "customerStatus" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "estimatedAnnualValue" DECIMAL(14,2),
ADD COLUMN     "healthReason" TEXT,
ADD COLUMN     "nextActionDate" TIMESTAMP(3),
ADD COLUMN     "preferredLanguage" TEXT,
ADD COLUMN     "renewalDate" TIMESTAMP(3),
ADD COLUMN     "source" TEXT,
ADD COLUMN     "timeZone" TEXT;

-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "businessDepartment" TEXT,
ADD COLUMN     "decisionMakingRole" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "doNotContactReason" TEXT,
ADD COLUMN     "nextActionDate" TIMESTAMP(3),
ADD COLUMN     "relationshipType" TEXT,
ADD COLUMN     "source" TEXT;

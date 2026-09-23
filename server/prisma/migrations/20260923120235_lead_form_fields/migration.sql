-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "consent" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "disqualifyReason" TEXT,
ADD COLUMN     "interestedProduct" TEXT,
ADD COLUMN     "jobTitle" TEXT,
ADD COLUMN     "preferredContactChannel" TEXT;

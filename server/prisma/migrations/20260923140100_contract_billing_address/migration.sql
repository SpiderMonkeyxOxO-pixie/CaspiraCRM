-- AlterTable
ALTER TABLE "contracts" ADD COLUMN     "billingAddress" TEXT;

-- Contracts no longer use a "Renewal Review" status (the frontend has none);
-- an open ContractRenewalReview row marks a review in progress instead.
UPDATE "contracts" SET "status" = 'Signed' WHERE "status" = 'Renewal Review';

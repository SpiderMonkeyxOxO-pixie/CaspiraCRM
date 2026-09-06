-- AlterTable
ALTER TABLE "activities" ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ALTER COLUMN "status" SET DEFAULT 'Scheduled';

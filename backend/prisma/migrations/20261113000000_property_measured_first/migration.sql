-- AlterTable
ALTER TABLE "Inspection" ADD COLUMN "measuredAt" TIMESTAMP(3);

-- Inspections that already exist were started before this step was required:
-- treat them as measured so nothing in progress gets locked out.
UPDATE "Inspection" SET "measuredAt" = COALESCE("startedAt", "createdAt");

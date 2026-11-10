-- AlterTable
ALTER TABLE "Inspection" ADD COLUMN "companyCopiedAt" TIMESTAMP(3),
ADD COLUMN "companyCopiedTo" TEXT;

-- Inspections already completed before the office copy existed are marked as
-- handled, so turning REPORT_COPY_TO on doesn't send the office a copy of every
-- past job the next time one of them syncs.
UPDATE "Inspection" SET "companyCopiedAt" = COALESCE("completedAt", "updatedAt") WHERE "status" = 'COMPLETED';

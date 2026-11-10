-- AlterTable
ALTER TABLE "InspectionSectionSkip" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'NOT_PRESENT',
ADD COLUMN "reason" TEXT;

-- AlterTable
ALTER TABLE "InspectionPhoto" ADD COLUMN "sectionCategory" TEXT;

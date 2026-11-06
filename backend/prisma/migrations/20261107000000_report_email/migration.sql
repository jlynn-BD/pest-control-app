-- AlterTable
ALTER TABLE "Inspection" ADD COLUMN "reportEmailedAt" TIMESTAMP(3),
ADD COLUMN "reportEmailedTo" TEXT;

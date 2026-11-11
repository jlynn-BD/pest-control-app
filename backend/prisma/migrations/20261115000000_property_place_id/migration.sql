-- AlterTable
ALTER TABLE "Property" ADD COLUMN "googlePlaceId" TEXT;

-- CreateIndex
CREATE INDEX "Property_googlePlaceId_idx" ON "Property"("googlePlaceId");

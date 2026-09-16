CREATE TABLE "InspectionSectionSkip" (
    "id" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "technicianId" TEXT NOT NULL,
    "initials" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InspectionSectionSkip_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InspectionSectionSkip_inspectionId_category_key" ON "InspectionSectionSkip"("inspectionId", "category");

CREATE INDEX "InspectionSectionSkip_inspectionId_idx" ON "InspectionSectionSkip"("inspectionId");

ALTER TABLE "InspectionSectionSkip" ADD CONSTRAINT "InspectionSectionSkip_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "Inspection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InspectionSectionSkip" ADD CONSTRAINT "InspectionSectionSkip_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

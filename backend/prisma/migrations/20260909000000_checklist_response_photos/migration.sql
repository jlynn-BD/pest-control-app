CREATE TABLE "ChecklistResponsePhoto" (
    "id" TEXT NOT NULL,
    "checklistResponseId" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "caption" TEXT,
    "takenAt" TIMESTAMP(3),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChecklistResponsePhoto_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ChecklistResponsePhoto_checklistResponseId_idx" ON "ChecklistResponsePhoto"("checklistResponseId");

ALTER TABLE "ChecklistResponsePhoto" ADD CONSTRAINT "ChecklistResponsePhoto_checklistResponseId_fkey" FOREIGN KEY ("checklistResponseId") REFERENCES "ChecklistResponse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

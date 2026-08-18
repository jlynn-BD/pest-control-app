import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { generateId } from "../../lib/id";
import { asyncHandler, HttpError } from "../../middleware/error-handler";
import { requireAuth } from "../../middleware/auth";

const responseSchema = z.object({
  templateItemId: z.string().min(1),
  status: z.enum(["SATISFACTORY", "NEEDS_ATTENTION", "NOT_APPLICABLE"]),
  notes: z.string().optional().nullable(),
});

// Mounted at /api/inspections/:inspectionId/checklist-responses
export const checklistResponsesOnInspectionRouter = Router({ mergeParams: true });
checklistResponsesOnInspectionRouter.use(requireAuth);

checklistResponsesOnInspectionRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const responses = await prisma.checklistResponse.findMany({
      where: { inspectionId: req.params.inspectionId, deletedAt: null },
    });
    res.json(responses);
  })
);

// One response per (inspection, templateItem) - upserts by that pair so a
// technician can revisit an item and correct their answer without creating
// duplicate rows.
checklistResponsesOnInspectionRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = responseSchema.parse(req.body);
    const inspectionId = req.params.inspectionId;

    const existing = await prisma.checklistResponse.findUnique({
      where: { inspectionId_templateItemId: { inspectionId, templateItemId: body.templateItemId } },
    });

    const response = existing
      ? await prisma.checklistResponse.update({
          where: { id: existing.id },
          data: { status: body.status, notes: body.notes, deletedAt: null },
        })
      : await prisma.checklistResponse.create({
          data: { id: generateId(), inspectionId, templateItemId: body.templateItemId, status: body.status, notes: body.notes },
        });

    res.status(existing ? 200 : 201).json(response);
  })
);

checklistResponsesOnInspectionRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const response = await prisma.checklistResponse.findFirst({
      where: { id: req.params.id, inspectionId: req.params.inspectionId },
    });
    if (!response) throw new HttpError(404, "Checklist response not found");
    await prisma.checklistResponse.update({ where: { id: response.id }, data: { deletedAt: new Date() } });
    res.status(204).send();
  })
);

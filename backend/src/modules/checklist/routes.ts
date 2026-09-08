import { Router } from "express";
import path from "node:path";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { generateId } from "../../lib/id";
import { storage } from "../../lib/storage";
import { asyncHandler, HttpError } from "../../middleware/error-handler";
import { requireAuth } from "../../middleware/auth";
import { upload } from "../../middleware/upload";

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
      include: { photos: { orderBy: { sortOrder: "asc" } } },
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

// Standalone /api/checklist-responses/:id routes - mirrors findingsRouter's
// nested photo endpoints (see findings/routes.ts).
export const checklistResponsesRouter = Router();
checklistResponsesRouter.use(requireAuth);

checklistResponsesRouter.post(
  "/:id/photos",
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(400, "No file uploaded");
    const response = await prisma.checklistResponse.findUnique({ where: { id: req.params.id } });
    if (!response) throw new HttpError(404, "Checklist response not found");

    const photoId = generateId();
    const ext = path.extname(req.file.originalname) || ".jpg";
    const key = `checklist-photos/${response.id}/${photoId}${ext}`;
    await storage.save(req.file.buffer, key);

    const { caption, takenAt, sortOrder } = req.body as Record<string, string | undefined>;
    const photo = await prisma.checklistResponsePhoto.create({
      data: {
        id: photoId,
        checklistResponseId: response.id,
        fileUrl: `/api/media/file/${key}`,
        caption: caption || null,
        takenAt: takenAt ? new Date(takenAt) : new Date(),
        sortOrder: sortOrder ? Number(sortOrder) : 0,
      },
    });
    res.status(201).json(photo);
  })
);

checklistResponsesRouter.delete(
  "/photos/:photoId",
  asyncHandler(async (req, res) => {
    await prisma.checklistResponsePhoto.delete({ where: { id: req.params.photoId } });
    res.status(204).send();
  })
);

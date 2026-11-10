import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { generateId } from "../../lib/id";
import { asyncHandler, HttpError } from "../../middleware/error-handler";
import { requireAuth } from "../../middleware/auth";
import { storage } from "../../lib/storage";
import { upload } from "../../middleware/upload";
import { photoExt } from "../../lib/uploadExt";
import { emailReportInBackground } from "../../lib/customerReport";

export const inspectionsRouter = Router();
inspectionsRouter.use(requireAuth);
// Mounted at /api/inspection-photos (a separate prefix so it cannot be mistaken
// for an inspection id under /api/inspections/:id).
export const inspectionPhotosRouter = Router();
inspectionPhotosRouter.use(requireAuth);

const fullInclude = {
  property: true,
  customer: true,
  template: { include: { sections: { include: { items: true }, orderBy: { sortOrder: "asc" as const } } } },
  technician: { select: { id: true, firstName: true, lastName: true } },
  findings: { include: { photos: true }, where: { deletedAt: null } },
  recommendations: { where: { deletedAt: null } },
  signatures: true,
  sectionSkips: true,
  report: true,
  followUpsFrom: true,
  checklistResponses: { where: { deletedAt: null }, include: { photos: { orderBy: { sortOrder: "asc" as const } } } },
  photos: { orderBy: { sortOrder: "asc" as const } },
};

const inspectionSchema = z.object({
  propertyId: z.string().min(1),
  customerId: z.string().min(1),
  templateId: z.string().optional().nullable(),
  technicianId: z.string().min(1),
  appointmentId: z.string().optional().nullable(),
  status: z.enum(["SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELED"]).optional(),
  scheduledAt: z.string().datetime().optional().nullable(),
  startedAt: z.string().datetime().optional().nullable(),
  generalNotes: z.string().optional().nullable(),
  weatherConditions: z.string().optional().nullable(),
  checklistCategories: z.string().optional().nullable(),
  basedOnInspectionId: z.string().optional().nullable(),
  carriedIssues: z.string().max(200000).optional().nullable(),
});

inspectionsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { technicianId, propertyId, status } = req.query as Record<string, string | undefined>;
    const inspections = await prisma.inspection.findMany({
      where: {
        deletedAt: null,
        ...(technicianId ? { technicianId } : {}),
        ...(propertyId ? { propertyId } : {}),
        ...(status ? { status } : {}),
      },
      include: { property: true, customer: true, technician: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: { createdAt: "desc" },
    });
    res.json(inspections);
  })
);

inspectionsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = inspectionSchema.parse(req.body);
    const inspection = await prisma.inspection.create({
      data: {
        id: generateId(),
        ...body,
        scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : null,
        startedAt: body.startedAt ? new Date(body.startedAt) : null,
      },
    });
    res.status(201).json(inspection);
  })
);

inspectionsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const inspection = await prisma.inspection.findFirst({
      where: { id: req.params.id, deletedAt: null },
      include: fullInclude,
    });
    if (!inspection) throw new HttpError(404, "Inspection not found");
    res.json(inspection);
  })
);

inspectionsRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const body = inspectionSchema.partial().parse(req.body);
    const data: Record<string, unknown> = { ...body };
    if (body.scheduledAt) data.scheduledAt = new Date(body.scheduledAt);
    if (body.startedAt) data.startedAt = new Date(body.startedAt);
    const inspection = await prisma.inspection.update({ where: { id: req.params.id }, data });
    res.json(inspection);
  })
);

inspectionsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    await prisma.inspection.update({ where: { id: req.params.id }, data: { deletedAt: new Date() } });
    res.status(204).send();
  })
);

inspectionsRouter.post(
  "/:id/complete",
  asyncHandler(async (req, res) => {
    const inspection = await prisma.inspection.update({
      where: { id: req.params.id },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
    res.json(inspection);
    // If both signatures were already in, this is what completes the job.
    emailReportInBackground(req, inspection.id);
  })
);

// Pictures of the property taken before (or apart from) the checklist. Same
// upload shape as finding / checklist photos: the file, plus optional caption,
// takenAt and sortOrder.
inspectionsRouter.post(
  "/:id/photos",
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(400, "No file uploaded");
    const inspection = await prisma.inspection.findFirst({ where: { id: req.params.id, deletedAt: null }, select: { id: true } });
    if (!inspection) throw new HttpError(404, "Inspection not found");

    const photoId = generateId();
    const key = `inspection-photos/${inspection.id}/${photoId}${photoExt(req.file.originalname)}`;
    await storage.save(req.file.buffer, key);

    const { caption, takenAt, sortOrder } = req.body as Record<string, string | undefined>;
    const photo = await prisma.inspectionPhoto.create({
      data: {
        id: photoId,
        inspectionId: inspection.id,
        fileUrl: `/api/media/file/${key}`,
        caption: caption || null,
        takenAt: takenAt ? new Date(takenAt) : new Date(),
        sortOrder: sortOrder ? Number(sortOrder) : 0,
      },
    });
    res.status(201).json(photo);
  })
);

inspectionPhotosRouter.delete(
  "/:photoId",
  asyncHandler(async (req, res) => {
    await prisma.inspectionPhoto.deleteMany({ where: { id: req.params.photoId } });
    res.status(204).send();
  })
);

import { Router } from "express";
import path from "node:path";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { generateId } from "../../lib/id";
import { storage } from "../../lib/storage";
import { asyncHandler, HttpError } from "../../middleware/error-handler";
import { requireAuth } from "../../middleware/auth";
import { upload } from "../../middleware/upload";

const findingSchema = z.object({
  areaLocation: z.string().min(1),
  locationDetail: z.string().optional().nullable(),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  description: z.string().optional().nullable(),
  lat: z.number().optional().nullable(),
  lng: z.number().optional().nullable(),
  floorPlanX: z.number().min(0).max(1).optional().nullable(),
  floorPlanY: z.number().min(0).max(1).optional().nullable(),
  siteMapArrowStartX: z.number().min(0).max(1).optional().nullable(),
  siteMapArrowStartY: z.number().min(0).max(1).optional().nullable(),
  siteMapLevel: z.string().optional().nullable(),
});

// Mounted at /api/inspections/:inspectionId/findings
export const findingsOnInspectionRouter = Router({ mergeParams: true });
findingsOnInspectionRouter.use(requireAuth);

findingsOnInspectionRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const findings = await prisma.finding.findMany({
      where: { inspectionId: req.params.inspectionId, deletedAt: null },
      include: { photos: true },
      orderBy: { createdAt: "asc" },
    });
    res.json(findings);
  })
);

findingsOnInspectionRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = findingSchema.parse(req.body);
    const finding = await prisma.finding.create({
      data: {
        id: generateId(),
        inspectionId: req.params.inspectionId,
        areaLocation: body.areaLocation,
        locationDetail: body.locationDetail,
        severity: body.severity,
        description: body.description,
        lat: body.lat,
        lng: body.lng,
        floorPlanX: body.floorPlanX,
        floorPlanY: body.floorPlanY,
        siteMapArrowStartX: body.siteMapArrowStartX,
        siteMapArrowStartY: body.siteMapArrowStartY,
        siteMapLevel: body.siteMapLevel,
      },
      include: { photos: true },
    });
    res.status(201).json(finding);
  })
);

// Standalone /api/findings/:id routes
export const findingsRouter = Router();
findingsRouter.use(requireAuth);

findingsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const finding = await prisma.finding.findFirst({
      where: { id: req.params.id, deletedAt: null },
      include: { photos: true },
    });
    if (!finding) throw new HttpError(404, "Finding not found");
    res.json(finding);
  })
);

findingsRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const body = findingSchema.partial().parse(req.body);
    const finding = await prisma.finding.update({
      where: { id: req.params.id },
      data: body,
      include: { photos: true },
    });
    res.json(finding);
  })
);

findingsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    await prisma.finding.update({ where: { id: req.params.id }, data: { deletedAt: new Date() } });
    res.status(204).send();
  })
);

findingsRouter.post(
  "/:id/photos",
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(400, "No file uploaded");
    const finding = await prisma.finding.findUnique({ where: { id: req.params.id } });
    if (!finding) throw new HttpError(404, "Finding not found");

    const photoId = generateId();
    const ext = path.extname(req.file.originalname) || ".jpg";
    const key = `photos/${finding.id}/${photoId}${ext}`;
    await storage.save(req.file.buffer, key);

    const { caption, lat, lng, takenAt } = req.body as Record<string, string | undefined>;
    const photo = await prisma.findingPhoto.create({
      data: {
        id: photoId,
        findingId: finding.id,
        fileUrl: `/api/media/file/${key}`,
        caption: caption || null,
        lat: lat ? Number(lat) : null,
        lng: lng ? Number(lng) : null,
        takenAt: takenAt ? new Date(takenAt) : new Date(),
      },
    });
    res.status(201).json(photo);
  })
);

findingsRouter.delete(
  "/photos/:photoId",
  asyncHandler(async (req, res) => {
    await prisma.findingPhoto.delete({ where: { id: req.params.photoId } });
    res.status(204).send();
  })
);

import { Router } from "express";
import path from "node:path";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { generateId } from "../../lib/id";
import { storage } from "../../lib/storage";
import { asyncHandler, HttpError } from "../../middleware/error-handler";
import { requireAuth } from "../../middleware/auth";
import { upload } from "../../middleware/upload";

function serializeFinding<T extends { evidenceTypes: string; riskFactors: string; entryPoints: string | null }>(
  finding: T
) {
  return {
    ...finding,
    evidenceTypes: JSON.parse(finding.evidenceTypes) as string[],
    riskFactors: JSON.parse(finding.riskFactors) as string[],
    entryPoints: finding.entryPoints ? (JSON.parse(finding.entryPoints) as string[]) : [],
  };
}

const findingSchema = z.object({
  pestTypeId: z.string().optional().nullable(),
  pestTypeOther: z.string().optional().nullable(),
  areaLocation: z.string().min(1),
  locationDetail: z.string().optional().nullable(),
  evidenceTypes: z.array(z.string()).default([]),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  riskFactors: z.array(z.string()).default([]),
  entryPoints: z.array(z.string()).default([]),
  description: z.string().optional().nullable(),
  lat: z.number().optional().nullable(),
  lng: z.number().optional().nullable(),
  floorPlanX: z.number().min(0).max(1).optional().nullable(),
  floorPlanY: z.number().min(0).max(1).optional().nullable(),
  siteMapArrowStartX: z.number().min(0).max(1).optional().nullable(),
  siteMapArrowStartY: z.number().min(0).max(1).optional().nullable(),
});

// Mounted at /api/inspections/:inspectionId/findings
export const findingsOnInspectionRouter = Router({ mergeParams: true });
findingsOnInspectionRouter.use(requireAuth);

findingsOnInspectionRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const findings = await prisma.finding.findMany({
      where: { inspectionId: req.params.inspectionId, deletedAt: null },
      include: { photos: true, pestType: true },
      orderBy: { createdAt: "asc" },
    });
    res.json(findings.map(serializeFinding));
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
        pestTypeId: body.pestTypeId,
        pestTypeOther: body.pestTypeOther,
        areaLocation: body.areaLocation,
        locationDetail: body.locationDetail,
        evidenceTypes: JSON.stringify(body.evidenceTypes),
        severity: body.severity,
        riskFactors: JSON.stringify(body.riskFactors),
        entryPoints: JSON.stringify(body.entryPoints),
        description: body.description,
        lat: body.lat,
        lng: body.lng,
        floorPlanX: body.floorPlanX,
        floorPlanY: body.floorPlanY,
        siteMapArrowStartX: body.siteMapArrowStartX,
        siteMapArrowStartY: body.siteMapArrowStartY,
      },
      include: { photos: true, pestType: true },
    });
    res.status(201).json(serializeFinding(finding));
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
      include: { photos: true, pestType: true },
    });
    if (!finding) throw new HttpError(404, "Finding not found");
    res.json(serializeFinding(finding));
  })
);

findingsRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const body = findingSchema.partial().parse(req.body);
    const data: Record<string, unknown> = { ...body };
    if (body.evidenceTypes) data.evidenceTypes = JSON.stringify(body.evidenceTypes);
    if (body.riskFactors) data.riskFactors = JSON.stringify(body.riskFactors);
    if (body.entryPoints) data.entryPoints = JSON.stringify(body.entryPoints);
    const finding = await prisma.finding.update({
      where: { id: req.params.id },
      data,
      include: { photos: true, pestType: true },
    });
    res.json(serializeFinding(finding));
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

import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { generateId } from "../../lib/id";
import { asyncHandler, HttpError } from "../../middleware/error-handler";
import { requireAuth } from "../../middleware/auth";

const followUpSchema = z.object({
  reason: z.string().optional().nullable(),
  scheduledDate: z.string().datetime().optional().nullable(),
  warrantyExpiresAt: z.string().datetime().optional().nullable(),
  correctiveActionStatus: z.enum(["PENDING", "VERIFIED", "FAILED", "NOT_APPLICABLE"]).optional(),
  status: z.enum(["SCHEDULED", "COMPLETED", "CANCELED"]).optional(),
  notes: z.string().optional().nullable(),
});

// Mounted at /api/inspections/:inspectionId/followups
export const followUpsOnInspectionRouter = Router({ mergeParams: true });
followUpsOnInspectionRouter.use(requireAuth);

followUpsOnInspectionRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const followUps = await prisma.followUp.findMany({
      where: { inspectionId: req.params.inspectionId, deletedAt: null },
      orderBy: { createdAt: "desc" },
    });
    res.json(followUps);
  })
);

followUpsOnInspectionRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = followUpSchema.parse(req.body);
    const followUp = await prisma.followUp.create({
      data: {
        id: generateId(),
        inspectionId: req.params.inspectionId,
        ...body,
        scheduledDate: body.scheduledDate ? new Date(body.scheduledDate) : null,
        warrantyExpiresAt: body.warrantyExpiresAt ? new Date(body.warrantyExpiresAt) : null,
      },
    });
    res.status(201).json(followUp);
  })
);

export const followUpsRouter = Router();
followUpsRouter.use(requireAuth);

followUpsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const upcoming = req.query.upcoming === "true";
    const followUps = await prisma.followUp.findMany({
      where: {
        deletedAt: null,
        status: { not: "COMPLETED" },
        ...(upcoming ? { scheduledDate: { gte: new Date() } } : {}),
      },
      include: {
        inspection: { include: { property: true, customer: true, technician: { select: { id: true, firstName: true, lastName: true } } } },
      },
      orderBy: { scheduledDate: "asc" },
    });
    res.json(followUps);
  })
);

followUpsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const followUp = await prisma.followUp.findFirst({
      where: { id: req.params.id, deletedAt: null },
      include: { inspection: { include: { property: true, customer: true } }, followUpInspection: true },
    });
    if (!followUp) throw new HttpError(404, "Follow-up not found");
    res.json(followUp);
  })
);

followUpsRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const body = followUpSchema.partial().extend({ followUpInspectionId: z.string().optional().nullable() }).parse(req.body);
    const data: Record<string, unknown> = { ...body };
    if (body.scheduledDate) data.scheduledDate = new Date(body.scheduledDate);
    if (body.warrantyExpiresAt) data.warrantyExpiresAt = new Date(body.warrantyExpiresAt);
    const followUp = await prisma.followUp.update({ where: { id: req.params.id }, data });
    res.json(followUp);
  })
);

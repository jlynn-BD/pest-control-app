import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { generateId } from "../../lib/id";
import { asyncHandler, HttpError } from "../../middleware/error-handler";
import { requireAuth } from "../../middleware/auth";

const recommendationSchema = z.object({
  findingId: z.string().optional().nullable(),
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]),
  ownerType: z.enum(["CUSTOMER", "TECHNICIAN", "THIRD_PARTY"]),
  ownerUserId: z.string().optional().nullable(),
  ownerContactId: z.string().optional().nullable(),
  deadline: z.string().datetime().optional().nullable(),
});

// Mounted at /api/inspections/:inspectionId/recommendations
export const recommendationsOnInspectionRouter = Router({ mergeParams: true });
recommendationsOnInspectionRouter.use(requireAuth);

recommendationsOnInspectionRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const recommendations = await prisma.recommendation.findMany({
      where: { inspectionId: req.params.inspectionId, deletedAt: null },
      orderBy: { createdAt: "asc" },
    });
    res.json(recommendations);
  })
);

recommendationsOnInspectionRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = recommendationSchema.parse(req.body);
    const recommendation = await prisma.recommendation.create({
      data: {
        id: generateId(),
        inspectionId: req.params.inspectionId,
        ...body,
        deadline: body.deadline ? new Date(body.deadline) : null,
      },
    });
    res.status(201).json(recommendation);
  })
);

export const recommendationsRouter = Router();
recommendationsRouter.use(requireAuth);

recommendationsRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const body = recommendationSchema.partial().parse(req.body);
    const data: Record<string, unknown> = { ...body };
    if (body.deadline) data.deadline = new Date(body.deadline);
    const recommendation = await prisma.recommendation.update({ where: { id: req.params.id }, data });
    res.json(recommendation);
  })
);

recommendationsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    await prisma.recommendation.update({ where: { id: req.params.id }, data: { deletedAt: new Date() } });
    res.status(204).send();
  })
);

recommendationsRouter.post(
  "/:id/complete",
  asyncHandler(async (req, res) => {
    const recommendation = await prisma.recommendation.update({
      where: { id: req.params.id },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
    res.json(recommendation);
  })
);

recommendationsRouter.post(
  "/:id/verify",
  asyncHandler(async (req, res) => {
    const { followUpId } = req.body as { followUpId?: string };
    const existing = await prisma.recommendation.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new HttpError(404, "Recommendation not found");
    const recommendation = await prisma.recommendation.update({
      where: { id: req.params.id },
      data: { status: "VERIFIED", verifiedAt: new Date(), verifiedByFollowUpId: followUpId ?? null },
    });
    res.json(recommendation);
  })
);

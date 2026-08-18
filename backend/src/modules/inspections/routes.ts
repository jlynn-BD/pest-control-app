import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { generateId } from "../../lib/id";
import { asyncHandler, HttpError } from "../../middleware/error-handler";
import { requireAuth } from "../../middleware/auth";

export const inspectionsRouter = Router();
inspectionsRouter.use(requireAuth);

const fullInclude = {
  property: true,
  customer: true,
  template: { include: { sections: { include: { items: true }, orderBy: { sortOrder: "asc" as const } } } },
  technician: { select: { id: true, firstName: true, lastName: true } },
  findings: { include: { photos: true, pestType: true }, where: { deletedAt: null } },
  recommendations: { where: { deletedAt: null } },
  treatmentRecords: { include: { products: true }, where: { deletedAt: null } },
  signatures: true,
  report: true,
  followUpsFrom: true,
  checklistResponses: { where: { deletedAt: null } },
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
  })
);

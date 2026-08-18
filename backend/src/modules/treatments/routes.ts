import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { generateId } from "../../lib/id";
import { asyncHandler, HttpError } from "../../middleware/error-handler";
import { requireAuth } from "../../middleware/auth";

const productSchema = z.object({
  productName: z.string().min(1),
  epaRegistrationNumber: z.string().optional().nullable(),
  activeIngredient: z.string().optional().nullable(),
  quantity: z.number(),
  unit: z.string().min(1),
  concentration: z.string().optional().nullable(),
  applicationMethod: z.string().optional().nullable(),
});

const treatmentSchema = z.object({
  findingId: z.string().optional().nullable(),
  method: z.string().min(1),
  targetPest: z.string().optional().nullable(),
  areaTreated: z.string().optional().nullable(),
  appliedAt: z.string().datetime(),
  safetyInstructions: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  products: z.array(productSchema).default([]),
});

// Mounted at /api/inspections/:inspectionId/treatments
export const treatmentsOnInspectionRouter = Router({ mergeParams: true });
treatmentsOnInspectionRouter.use(requireAuth);

treatmentsOnInspectionRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const treatments = await prisma.treatmentRecord.findMany({
      where: { inspectionId: req.params.inspectionId, deletedAt: null },
      include: { products: true },
      orderBy: { createdAt: "asc" },
    });
    res.json(treatments);
  })
);

treatmentsOnInspectionRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = treatmentSchema.parse(req.body);
    const { products, ...rest } = body;
    const treatment = await prisma.treatmentRecord.create({
      data: {
        id: generateId(),
        inspectionId: req.params.inspectionId,
        technicianId: req.user!.id,
        ...rest,
        appliedAt: new Date(body.appliedAt),
        products: {
          create: products.map((p) => ({ id: generateId(), ...p })),
        },
      },
      include: { products: true },
    });
    res.status(201).json(treatment);
  })
);

export const treatmentsRouter = Router();
treatmentsRouter.use(requireAuth);

treatmentsRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const body = treatmentSchema.partial().omit({ products: true }).parse(req.body);
    const data: Record<string, unknown> = { ...body };
    if (body.appliedAt) data.appliedAt = new Date(body.appliedAt);
    const treatment = await prisma.treatmentRecord.update({
      where: { id: req.params.id },
      data,
      include: { products: true },
    });
    res.json(treatment);
  })
);

treatmentsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    await prisma.treatmentRecord.update({ where: { id: req.params.id }, data: { deletedAt: new Date() } });
    res.status(204).send();
  })
);

treatmentsRouter.post(
  "/:id/products",
  asyncHandler(async (req, res) => {
    const body = productSchema.parse(req.body);
    const product = await prisma.treatmentProduct.create({
      data: { id: generateId(), treatmentRecordId: req.params.id, ...body },
    });
    res.status(201).json(product);
  })
);

treatmentsRouter.patch(
  "/products/:id",
  asyncHandler(async (req, res) => {
    const body = productSchema.partial().parse(req.body);
    const product = await prisma.treatmentProduct.update({ where: { id: req.params.id }, data: body });
    res.json(product);
  })
);

treatmentsRouter.delete(
  "/products/:id",
  asyncHandler(async (req, res) => {
    await prisma.treatmentProduct.delete({ where: { id: req.params.id } });
    res.status(204).send();
  })
);

treatmentsRouter.post(
  "/:id/approve",
  asyncHandler(async (req, res) => {
    const { approved, approvedByContactId } = req.body as { approved: boolean; approvedByContactId?: string };
    const existing = await prisma.treatmentRecord.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new HttpError(404, "Treatment record not found");
    const treatment = await prisma.treatmentRecord.update({
      where: { id: req.params.id },
      data: {
        approvalStatus: approved ? "APPROVED" : "DECLINED",
        approvedByContactId: approvedByContactId ?? null,
        approvedAt: new Date(),
      },
    });
    res.json(treatment);
  })
);

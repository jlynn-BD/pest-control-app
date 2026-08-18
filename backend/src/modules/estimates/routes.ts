import { Router } from "express";
import { renderToBuffer } from "@react-pdf/renderer";
import React from "react";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { generateId } from "../../lib/id";
import { asyncHandler, HttpError } from "../../middleware/error-handler";
import { requireAuth } from "../../middleware/auth";
import { EstimateDocument, EstimateData } from "./pdfTemplate";

export const estimatesRouter = Router();
estimatesRouter.use(requireAuth);

// Mounted at /api/inspections/:inspectionId/estimate-draft
export const estimateDraftOnInspectionRouter = Router({ mergeParams: true });
estimateDraftOnInspectionRouter.use(requireAuth);

const lineItemSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().positive().default(1),
  unitPrice: z.number().min(0).default(0),
});

const round2 = (n: number) => Math.round(n * 100) / 100;

function computeTotals(lineItems: { quantity: number; unitPrice: number }[], taxRate: number) {
  const amounts = lineItems.map((li) => round2(li.quantity * li.unitPrice));
  const subtotal = round2(amounts.reduce((sum, a) => sum + a, 0));
  const taxAmount = round2(subtotal * taxRate);
  const total = round2(subtotal + taxAmount);
  return { amounts, subtotal, taxAmount, total };
}

const createSchema = z.object({
  customerId: z.string().min(1),
  propertyId: z.string().min(1),
  inspectionId: z.string().optional().nullable(),
  taxRate: z.number().min(0).max(1).default(0),
  notes: z.string().optional().nullable(),
  validUntil: z.string().datetime().optional().nullable(),
  lineItems: z.array(lineItemSchema).default([]),
});

const fullInclude = {
  lineItems: { orderBy: { sortOrder: "asc" as const } },
  customer: { select: { id: true, name: true } },
  property: { select: { id: true, addressLine1: true, city: true, state: true, postalCode: true } },
  createdBy: { select: { id: true, firstName: true, lastName: true } },
};

estimatesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { customerId, propertyId, inspectionId, status } = req.query as Record<string, string | undefined>;
    const estimates = await prisma.estimate.findMany({
      where: {
        deletedAt: null,
        ...(customerId ? { customerId } : {}),
        ...(propertyId ? { propertyId } : {}),
        ...(inspectionId ? { inspectionId } : {}),
        ...(status ? { status } : {}),
      },
      include: fullInclude,
      orderBy: { createdAt: "desc" },
    });
    res.json(estimates);
  })
);

estimatesRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    const { amounts, subtotal, taxAmount, total } = computeTotals(body.lineItems, body.taxRate);

    const estimate = await prisma.estimate.create({
      data: {
        id: generateId(),
        customerId: body.customerId,
        propertyId: body.propertyId,
        inspectionId: body.inspectionId,
        createdByUserId: req.user!.id,
        status: "DRAFT",
        taxRate: body.taxRate,
        subtotal,
        taxAmount,
        total,
        notes: body.notes,
        validUntil: body.validUntil ? new Date(body.validUntil) : null,
        lineItems: {
          create: body.lineItems.map((li, i) => ({
            id: generateId(),
            description: li.description,
            quantity: li.quantity,
            unitPrice: li.unitPrice,
            amount: amounts[i],
            sortOrder: i,
          })),
        },
      },
      include: fullInclude,
    });
    res.status(201).json(estimate);
  })
);

estimatesRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const estimate = await prisma.estimate.findFirst({ where: { id: req.params.id, deletedAt: null }, include: fullInclude });
    if (!estimate) throw new HttpError(404, "Estimate not found");
    res.json(estimate);
  })
);

const updateSchema = z.object({
  status: z.enum(["DRAFT", "SENT", "APPROVED", "DECLINED", "EXPIRED"]).optional(),
  taxRate: z.number().min(0).max(1).optional(),
  notes: z.string().optional().nullable(),
  validUntil: z.string().datetime().optional().nullable(),
  lineItems: z.array(lineItemSchema).optional(),
});

estimatesRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const existing = await prisma.estimate.findFirst({ where: { id: req.params.id, deletedAt: null }, include: { lineItems: true } });
    if (!existing) throw new HttpError(404, "Estimate not found");
    const body = updateSchema.parse(req.body);

    const taxRate = body.taxRate ?? existing.taxRate;
    const lineItemsForTotals = body.lineItems ?? existing.lineItems;
    const { amounts, subtotal, taxAmount, total } = computeTotals(lineItemsForTotals, taxRate);

    await prisma.$transaction(async (tx) => {
      if (body.lineItems) {
        await tx.estimateLineItem.deleteMany({ where: { estimateId: existing.id } });
        await tx.estimateLineItem.createMany({
          data: body.lineItems.map((li, i) => ({
            id: generateId(),
            estimateId: existing.id,
            description: li.description,
            quantity: li.quantity,
            unitPrice: li.unitPrice,
            amount: amounts[i],
            sortOrder: i,
          })),
        });
      }
      await tx.estimate.update({
        where: { id: existing.id },
        data: {
          status: body.status,
          taxRate,
          subtotal,
          taxAmount,
          total,
          notes: body.notes,
          validUntil: body.validUntil !== undefined ? (body.validUntil ? new Date(body.validUntil) : null) : undefined,
        },
      });
    });

    const estimate = await prisma.estimate.findUnique({ where: { id: existing.id }, include: fullInclude });
    res.json(estimate);
  })
);

estimatesRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    await prisma.estimate.update({ where: { id: req.params.id }, data: { deletedAt: new Date() } });
    res.status(204).send();
  })
);

estimatesRouter.get(
  "/:id/pdf",
  asyncHandler(async (req, res) => {
    const estimate = await prisma.estimate.findFirst({ where: { id: req.params.id, deletedAt: null }, include: fullInclude });
    if (!estimate) throw new HttpError(404, "Estimate not found");

    const data: EstimateData = {
      estimateId: estimate.id,
      status: estimate.status,
      customerName: estimate.customer.name,
      propertyAddress: `${estimate.property.addressLine1}, ${estimate.property.city}, ${estimate.property.state} ${estimate.property.postalCode}`,
      createdByName: `${estimate.createdBy.firstName} ${estimate.createdBy.lastName}`,
      generatedAt: new Date().toISOString(),
      validUntil: estimate.validUntil?.toISOString() ?? null,
      notes: estimate.notes,
      lineItems: estimate.lineItems.map((li) => ({
        description: li.description,
        quantity: li.quantity,
        unitPrice: li.unitPrice,
        amount: li.amount,
      })),
      subtotal: estimate.subtotal,
      taxRate: estimate.taxRate,
      taxAmount: estimate.taxAmount,
      total: estimate.total,
    };

    // renderToBuffer's typing wants a literal <Document> element; our
    // wrapper component always renders exactly one, so this cast is safe
    // (see the @ts-nocheck note in pdfTemplate.tsx for the underlying
    // duplicate @types/react cause).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const buffer = await renderToBuffer(React.createElement(EstimateDocument, { data }) as any);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="estimate-${estimate.id}.pdf"`);
    res.send(buffer);
  })
);

// Seeds a DRAFT estimate from an inspection's open recommendations, one line
// item per recommendation (technician fills in real pricing afterward) - the
// natural handoff from "what needs fixing" to "what it costs."
estimateDraftOnInspectionRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const inspection = await prisma.inspection.findFirst({
      where: { id: req.params.inspectionId, deletedAt: null },
      include: { recommendations: { where: { deletedAt: null, status: { not: "WONT_FIX" } } } },
    });
    if (!inspection) throw new HttpError(404, "Inspection not found");

    const lineItems = inspection.recommendations.length
      ? inspection.recommendations.map((r) => ({ description: r.title, quantity: 1, unitPrice: 0 }))
      : [{ description: "Service", quantity: 1, unitPrice: 0 }];
    const { amounts, subtotal, taxAmount, total } = computeTotals(lineItems, 0);

    const estimate = await prisma.estimate.create({
      data: {
        id: generateId(),
        customerId: inspection.customerId,
        propertyId: inspection.propertyId,
        inspectionId: inspection.id,
        createdByUserId: req.user!.id,
        status: "DRAFT",
        taxRate: 0,
        subtotal,
        taxAmount,
        total,
        lineItems: {
          create: lineItems.map((li, i) => ({
            id: generateId(),
            description: li.description,
            quantity: li.quantity,
            unitPrice: li.unitPrice,
            amount: amounts[i],
            sortOrder: i,
          })),
        },
      },
      include: fullInclude,
    });
    res.status(201).json(estimate);
  })
);

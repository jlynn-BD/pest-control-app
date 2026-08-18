import { Router } from "express";
import path from "node:path";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { generateId } from "../../lib/id";
import { storage } from "../../lib/storage";
import { asyncHandler, HttpError } from "../../middleware/error-handler";
import { requireAuth } from "../../middleware/auth";
import { upload } from "../../middleware/upload";

export const propertiesRouter = Router();
propertiesRouter.use(requireAuth);

const propertySchema = z.object({
  customerId: z.string().min(1),
  label: z.string().optional().nullable(),
  addressLine1: z.string().min(1),
  addressLine2: z.string().optional().nullable(),
  city: z.string().min(1),
  state: z.string().min(1),
  postalCode: z.string().min(1),
  country: z.string().optional(),
  lat: z.number().optional().nullable(),
  lng: z.number().optional().nullable(),
  propertyType: z.enum(["RESIDENTIAL_SINGLE", "RESIDENTIAL_MULTI", "COMMERCIAL", "INDUSTRIAL", "OTHER"]),
  squareFootage: z.number().int().optional().nullable(),
  yearBuilt: z.number().int().optional().nullable(),
  accessNotes: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

propertiesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const customerId = typeof req.query.customerId === "string" ? req.query.customerId : undefined;
    const properties = await prisma.property.findMany({
      where: { deletedAt: null, ...(customerId ? { customerId } : {}) },
      include: { customer: true },
      orderBy: { createdAt: "desc" },
    });
    res.json(properties);
  })
);

propertiesRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = propertySchema.parse(req.body);
    const property = await prisma.property.create({ data: { id: generateId(), ...body } });
    res.status(201).json(property);
  })
);

propertiesRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const property = await prisma.property.findFirst({
      where: { id: req.params.id, deletedAt: null },
      include: { customer: true },
    });
    if (!property) throw new HttpError(404, "Property not found");
    res.json(property);
  })
);

propertiesRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const body = propertySchema.partial().parse(req.body);
    const property = await prisma.property.update({ where: { id: req.params.id }, data: body });
    res.json(property);
  })
);

propertiesRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    await prisma.property.update({ where: { id: req.params.id }, data: { deletedAt: new Date() } });
    res.status(204).send();
  })
);

// Service history: prior inspections at this property.
propertiesRouter.get(
  "/:id/inspections",
  asyncHandler(async (req, res) => {
    const inspections = await prisma.inspection.findMany({
      where: { propertyId: req.params.id, deletedAt: null },
      include: {
        technician: { select: { id: true, firstName: true, lastName: true } },
        findings: true,
        report: true,
      },
      orderBy: { createdAt: "desc" },
    });
    res.json(inspections);
  })
);

// Site map: a base diagram/photo of the property that inspection findings
// can be pinned to with an arrow + label. Lives on the property (not the
// inspection) since exclusion diagrams are drawn once and reused across
// every future visit.
propertiesRouter.post(
  "/:id/site-map",
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(400, "No file uploaded");
    const property = await prisma.property.findFirst({ where: { id: req.params.id, deletedAt: null } });
    if (!property) throw new HttpError(404, "Property not found");

    const ext = path.extname(req.file.originalname) || ".jpg";
    const key = `site-maps/${property.id}/${generateId()}${ext}`;
    await storage.save(req.file.buffer, key);

    const updated = await prisma.property.update({
      where: { id: property.id },
      data: { siteMapImageUrl: `/api/media/file/${key}`, siteMapUpdatedAt: new Date() },
    });
    res.status(201).json(updated);
  })
);

const siteMapSketchSchema = z.object({
  lines: z.array(z.object({ x1: z.number(), y1: z.number(), x2: z.number(), y2: z.number() })),
  labels: z.array(z.object({ x: z.number(), y: z.number(), text: z.string().min(1) })),
});

// Freehand structure sketch (wall outlines + nameplate labels) drawn
// directly in the app, as an alternative or complement to an uploaded
// site-map photo - some properties never get a photographed diagram, just
// a technician's own quick rectangle-and-arrows sketch of the building.
propertiesRouter.patch(
  "/:id/site-map-sketch",
  asyncHandler(async (req, res) => {
    const body = siteMapSketchSchema.parse(req.body);
    const property = await prisma.property.findFirst({ where: { id: req.params.id, deletedAt: null } });
    if (!property) throw new HttpError(404, "Property not found");

    const updated = await prisma.property.update({
      where: { id: property.id },
      data: { siteMapSketch: JSON.stringify(body), siteMapUpdatedAt: new Date() },
    });
    res.json(updated);
  })
);

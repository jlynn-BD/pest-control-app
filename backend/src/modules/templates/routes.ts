import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { generateId } from "../../lib/id";
import { asyncHandler, HttpError } from "../../middleware/error-handler";
import { requireAuth, requireRole } from "../../middleware/auth";

export const templatesRouter = Router();
templatesRouter.use(requireAuth);

const templateSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  pestCategory: z.string().optional().nullable(),
  active: z.boolean().optional(),
});

templatesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const templates = await prisma.inspectionTemplate.findMany({
      include: { sections: { include: { items: { orderBy: { sortOrder: "asc" } } }, orderBy: { sortOrder: "asc" } } },
      orderBy: { name: "asc" },
    });
    res.json(templates);
  })
);

templatesRouter.post(
  "/",
  requireRole("ADMIN", "OFFICE"),
  asyncHandler(async (req, res) => {
    const body = templateSchema.parse(req.body);
    const template = await prisma.inspectionTemplate.create({ data: { id: generateId(), ...body } });
    res.status(201).json(template);
  })
);

templatesRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const template = await prisma.inspectionTemplate.findUnique({
      where: { id: req.params.id },
      include: { sections: { include: { items: { orderBy: { sortOrder: "asc" } } }, orderBy: { sortOrder: "asc" } } },
    });
    if (!template) throw new HttpError(404, "Template not found");
    res.json(template);
  })
);

templatesRouter.patch(
  "/:id",
  requireRole("ADMIN", "OFFICE"),
  asyncHandler(async (req, res) => {
    const body = templateSchema.partial().parse(req.body);
    const template = await prisma.inspectionTemplate.update({ where: { id: req.params.id }, data: body });
    res.json(template);
  })
);

templatesRouter.delete(
  "/:id",
  requireRole("ADMIN", "OFFICE"),
  asyncHandler(async (req, res) => {
    await prisma.inspectionTemplate.delete({ where: { id: req.params.id } });
    res.status(204).send();
  })
);

const sectionSchema = z.object({
  name: z.string().min(1),
  category: z.enum(["EXTERIOR", "INTERIOR", "OTHER"]).optional(),
  sortOrder: z.number().int().optional(),
});

templatesRouter.post(
  "/:id/sections",
  requireRole("ADMIN", "OFFICE"),
  asyncHandler(async (req, res) => {
    const body = sectionSchema.parse(req.body);
    const section = await prisma.templateSection.create({
      data: { id: generateId(), templateId: req.params.id, ...body },
    });
    res.status(201).json(section);
  })
);

templatesRouter.patch(
  "/sections/:id",
  requireRole("ADMIN", "OFFICE"),
  asyncHandler(async (req, res) => {
    const body = sectionSchema.partial().parse(req.body);
    const section = await prisma.templateSection.update({ where: { id: req.params.id }, data: body });
    res.json(section);
  })
);

templatesRouter.delete(
  "/sections/:id",
  requireRole("ADMIN", "OFFICE"),
  asyncHandler(async (req, res) => {
    await prisma.templateSection.delete({ where: { id: req.params.id } });
    res.status(204).send();
  })
);

const itemSchema = z.object({
  prompt: z.string().min(1),
  itemType: z.enum(["CHECKBOX", "TEXT", "NUMBER", "PHOTO", "PEST_FINDING"]),
  sortOrder: z.number().int().optional(),
  required: z.boolean().optional(),
});

templatesRouter.post(
  "/sections/:id/items",
  requireRole("ADMIN", "OFFICE"),
  asyncHandler(async (req, res) => {
    const body = itemSchema.parse(req.body);
    const item = await prisma.templateItem.create({
      data: { id: generateId(), sectionId: req.params.id, ...body },
    });
    res.status(201).json(item);
  })
);

templatesRouter.patch(
  "/items/:id",
  requireRole("ADMIN", "OFFICE"),
  asyncHandler(async (req, res) => {
    const body = itemSchema.partial().parse(req.body);
    const item = await prisma.templateItem.update({ where: { id: req.params.id }, data: body });
    res.json(item);
  })
);

templatesRouter.delete(
  "/items/:id",
  requireRole("ADMIN", "OFFICE"),
  asyncHandler(async (req, res) => {
    await prisma.templateItem.delete({ where: { id: req.params.id } });
    res.status(204).send();
  })
);

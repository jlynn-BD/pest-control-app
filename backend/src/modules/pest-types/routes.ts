import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { generateId } from "../../lib/id";
import { asyncHandler } from "../../middleware/error-handler";
import { requireAuth, requireRole } from "../../middleware/auth";

export const pestTypesRouter = Router();
pestTypesRouter.use(requireAuth);

pestTypesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const pestTypes = await prisma.pestType.findMany({ where: { active: true }, orderBy: { name: "asc" } });
    res.json(pestTypes);
  })
);

const pestTypeSchema = z.object({
  name: z.string().min(1),
  category: z.string().optional().nullable(),
});

pestTypesRouter.post(
  "/",
  requireRole("ADMIN", "OFFICE"),
  asyncHandler(async (req, res) => {
    const body = pestTypeSchema.parse(req.body);
    const pestType = await prisma.pestType.create({ data: { id: generateId(), ...body } });
    res.status(201).json(pestType);
  })
);

import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { generateId } from "../../lib/id";
import { hashPassword } from "../../lib/password";
import { asyncHandler, HttpError } from "../../middleware/error-handler";
import { requireAuth, requireRole } from "../../middleware/auth";

export const usersRouter = Router();
usersRouter.use(requireAuth);

const userSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
  phone: true,
  active: true,
  createdAt: true,
  updatedAt: true,
};

usersRouter.get(
  "/",
  requireRole("ADMIN", "OFFICE"),
  asyncHandler(async (req, res) => {
    const users = await prisma.user.findMany({ select: userSelect, orderBy: { firstName: "asc" } });
    res.json(users);
  })
);

const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  role: z.enum(["ADMIN", "OFFICE", "TECHNICIAN"]),
  phone: z.string().optional(),
});

usersRouter.post(
  "/",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const body = createUserSchema.parse(req.body);
    const passwordHash = await hashPassword(body.password);
    const user = await prisma.user.create({
      data: { id: generateId(), ...body, passwordHash },
      select: userSelect,
    });
    res.status(201).json(user);
  })
);

usersRouter.get(
  "/:id",
  requireRole("ADMIN", "OFFICE"),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.params.id }, select: userSelect });
    if (!user) throw new HttpError(404, "User not found");
    res.json(user);
  })
);

const updateUserSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  role: z.enum(["ADMIN", "OFFICE", "TECHNICIAN"]).optional(),
  phone: z.string().nullable().optional(),
  active: z.boolean().optional(),
  password: z.string().min(8).optional(),
});

usersRouter.patch(
  "/:id",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const body = updateUserSchema.parse(req.body);
    const { password, ...rest } = body;
    const data: Record<string, unknown> = { ...rest };
    if (password) data.passwordHash = await hashPassword(password);
    const user = await prisma.user.update({ where: { id: req.params.id }, data, select: userSelect });
    res.json(user);
  })
);

usersRouter.delete(
  "/:id",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    await prisma.user.update({ where: { id: req.params.id }, data: { active: false } });
    res.status(204).send();
  })
);

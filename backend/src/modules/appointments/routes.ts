import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { generateId } from "../../lib/id";
import { asyncHandler, HttpError } from "../../middleware/error-handler";
import { requireAuth } from "../../middleware/auth";

export const appointmentsRouter = Router();
appointmentsRouter.use(requireAuth);

const appointmentSchema = z.object({
  propertyId: z.string().min(1),
  customerId: z.string().min(1),
  technicianId: z.string().min(1),
  type: z.enum(["INITIAL_INSPECTION", "FOLLOWUP_INSPECTION", "TREATMENT", "OTHER"]),
  scheduledStart: z.string().datetime(),
  scheduledEnd: z.string().datetime().optional().nullable(),
  status: z.enum(["SCHEDULED", "CONFIRMED", "IN_PROGRESS", "COMPLETED", "CANCELED", "NO_SHOW"]).optional(),
  notes: z.string().optional().nullable(),
});

appointmentsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { technicianId, from, to } = req.query as Record<string, string | undefined>;
    const appointments = await prisma.appointment.findMany({
      where: {
        deletedAt: null,
        ...(technicianId ? { technicianId } : {}),
        ...(from || to
          ? {
              scheduledStart: {
                ...(from ? { gte: new Date(from) } : {}),
                ...(to ? { lte: new Date(to) } : {}),
              },
            }
          : {}),
      },
      include: {
        property: true,
        customer: true,
        technician: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { scheduledStart: "asc" },
    });
    res.json(appointments);
  })
);

appointmentsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = appointmentSchema.parse(req.body);
    const appointment = await prisma.appointment.create({
      data: {
        id: generateId(),
        ...body,
        scheduledStart: new Date(body.scheduledStart),
        scheduledEnd: body.scheduledEnd ? new Date(body.scheduledEnd) : null,
        createdByUserId: req.user!.id,
      },
    });
    res.status(201).json(appointment);
  })
);

appointmentsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const appointment = await prisma.appointment.findFirst({
      where: { id: req.params.id, deletedAt: null },
      include: { property: true, customer: true, technician: true, inspection: true },
    });
    if (!appointment) throw new HttpError(404, "Appointment not found");
    res.json(appointment);
  })
);

appointmentsRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const body = appointmentSchema.partial().parse(req.body);
    const data: Record<string, unknown> = { ...body };
    if (body.scheduledStart) data.scheduledStart = new Date(body.scheduledStart);
    if (body.scheduledEnd) data.scheduledEnd = new Date(body.scheduledEnd);
    const appointment = await prisma.appointment.update({ where: { id: req.params.id }, data });
    res.json(appointment);
  })
);

appointmentsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    await prisma.appointment.update({ where: { id: req.params.id }, data: { deletedAt: new Date() } });
    res.status(204).send();
  })
);

// Per-technician daily schedule
appointmentsRouter.get(
  "/technician/:id/schedule",
  asyncHandler(async (req, res) => {
    const dateParam = typeof req.query.date === "string" ? req.query.date : new Date().toISOString().slice(0, 10);
    const dayStart = new Date(`${dateParam}T00:00:00.000Z`);
    const dayEnd = new Date(`${dateParam}T23:59:59.999Z`);
    const appointments = await prisma.appointment.findMany({
      where: {
        technicianId: req.params.id,
        deletedAt: null,
        scheduledStart: { gte: dayStart, lte: dayEnd },
      },
      include: { property: true, customer: true },
      orderBy: { scheduledStart: "asc" },
    });
    res.json(appointments);
  })
);

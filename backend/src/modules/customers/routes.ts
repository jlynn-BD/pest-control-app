import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { generateId } from "../../lib/id";
import { asyncHandler, HttpError } from "../../middleware/error-handler";
import { requireAuth } from "../../middleware/auth";

export const customersRouter = Router();
customersRouter.use(requireAuth);

const customerSchema = z.object({
  type: z.enum(["RESIDENTIAL", "COMMERCIAL"]),
  name: z.string().min(1),
  email: z.string().email().optional().nullable(),
  phone: z.string().optional().nullable(),
  billingAddressLine1: z.string().optional().nullable(),
  billingAddressLine2: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  postalCode: z.string().optional().nullable(),
  country: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

customersRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q : undefined;
    const customers = await prisma.customer.findMany({
      where: {
        deletedAt: null,
        ...(q ? { name: { contains: q } } : {}),
      },
      include: { properties: { where: { deletedAt: null } } },
      orderBy: { name: "asc" },
    });
    res.json(customers);
  })
);

customersRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = customerSchema.parse(req.body);
    const customer = await prisma.customer.create({ data: { id: generateId(), ...body } });
    res.status(201).json(customer);
  })
);

customersRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const customer = await prisma.customer.findFirst({
      where: { id: req.params.id, deletedAt: null },
      include: {
        contacts: { where: { deletedAt: null } },
        properties: { where: { deletedAt: null } },
      },
    });
    if (!customer) throw new HttpError(404, "Customer not found");
    res.json(customer);
  })
);

customersRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const body = customerSchema.partial().parse(req.body);
    const customer = await prisma.customer.update({ where: { id: req.params.id }, data: body });
    res.json(customer);
  })
);

customersRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    await prisma.customer.update({ where: { id: req.params.id }, data: { deletedAt: new Date() } });
    res.status(204).send();
  })
);

const contactSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  role: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  phone: z.string().optional().nullable(),
  isPrimary: z.boolean().optional(),
});

customersRouter.get(
  "/:id/contacts",
  asyncHandler(async (req, res) => {
    const contacts = await prisma.contact.findMany({
      where: { customerId: req.params.id, deletedAt: null },
      orderBy: { isPrimary: "desc" },
    });
    res.json(contacts);
  })
);

customersRouter.post(
  "/:id/contacts",
  asyncHandler(async (req, res) => {
    const body = contactSchema.parse(req.body);
    const contact = await prisma.contact.create({
      data: { id: generateId(), customerId: req.params.id, ...body },
    });
    res.status(201).json(contact);
  })
);

export const contactsRouter = Router();
contactsRouter.use(requireAuth);

contactsRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const body = contactSchema.partial().parse(req.body);
    const contact = await prisma.contact.update({ where: { id: req.params.id }, data: body });
    res.json(contact);
  })
);

contactsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    await prisma.contact.update({ where: { id: req.params.id }, data: { deletedAt: new Date() } });
    res.status(204).send();
  })
);

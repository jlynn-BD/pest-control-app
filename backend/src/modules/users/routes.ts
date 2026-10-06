import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { generateId } from "../../lib/id";
import { hashPassword } from "../../lib/password";
import { randomReadable } from "../../lib/crypto";
import { normalizePhone } from "../../lib/sms";
import { recordAuthEvent } from "../../lib/authEvents";
import { revokeUserSessions } from "../../lib/sessions";
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
  mfaMethod: true,
  mustChangePassword: true,
  lastLoginAt: true,
  lockedUntil: true,
  createdAt: true,
  updatedAt: true,
};

// A one-time password an admin hands to the person (in person or by a
// message). They must replace it at their first sign-in, so it's only ever
// good once. 14 unambiguous characters.
function temporaryPassword(): string {
  return `${randomReadable(5)}-${randomReadable(5)}-${randomReadable(4)}`;
}

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
    const email = body.email.trim().toLowerCase();
    if (await prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } } })) {
      throw new HttpError(409, "Someone with that email already has an account.");
    }
    let phone: string | undefined;
    if (body.phone?.trim()) {
      phone = normalizePhone(body.phone) ?? undefined;
      if (!phone) throw new HttpError(400, "That phone number doesn't look right. Use a mobile number like 555-123-4567.");
    }
    const password = temporaryPassword();
    const user = await prisma.user.create({
      data: {
        id: generateId(),
        email,
        firstName: body.firstName.trim(),
        lastName: body.lastName.trim(),
        role: body.role,
        phone,
        passwordHash: await hashPassword(password),
        mustChangePassword: true,
      },
      select: userSelect,
    });
    recordAuthEvent(req, "USER_CREATED", { userId: user.id, email, detail: `by ${req.user!.id}` });
    // Shown to the admin once; only a hash is kept.
    res.status(201).json({ user, temporaryPassword: password });
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
});

async function activeAdminCount() {
  return prisma.user.count({ where: { role: "ADMIN", active: true } });
}


usersRouter.patch(
  "/:id",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const body = updateUserSchema.parse(req.body);
    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target) throw new HttpError(404, "User not found");

    // Guard rails: an admin can't lock themselves out, and the company can't
    // end up with nobody able to manage accounts.
    const demoting = body.role !== undefined && body.role !== "ADMIN" && target.role === "ADMIN";
    const deactivating = body.active === false && target.active;
    if ((demoting || deactivating) && target.role === "ADMIN" && target.active) {
      if (target.id === req.user!.id) throw new HttpError(400, "You can't remove your own admin access.");
      if ((await activeAdminCount()) <= 1) throw new HttpError(400, "There must be at least one active admin.");
    }

    const data: Record<string, unknown> = {};
    if (body.firstName !== undefined) data.firstName = body.firstName.trim();
    if (body.lastName !== undefined) data.lastName = body.lastName.trim();
    if (body.role !== undefined) data.role = body.role;
    if (body.active !== undefined) data.active = body.active;
    if (body.phone !== undefined) {
      if (body.phone === null || !body.phone.trim()) data.phone = null;
      else {
        const phone = normalizePhone(body.phone);
        if (!phone) throw new HttpError(400, "That phone number doesn't look right. Use a mobile number like 555-123-4567.");
        data.phone = phone;
        // A changed number must be re-verified before codes go to it.
        if (target.mfaMethod === "SMS" && phone !== target.phone) {
          data.mfaMethod = null;
          data.phoneVerifiedAt = null;
          data.mfaEnrolledAt = null;
          data.recoveryCodeHashes = "[]";
        }
      }
    }
    const user = await prisma.user.update({ where: { id: target.id }, data, select: userSelect });
    if (deactivating) {
      await revokeUserSessions(target.id);
      recordAuthEvent(req, "USER_DEACTIVATED", { userId: target.id, email: target.email, detail: `by ${req.user!.id}` });
    }
    if (body.active === true && !target.active) recordAuthEvent(req, "USER_REACTIVATED", { userId: target.id, email: target.email, detail: `by ${req.user!.id}` });
    if (body.role !== undefined && body.role !== target.role) {
      recordAuthEvent(req, "ROLE_CHANGED", { userId: target.id, email: target.email, detail: `${target.role} -> ${body.role}` });
    }
    res.json(user);
  })
);

// "Delete" is a deactivation - the person's history (inspections, signatures)
// stays attached to them.
usersRouter.delete(
  "/:id",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target) throw new HttpError(404, "User not found");
    if (target.id === req.user!.id) throw new HttpError(400, "You can't deactivate your own account.");
    if (target.role === "ADMIN" && target.active && (await activeAdminCount()) <= 1) {
      throw new HttpError(400, "There must be at least one active admin.");
    }
    await prisma.user.update({ where: { id: target.id }, data: { active: false } });
    await revokeUserSessions(target.id);
    recordAuthEvent(req, "USER_DEACTIVATED", { userId: target.id, email: target.email, detail: `by ${req.user!.id}` });
    res.status(204).send();
  })
);

// Permanent removal - only for an account that is already turned off and has
// no work attached (no inspections, appointments, signatures, reports...).
// Anyone with history stays, turned off, so past inspections keep their
// technician. Sign-in records are kept for the audit trail.
usersRouter.delete(
  "/:id/permanent",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const target = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        email: true,
        active: true,
        _count: {
          select: {
            technicianAppointments: true,
            createdAppointments: true,
            technicianInspections: true,
            signaturesAsUser: true,
            generatedReports: true,
            ownedRecommendations: true,
            createdEstimates: true,
            sectionSkips: true,
          },
        },
      },
    });
    if (!target) throw new HttpError(404, "User not found");
    if (target.id === req.user!.id) throw new HttpError(400, "You can't delete your own account.");
    if (target.active) throw new HttpError(400, "Turn off their access first, then delete.");
    const attached = Object.values(target._count).reduce((a, b) => a + b, 0);
    if (attached > 0) {
      throw new HttpError(409, "This person has inspections, appointments or other work on record, so they can't be deleted. Leave them turned off - they can't sign in.");
    }
    await prisma.$transaction([
      prisma.refreshToken.deleteMany({ where: { userId: target.id } }),
      prisma.loginChallenge.deleteMany({ where: { userId: target.id } }),
      prisma.user.delete({ where: { id: target.id } }),
    ]);
    recordAuthEvent(req, "USER_DELETED", { email: target.email, detail: `by ${req.user!.id}` });
    res.status(204).send();
  })
);

usersRouter.post(
  "/:id/reset-password",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target) throw new HttpError(404, "User not found");
    const password = temporaryPassword();
    await prisma.user.update({
      where: { id: target.id },
      data: { passwordHash: await hashPassword(password), mustChangePassword: true, failedLoginCount: 0, lockedUntil: null },
    });
    await revokeUserSessions(target.id);
    recordAuthEvent(req, "ADMIN_PASSWORD_RESET", { userId: target.id, email: target.email, detail: `by ${req.user!.id}` });
    res.json({ temporaryPassword: password });
  })
);

// Lost phone / new phone: clears the second factor so the person enrolls a
// new one at their next sign-in, and ends their current sessions.
usersRouter.post(
  "/:id/reset-mfa",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target) throw new HttpError(404, "User not found");
    await prisma.user.update({
      where: { id: target.id },
      data: { mfaMethod: null, totpSecretEnc: null, totpLastStep: null, phoneVerifiedAt: null, mfaEnrolledAt: null, recoveryCodeHashes: "[]", failedLoginCount: 0, lockedUntil: null },
    });
    await revokeUserSessions(target.id);
    recordAuthEvent(req, "ADMIN_MFA_RESET", { userId: target.id, email: target.email, detail: `by ${req.user!.id}` });
    res.status(204).send();
  })
);

usersRouter.post(
  "/:id/unlock",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target) throw new HttpError(404, "User not found");
    await prisma.user.update({ where: { id: target.id }, data: { failedLoginCount: 0, lockedUntil: null } });
    recordAuthEvent(req, "ADMIN_UNLOCKED", { userId: target.id, email: target.email, detail: `by ${req.user!.id}` });
    res.status(204).send();
  })
);

usersRouter.get(
  "/:id/auth-events",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const events = await prisma.authEvent.findMany({
      where: { userId: req.params.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, type: true, ip: true, userAgent: true, detail: true, createdAt: true },
    });
    res.json(events);
  })
);

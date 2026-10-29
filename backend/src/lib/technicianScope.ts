import type { NextFunction, Request, Response } from "express";
import { prisma } from "./prisma";
import { HttpError } from "../middleware/error-handler";
import { requireAuth } from "../middleware/auth";

// Technicians work their own jobs. Admins and office staff see everything;
// a technician is limited to the inspections assigned to them and what hangs
// off them (findings, checklist, recommendations, signatures, photos, reports,
// follow-ups, estimates), and to their own appointments. Customers and
// properties stay shared on purpose: technicians add and look up clients in
// the field, so those directories are company-wide.
//
// Enforced here, in one place, for every request - the app screens are not
// trusted to hide things.

export const NOT_YOURS = "That job is assigned to someone else.";

// The user id when the caller is a technician (so routes can narrow their
// queries), or null for everyone else.
export function technicianId(req: Request): string | null {
  return req.user?.role === "TECHNICIAN" ? req.user.id : null;
}

// Missing rows are allowed through so the route itself answers 404.
async function inspectionAllowed(userId: string, inspectionId: string | null | undefined): Promise<boolean> {
  if (!inspectionId) return true;
  const row = await prisma.inspection.findUnique({ where: { id: inspectionId }, select: { technicianId: true } });
  return !row || row.technicianId === userId;
}

export async function technicianMayUseInspection(userId: string, inspectionId: string | null | undefined): Promise<boolean> {
  return inspectionAllowed(userId, inspectionId);
}

async function inspectionOf(kind: string, id: string): Promise<string | null> {
  switch (kind) {
    case "finding":
      return (await prisma.finding.findUnique({ where: { id }, select: { inspectionId: true } }))?.inspectionId ?? null;
    case "findingPhoto":
      return (await prisma.findingPhoto.findUnique({ where: { id }, select: { finding: { select: { inspectionId: true } } } }))?.finding.inspectionId ?? null;
    case "checklist":
      return (await prisma.checklistResponse.findUnique({ where: { id }, select: { inspectionId: true } }))?.inspectionId ?? null;
    case "checklistPhoto":
      return (
        (await prisma.checklistResponsePhoto.findUnique({ where: { id }, select: { checklistResponse: { select: { inspectionId: true } } } }))?.checklistResponse
          .inspectionId ?? null
      );
    case "recommendation":
      return (await prisma.recommendation.findUnique({ where: { id }, select: { inspectionId: true } }))?.inspectionId ?? null;
    case "followUp":
      return (await prisma.followUp.findUnique({ where: { id }, select: { inspectionId: true } }))?.inspectionId ?? null;
    case "report":
      return (await prisma.report.findUnique({ where: { id }, select: { inspectionId: true } }))?.inspectionId ?? null;
    default:
      return null;
  }
}

// A technician may open an estimate they wrote or one on their own inspection.
async function estimateAllowed(userId: string, id: string): Promise<boolean> {
  const e = await prisma.estimate.findUnique({ where: { id }, select: { createdByUserId: true, inspection: { select: { technicianId: true } } } });
  return !e || e.createdByUserId === userId || e.inspection?.technicianId === userId;
}

// "photos/<findingId>/x.jpg", "signatures/<inspectionId>/x.png" ... -> allowed?
// Site-plan images and generic uploads belong to the shared property data.
async function fileAllowed(userId: string, key: string): Promise<boolean> {
  const [area, owner] = key.split("/");
  if (!owner) return true;
  switch (area) {
    case "photos":
      return inspectionAllowed(userId, await inspectionOf("finding", owner));
    case "checklist-photos":
      return inspectionAllowed(userId, await inspectionOf("checklist", owner));
    case "signatures":
    case "reports":
      return inspectionAllowed(userId, owner);
    default:
      return true;
  }
}

async function check(req: Request, userId: string): Promise<boolean> {
  const parts = req.path.split("/").filter(Boolean);
  const [area, a, b] = parts;
  const method = req.method;
  switch (area) {
    case "inspections":
      if (!a) {
        if (method === "GET") {
          req.query.technicianId = userId;
          return true;
        }
        if (method === "POST") {
          const wanted = (req.body as { technicianId?: unknown } | undefined)?.technicianId;
          return wanted === undefined || wanted === userId;
        }
        return true;
      }
      return inspectionAllowed(userId, a);
    case "findings":
      return inspectionAllowed(userId, await inspectionOf(a === "photos" ? "findingPhoto" : "finding", a === "photos" ? b : a));
    case "checklist-responses":
      return inspectionAllowed(userId, await inspectionOf(a === "photos" ? "checklistPhoto" : "checklist", a === "photos" ? b : a));
    case "recommendations":
      return a ? inspectionAllowed(userId, await inspectionOf("recommendation", a)) : true;
    case "followups":
      return a ? inspectionAllowed(userId, await inspectionOf("followUp", a)) : true;
    case "reports":
      return a ? inspectionAllowed(userId, await inspectionOf("report", a)) : true;
    case "estimates":
      return a ? estimateAllowed(userId, a) : true;
    case "appointments": {
      if (!a) {
        if (method === "GET") {
          req.query.technicianId = userId;
          return true;
        }
        if (method === "POST") {
          const wanted = (req.body as { technicianId?: unknown } | undefined)?.technicianId;
          return wanted === undefined || wanted === userId;
        }
        return true;
      }
      if (a === "technician") return b === userId;
      const appt = await prisma.appointment.findUnique({ where: { id: a }, select: { technicianId: true } });
      return !appt || appt.technicianId === userId;
    }
    case "media":
      return a === "file" ? fileAllowed(userId, parts.slice(2).join("/")) : true;
    default:
      return true;
  }
}

// Mounted once at /api. Signs the caller in (the routers would do it anyway;
// requireAuth is a no-op the second time) so the role is known, then applies
// the technician rules. Sign-in and public links are left alone.
export function scopeTechnicians(req: Request, res: Response, next: NextFunction) {
  if (req.path.startsWith("/auth") || req.path.startsWith("/public") || req.path === "/health") return next();
  if (!req.headers.authorization?.startsWith("Bearer ")) return next();
  requireAuth(req, res, (err?: unknown) => {
    if (err) return next(err);
    const userId = technicianId(req);
    if (!userId) return next();
    check(req, userId)
      .then((ok) => (ok ? next() : next(new HttpError(403, NOT_YOURS))))
      .catch(next);
  });
}

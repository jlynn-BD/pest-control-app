import type { NextFunction, Request, Response } from "express";
import { prisma } from "./prisma";
import { HttpError } from "../middleware/error-handler";

// Once an inspection is marked completed it is a finished record (the report
// is generated from it) and can no longer be edited. These helpers enforce
// that on the server, so it holds no matter which device or app version sends
// the change.

export const LOCKED_MESSAGE = "This inspection has been completed and can no longer be edited.";

// The subset of these ids whose inspection is already completed.
export async function lockedInspectionIds(ids: string[]): Promise<Set<string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Set();
  const rows = await prisma.inspection.findMany({ where: { id: { in: unique }, status: "COMPLETED" }, select: { id: true } });
  return new Set(rows.map((r) => r.id));
}

async function inspectionIdOf(kind: "finding" | "recommendation" | "checklist" | "findingPhoto" | "checklistPhoto", id: string): Promise<string | null> {
  switch (kind) {
    case "finding":
      return (await prisma.finding.findUnique({ where: { id }, select: { inspectionId: true } }))?.inspectionId ?? null;
    case "recommendation":
      return (await prisma.recommendation.findUnique({ where: { id }, select: { inspectionId: true } }))?.inspectionId ?? null;
    case "checklist":
      return (await prisma.checklistResponse.findUnique({ where: { id }, select: { inspectionId: true } }))?.inspectionId ?? null;
    case "findingPhoto": {
      const p = await prisma.findingPhoto.findUnique({ where: { id }, select: { finding: { select: { inspectionId: true } } } });
      return p?.finding.inspectionId ?? null;
    }
    case "checklistPhoto": {
      const p = await prisma.checklistResponsePhoto.findUnique({ where: { id }, select: { checklistResponse: { select: { inspectionId: true } } } });
      return p?.checklistResponse.inspectionId ?? null;
    }
  }
}

// Express middleware (mounted on /api): refuses writes that would change the
// content of a completed inspection - the inspection itself, its findings,
// recommendations and checklist answers, and removing their photos. Adding
// photos and signatures is deliberately still allowed: a photo taken before
// the inspection was completed can reach the server a moment after it.
export async function blockEditsToCompletedInspections(req: Request, _res: Response, next: NextFunction) {
  try {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
    const parts = req.path.split("/").filter(Boolean);
    let inspectionId: string | null = null;
    if (parts[0] === "inspections" && parts[1]) {
      const sub = parts[2];
      const isWrite = req.method === "PATCH" || req.method === "PUT" || req.method === "DELETE" || req.method === "POST";
      if (!sub && (req.method === "PATCH" || req.method === "PUT" || req.method === "DELETE")) inspectionId = parts[1];
      else if (isWrite && (sub === "findings" || sub === "recommendations" || sub === "checklist-responses")) inspectionId = parts[1];
    } else if (parts[0] === "findings" && parts.length === 2 && (req.method === "PATCH" || req.method === "DELETE")) {
      inspectionId = await inspectionIdOf("finding", parts[1]);
    } else if (parts[0] === "findings" && parts[1] === "photos" && parts[2] && req.method === "DELETE") {
      inspectionId = await inspectionIdOf("findingPhoto", parts[2]);
    } else if (parts[0] === "checklist-responses" && parts[1] === "photos" && parts[2] && req.method === "DELETE") {
      inspectionId = await inspectionIdOf("checklistPhoto", parts[2]);
    } else if (parts[0] === "recommendations" && parts.length === 2 && (req.method === "PATCH" || req.method === "DELETE")) {
      inspectionId = await inspectionIdOf("recommendation", parts[1]);
    }
    if (inspectionId && (await lockedInspectionIds([inspectionId])).has(inspectionId)) {
      throw new HttpError(409, LOCKED_MESSAGE);
    }
    next();
  } catch (err) {
    next(err);
  }
}

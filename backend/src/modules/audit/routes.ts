import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { asyncHandler } from "../../middleware/error-handler";
import { requireAuth, requireRole } from "../../middleware/auth";

// Read-only view of the audit trail. There is deliberately no route that
// edits or deletes entries (and the database refuses it too).
export const auditRouter = Router();
auditRouter.use(requireAuth);

// Which "area" chip maps to which record types.
const AREAS: Record<string, string[]> = {
  inspections: ["Inspection", "ChecklistResponse", "InspectionSectionSkip", "Signature", "FollowUp"],
  findings: ["Finding", "FindingPhoto", "ChecklistResponsePhoto", "Recommendation"],
  customers: ["Customer", "Contact", "Property", "Appointment"],
  reports: ["Report", "Estimate"],
  team: ["User"],
  templates: ["Template", "TemplateSection", "TemplateItem"],
};

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(40),
  cursor: z.string().optional(), // "<ISO createdAt>|<id>" of the last row already seen
  actorId: z.string().optional(),
  area: z.string().optional(),
  entityType: z.string().optional(),
  inspectionId: z.string().optional(),
  customerId: z.string().optional(),
  propertyId: z.string().optional(),
  q: z.string().max(100).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

auditRouter.get(
  "/",
  requireRole("ADMIN", "OFFICE"),
  asyncHandler(async (req, res) => {
    const f = querySchema.parse(req.query);
    const and: Record<string, unknown>[] = [];
    if (f.actorId) and.push({ actorId: f.actorId });
    if (f.entityType) and.push({ entityType: f.entityType });
    if (f.area && AREAS[f.area]) and.push({ entityType: { in: AREAS[f.area] } });
    if (f.inspectionId) and.push({ inspectionId: f.inspectionId });
    if (f.customerId) and.push({ customerId: f.customerId });
    if (f.propertyId) and.push({ propertyId: f.propertyId });
    if (f.from) and.push({ createdAt: { gte: new Date(f.from) } });
    if (f.to) and.push({ createdAt: { lte: new Date(f.to) } });
    if (f.q) {
      and.push({ OR: [{ summary: { contains: f.q, mode: "insensitive" } }, { entityLabel: { contains: f.q, mode: "insensitive" } }, { actorName: { contains: f.q, mode: "insensitive" } }] });
    }
    if (f.cursor) {
      const [iso, id] = f.cursor.split("|");
      const at = new Date(iso);
      if (!Number.isNaN(at.getTime())) and.push({ OR: [{ createdAt: { lt: at } }, { createdAt: at, id: { lt: id ?? "" } }] });
    }
    const rows = await prisma.activityLog.findMany({
      where: and.length ? { AND: and } : undefined,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: f.limit + 1,
    });
    const page = rows.slice(0, f.limit);
    const last = page[page.length - 1];
    res.json({
      items: page,
      nextCursor: rows.length > f.limit && last ? `${last.createdAt.toISOString()}|${last.id}` : null,
    });
  })
);

// Sign-in activity (who signed in, failed attempts, lockouts) - admins only.
auditRouter.get(
  "/sign-ins",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const { limit, cursor } = z.object({ limit: z.coerce.number().int().min(1).max(100).default(40), cursor: z.string().optional() }).parse(req.query);
    // Account-management actions live in the main trail; this list is only
    // about signing in.
    const accountEvents = ["USER_CREATED", "USER_DEACTIVATED", "USER_REACTIVATED", "USER_DELETED", "ROLE_CHANGED", "ADMIN_PASSWORD_RESET", "ADMIN_MFA_RESET", "ADMIN_UNLOCKED"];
    const rows = await prisma.authEvent.findMany({
      where: { type: { notIn: accountEvents }, ...(cursor ? { createdAt: { lt: new Date(cursor) } } : {}) },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
    });
    const page = rows.slice(0, limit);
    res.json({ items: page, nextCursor: rows.length > limit ? page[page.length - 1].createdAt.toISOString() : null });
  })
);

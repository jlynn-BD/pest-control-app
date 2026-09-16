import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { asyncHandler, HttpError } from "../../middleware/error-handler";
import { requireAuth } from "../../middleware/auth";

export const syncRouter = Router();
syncRouter.use(requireAuth);

const changeSchema = z.object({
  entity: z.enum(["Inspection", "Finding", "Recommendation", "ChecklistResponse", "InspectionSectionSkip"]),
  op: z.enum(["create", "update", "delete"]),
  id: z.string(),
  data: z.record(z.string(), z.unknown()).optional(),
  updatedAt: z.string(),
});

type Change = z.infer<typeof changeSchema>;
interface PushResult {
  entity: string;
  id: string;
  result: "applied" | "conflict";
  serverRow?: unknown;
}

const DATE_FIELDS: Record<string, string[]> = {
  Inspection: ["scheduledAt", "startedAt", "completedAt"],
  Finding: [],
  Recommendation: ["deadline"],
  ChecklistResponse: [],
  InspectionSectionSkip: ["confirmedAt"],
};

// Fields the client is allowed to set directly; anything else in `data` is
// dropped rather than trusted verbatim from the request body.
const ALLOWED_FIELDS: Record<string, string[]> = {
  Inspection: [
    "propertyId", "customerId", "templateId", "technicianId", "appointmentId",
    "status", "scheduledAt", "startedAt", "completedAt", "generalNotes", "weatherConditions", "checklistCategories",
  ],
  Finding: [
    "inspectionId", "areaLocation", "locationDetail", "severity", "description", "lat", "lng",
    "floorPlanX", "floorPlanY", "siteMapArrowStartX", "siteMapArrowStartY", "siteMapLevel",
  ],
  Recommendation: [
    "inspectionId", "findingId", "title", "description", "priority", "ownerType",
    "ownerUserId", "ownerContactId", "deadline", "status",
  ],
  ChecklistResponse: ["inspectionId", "templateItemId", "status", "notes"],
  InspectionSectionSkip: ["inspectionId", "category", "technicianId", "initials", "confirmedAt"],
};

function sanitize(entity: string, data: Record<string, unknown>): Record<string, unknown> {
  const allowed = ALLOWED_FIELDS[entity] ?? [];
  const dateFields = DATE_FIELDS[entity] ?? [];
  const out: Record<string, unknown> = {};
  for (const key of allowed) {
    if (!(key in data)) continue;
    const value = data[key];
    if (value === null || value === undefined) {
      out[key] = null;
    } else if (dateFields.includes(key)) {
      out[key] = new Date(value as string);
    } else {
      out[key] = value;
    }
  }
  return out;
}

// The push endpoint dispatches across five structurally different Prisma
// models by allowlisted field name (see ALLOWED_FIELDS/sanitize above), so
// there's no single Prisma-generated type that fits all of them - `any` is
// deliberate here, with correctness enforced by the zod shape check and the
// per-entity field allowlist rather than the compiler.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getModel(entity: string): any {
  switch (entity) {
    case "Inspection":
      return prisma.inspection;
    case "Finding":
      return prisma.finding;
    case "Recommendation":
      return prisma.recommendation;
    case "ChecklistResponse":
      return prisma.checklistResponse;
    case "InspectionSectionSkip":
      return prisma.inspectionSectionSkip;
    default:
      return null;
  }
}

const SUPPORTS_SOFT_DELETE = new Set(["Inspection", "Finding", "Recommendation", "ChecklistResponse"]);
const SUPPORTS_UPDATED_AT = new Set(["Inspection", "Finding", "Recommendation", "ChecklistResponse"]);
// InspectionSectionSkip is immutable once created - an accountability
// record shouldn't be silently overwritten by a later "update," only
// removed (undo) and re-created fresh.

// Entities where a DB-level uniqueness constraint is keyed on something
// other than `id` (see schema.prisma's @@unique). The client always
// generates a fresh row id when it locally recreates an answer - unchecking
// then rechecking a checklist item (soft-deletes the old row, then a brand
// new id for the new one), or undoing then re-confirming a wizard "not
// applicable" sign-off (InspectionSectionSkip has no soft-delete at all, so
// the old row is simply still there). A plain `create` by the new id would
// violate the natural-key constraint against that old row. Falling back to
// a natural-key lookup here mirrors the dedicated REST routes' upsert
// behavior (see checklist/routes.ts's POST handler) instead of 500ing.
const NATURAL_KEY_FIELDS: Record<string, string[]> = {
  ChecklistResponse: ["inspectionId", "templateItemId"],
  InspectionSectionSkip: ["inspectionId", "category"],
};

async function applyChange(change: Change): Promise<PushResult> {
  const model = getModel(change.entity);
  if (!model) throw new HttpError(400, `Unsupported sync entity: ${change.entity}`);

  if (change.op === "delete") {
    if (!SUPPORTS_SOFT_DELETE.has(change.entity)) {
      return { entity: change.entity, id: change.id, result: "applied" };
    }
    await model.updateMany({
      where: { id: change.id },
      data: { deletedAt: new Date() },
    });
    return { entity: change.entity, id: change.id, result: "applied" };
  }

  const data = sanitize(change.entity, change.data ?? {});
  let existing = await model.findUnique({ where: { id: change.id } });

  const naturalKeyFields = NATURAL_KEY_FIELDS[change.entity];
  if (!existing && naturalKeyFields) {
    existing = await model.findFirst({
      where: Object.fromEntries(naturalKeyFields.map((field) => [field, data[field]])),
    });
  }

  if (!existing) {
    await model.create({
      data: { id: change.id, ...data, ...(SUPPORTS_UPDATED_AT.has(change.entity) ? { updatedAt: new Date(change.updatedAt) } : {}) },
    });
    return { entity: change.entity, id: change.id, result: "applied" };
  }

  if (!SUPPORTS_UPDATED_AT.has(change.entity)) {
    // No updatedAt to compare (e.g. InspectionSectionSkip) - treat as
    // immutable once created, UNLESS this is actually a natural-key
    // resurrection/replacement (a fresh sign-off superseding the old one),
    // which does need the new initials/technician/timestamp written.
    if (naturalKeyFields) {
      await model.update({ where: { id: existing.id }, data });
    }
    return { entity: change.entity, id: change.id, result: "applied" };
  }

  const existingUpdatedAt = (existing as { updatedAt: Date }).updatedAt;
  const incomingUpdatedAt = new Date(change.updatedAt);
  // A natural-key match found via the fallback above is, by definition, a
  // soft-deleted row the client no longer knows the id of (its own copy was
  // hard-deleted locally) - always resurrect it rather than running it
  // through last-write-wins, which would compare against a stale
  // updatedAt and could wrongly report a conflict.
  if (incomingUpdatedAt > existingUpdatedAt || (naturalKeyFields && existing.id !== change.id)) {
    await model.update({
      where: { id: existing.id },
      data: { ...data, updatedAt: incomingUpdatedAt, ...(SUPPORTS_SOFT_DELETE.has(change.entity) ? { deletedAt: null } : {}) },
    });
    return { entity: change.entity, id: change.id, result: "applied" };
  }

  return { entity: change.entity, id: change.id, result: "conflict", serverRow: existing };
}

const pushSchema = z.object({ changes: z.array(changeSchema) });

syncRouter.post(
  "/push",
  asyncHandler(async (req, res) => {
    const { changes } = pushSchema.parse(req.body);
    const results: PushResult[] = [];
    // Applied sequentially (not Promise.all) so a Finding created earlier in
    // the same batch is visible to a Recommendation referencing it later.
    for (const change of changes) {
      results.push(await applyChange(change));
    }
    res.json({ results });
  })
);

const ENTITY_QUERIES: Record<string, (since: Date) => Promise<unknown[]>> = {
  Inspection: (since) => prisma.inspection.findMany({ where: { updatedAt: { gt: since } } }),
  Finding: (since) => prisma.finding.findMany({ where: { updatedAt: { gt: since } } }),
  Recommendation: (since) => prisma.recommendation.findMany({ where: { updatedAt: { gt: since } } }),
  ChecklistResponse: (since) => prisma.checklistResponse.findMany({ where: { updatedAt: { gt: since } } }),
  InspectionSectionSkip: (since) => prisma.inspectionSectionSkip.findMany({ where: { createdAt: { gt: since } } }),
};

syncRouter.get(
  "/pull",
  asyncHandler(async (req, res) => {
    const since = typeof req.query.since === "string" ? new Date(req.query.since) : new Date(0);
    const entitiesParam = typeof req.query.entities === "string" ? req.query.entities.split(",") : Object.keys(ENTITY_QUERIES);

    const data: Record<string, unknown[]> = {};
    for (const entity of entitiesParam) {
      const query = ENTITY_QUERIES[entity];
      if (query) data[entity] = await query(since);
    }

    res.json({ data, serverTime: new Date().toISOString() });
  })
);

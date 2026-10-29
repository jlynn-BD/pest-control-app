import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { asyncHandler, HttpError } from "../../middleware/error-handler";
import { requireAuth } from "../../middleware/auth";
import type { Request } from "express";
import { diffRecords, logActivity, snapshot } from "../../lib/audit";
import { ENTITIES, buildSummary } from "../../lib/auditEntities";
import { lockedInspectionIds } from "../../lib/inspectionLock";
import { technicianId, technicianMayUseInspection } from "../../lib/technicianScope";

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
  // "locked": the inspection was already completed, so this change was not
  // saved (serverRow is the inspection's current state, for an Inspection change).
  result: "applied" | "conflict" | "locked";
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
    "floorPlanX", "floorPlanY", "siteMapArrowStartX", "siteMapArrowStartY", "siteMapLevel", "checklistResponseId",
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

// Writes the audit-trail entry for a change that was actually applied. Work
// saved offline reaches the server later, so the device's own timestamp is
// kept alongside the server's (createdAt) as clientTime.
async function auditChange(
  req: Request,
  change: Change,
  kind: "created" | "updated" | "deleted",
  before: Record<string, unknown> | null,
  data: Record<string, unknown>
) {
  const def = ENTITIES[change.entity];
  if (!def) return;
  const merged = { ...(before ?? {}), ...data, id: change.id };
  let details: Record<string, unknown> | null = null;
  let changes: ReturnType<typeof diffRecords> | undefined;
  if (kind === "created") details = { after: snapshot(merged, def.ignore) };
  else if (kind === "deleted") details = { before: snapshot(before, def.ignore) };
  else {
    changes = diffRecords(before, data, def.ignore);
    if (Object.keys(changes).length === 0) return; // retry/resave with no real change
    details = { changes };
  }
  const label = await def.label(merged);
  await logActivity(req, {
    action: `${def.type.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase()}.${kind}`,
    entityType: def.type,
    entityId: change.id,
    label,
    summary: buildSummary(def, kind, label, changes),
    links: await def.links(merged),
    details,
    clientTime: Number.isNaN(Date.parse(change.updatedAt)) ? null : new Date(change.updatedAt),
  });
}

// Which inspection a change belongs to (an Inspection change is about itself;
// the rest carry inspectionId, or - for a delete - it is read off the row).
async function inspectionIdForChange(change: Change): Promise<string | null> {
  if (change.entity === "Inspection") return change.id;
  const fromData = change.data?.inspectionId;
  if (typeof fromData === "string") return fromData;
  const model = getModel(change.entity);
  const row = model ? await model.findUnique({ where: { id: change.id }, select: { inspectionId: true } }) : null;
  return row?.inspectionId ?? null;
}

async function applyChange(req: Request, change: Change, locked: Set<string>, inspectionId: string | null): Promise<PushResult> {
  const model = getModel(change.entity);
  if (!model) throw new HttpError(400, `Unsupported sync entity: ${change.entity}`);

  // A completed inspection is a finished record: nothing about it changes any
  // more. (A retry of a change the server already has is still confirmed, so a
  // lost response doesn't leave the device re-sending it forever.)
  if (inspectionId && locked.has(inspectionId)) {
    const current = await model.findUnique({ where: { id: change.id } });
    const sameStamp =
      current && "updatedAt" in current && new Date(change.updatedAt).getTime() === (current as { updatedAt: Date }).updatedAt.getTime();
    const alreadyGone = change.op === "delete" && current && (current as { deletedAt?: Date | null }).deletedAt;
    if (!sameStamp && !alreadyGone) {
      return { entity: change.entity, id: change.id, result: "locked", serverRow: change.entity === "Inspection" ? current : undefined };
    }
  }

  if (change.op === "delete") {
    if (!SUPPORTS_SOFT_DELETE.has(change.entity)) {
      return { entity: change.entity, id: change.id, result: "applied" };
    }
    const toDelete = await model.findUnique({ where: { id: change.id } });
    await model.updateMany({
      where: { id: change.id },
      data: { deletedAt: new Date() },
    });
    // Only a row that existed and wasn't already deleted is worth recording.
    if (toDelete && !toDelete.deletedAt) await auditChange(req, change, "deleted", toDelete, {});
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
    await auditChange(req, change, "created", null, data);
    return { entity: change.entity, id: change.id, result: "applied" };
  }

  if (!SUPPORTS_UPDATED_AT.has(change.entity)) {
    // No updatedAt to compare (e.g. InspectionSectionSkip) - treat as
    // immutable once created, UNLESS this is actually a natural-key
    // resurrection/replacement (a fresh sign-off superseding the old one),
    // which does need the new initials/technician/timestamp written.
    if (naturalKeyFields) {
      await model.update({ where: { id: existing.id }, data });
      await auditChange(req, change, "updated", existing, data);
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
  // Same timestamp = this exact change already reached the server (the
  // response to an earlier push was lost, so the device is retrying it).
  // Reporting that as a conflict left the row "pending" on the device
  // forever - confirm it instead.
  if (incomingUpdatedAt.getTime() === existingUpdatedAt.getTime() && existing.id === change.id) {
    return { entity: change.entity, id: change.id, result: "applied" };
  }
  if (incomingUpdatedAt > existingUpdatedAt || (naturalKeyFields && existing.id !== change.id)) {
    await model.update({
      where: { id: existing.id },
      data: { ...data, updatedAt: incomingUpdatedAt, ...(SUPPORTS_SOFT_DELETE.has(change.entity) ? { deletedAt: null } : {}) },
    });
    // A row that was deleted and is being brought back counts as new work.
    const revived = Boolean((existing as { deletedAt?: Date | null }).deletedAt);
    await auditChange(req, change, revived ? "created" : "updated", revived ? null : existing, data);
    return { entity: change.entity, id: change.id, result: "applied" };
  }

  return { entity: change.entity, id: change.id, result: "conflict", serverRow: existing };
}

async function technicianMaySync(userId: string, change: Change, inspectionId: string | null): Promise<boolean> {
  // Nobody hands an inspection to someone else through the sync.
  if (change.entity === "Inspection") {
    const wanted = change.data?.technicianId;
    if (typeof wanted === "string" && wanted !== userId) return false;
  }
  return technicianMayUseInspection(userId, inspectionId);
}

const pushSchema = z.object({ changes: z.array(changeSchema) });

syncRouter.post(
  "/push",
  asyncHandler(async (req, res) => {
    const { changes } = pushSchema.parse(req.body);
    const results: PushResult[] = [];
    // Decided once, from how things stand before this batch: an inspection
    // completed earlier is locked, but one being completed by this very batch
    // still takes the rest of its changes (a device that finished offline
    // sends the inspection and everything on it together).
    const inspectionIds = await Promise.all(changes.map((c) => inspectionIdForChange(c)));
    const locked = await lockedInspectionIds(inspectionIds.filter((id): id is string => Boolean(id)));
    // Applied sequentially (not Promise.all) so a Finding created earlier in
    // the same batch is visible to a Recommendation referencing it later.
    const mine = technicianId(req);
    for (let i = 0; i < changes.length; i++) {
      // A technician's changes to someone else's inspection are refused the same
      // way a completed inspection's are ("locked": nothing saved, and the
      // device stops retrying), rather than failing the whole batch for good.
      if (mine && !(await technicianMaySync(mine, changes[i], inspectionIds[i]))) {
        results.push({ entity: changes[i].entity, id: changes[i].id, result: "locked" });
        continue;
      }
      results.push(await applyChange(req, changes[i], locked, inspectionIds[i]));
    }
    res.json({ results });
  })
);

// `mine` is the technician's own id (they only receive their own inspections
// and what hangs off them), or null for admins and office staff.
const ENTITY_QUERIES: Record<string, (since: Date, mine: string | null) => Promise<unknown[]>> = {
  Inspection: (since, mine) => prisma.inspection.findMany({ where: { updatedAt: { gt: since }, ...(mine ? { technicianId: mine } : {}) } }),
  Finding: (since, mine) => prisma.finding.findMany({ where: { updatedAt: { gt: since }, ...(mine ? { inspection: { technicianId: mine } } : {}) } }),
  Recommendation: (since, mine) =>
    prisma.recommendation.findMany({ where: { updatedAt: { gt: since }, ...(mine ? { inspection: { technicianId: mine } } : {}) } }),
  ChecklistResponse: (since, mine) =>
    prisma.checklistResponse.findMany({ where: { updatedAt: { gt: since }, ...(mine ? { inspection: { technicianId: mine } } : {}) } }),
  InspectionSectionSkip: (since, mine) =>
    prisma.inspectionSectionSkip.findMany({ where: { createdAt: { gt: since }, ...(mine ? { inspection: { technicianId: mine } } : {}) } }),
};

syncRouter.get(
  "/pull",
  asyncHandler(async (req, res) => {
    const since = typeof req.query.since === "string" ? new Date(req.query.since) : new Date(0);
    const entitiesParam = typeof req.query.entities === "string" ? req.query.entities.split(",") : Object.keys(ENTITY_QUERIES);

    const data: Record<string, unknown[]> = {};
    for (const entity of entitiesParam) {
      const query = ENTITY_QUERIES[entity];
      if (query) data[entity] = await query(since, technicianId(req));
    }

    res.json({ data, serverTime: new Date().toISOString() });
  })
);

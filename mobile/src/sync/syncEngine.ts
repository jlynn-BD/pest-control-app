import { appendPhotoFile } from "../lib/photoUpload";
import { apiRequest } from "../api/client";
import { getCachedCustomer, getCachedProperty, primeCache } from "../db/cache";
import {
  clearSyncConflict,
  countPendingSyncRows,
  ENTITY_TABLE,
  getPendingChecklistResponses,
  getPendingFindings,
  getPendingInspections,
  getPendingInspectionSectionSkips,
  getPendingRecommendations,
  getUploadableChecklistResponsePhotos,
  getUploadableFindingPhotos,
  getUploadableSignatures,
  markChecklistResponsePhotoSynced,
  markFindingPhotoSynced,
  markSignatureSynced,
  markSynced,
  recordSyncConflict,
} from "../db/inspectionStore";
import type {
  LocalChecklistResponse,
  LocalFinding,
  LocalInspection,
  LocalInspectionSectionSkip,
  LocalRecommendation,
} from "../db/types";

interface SyncChangePayload {
  entity: string;
  op: "create" | "update";
  id: string;
  updatedAt: string;
  data: Record<string, unknown>;
}

interface PushResultItem {
  entity: string;
  id: string;
  result: "applied" | "conflict";
  serverRow?: unknown;
}

function inspectionToChange(i: LocalInspection): SyncChangePayload {
  return {
    entity: "Inspection",
    op: "create",
    id: i.id,
    updatedAt: i.updatedAt,
    data: {
      propertyId: i.propertyId,
      customerId: i.customerId,
      templateId: i.templateId,
      technicianId: i.technicianId,
      status: i.status,
      scheduledAt: i.scheduledAt,
      startedAt: i.startedAt,
      completedAt: i.completedAt,
      generalNotes: i.generalNotes,
      weatherConditions: i.weatherConditions,
      checklistCategories: i.checklistCategories,
    },
  };
}

function findingToChange(f: LocalFinding): SyncChangePayload {
  return {
    entity: "Finding",
    op: "create",
    id: f.id,
    updatedAt: f.updatedAt,
    data: {
      inspectionId: f.inspectionId,
      areaLocation: f.areaLocation,
      locationDetail: f.locationDetail,
      severity: f.severity,
      description: f.description,
      lat: f.lat,
      lng: f.lng,
      floorPlanX: f.floorPlanX,
      floorPlanY: f.floorPlanY,
      siteMapArrowStartX: f.siteMapArrowStartX,
      siteMapArrowStartY: f.siteMapArrowStartY,
      siteMapLevel: f.siteMapLevel,
    },
  };
}

function recommendationToChange(r: LocalRecommendation): SyncChangePayload {
  return {
    entity: "Recommendation",
    op: "create",
    id: r.id,
    updatedAt: r.updatedAt,
    data: {
      inspectionId: r.inspectionId,
      findingId: r.findingId,
      title: r.title,
      description: r.description,
      priority: r.priority,
      ownerType: r.ownerType,
      deadline: r.deadline,
      status: r.status,
    },
  };
}

function checklistResponseToChange(c: LocalChecklistResponse): SyncChangePayload {
  return {
    entity: "ChecklistResponse",
    op: "create",
    id: c.id,
    updatedAt: c.updatedAt,
    data: {
      inspectionId: c.inspectionId,
      templateItemId: c.templateItemId,
      status: c.status,
      notes: c.notes,
    },
  };
}

function sectionSkipToChange(s: LocalInspectionSectionSkip): SyncChangePayload {
  return {
    entity: "InspectionSectionSkip",
    op: "create",
    id: s.id,
    updatedAt: s.createdAt,
    data: {
      inspectionId: s.inspectionId,
      category: s.category,
      technicianId: s.technicianId,
      initials: s.initials,
      confirmedAt: s.confirmedAt,
    },
  };
}

export interface SyncResult {
  pushed: number;
  uploaded: number;
  conflicts: number;
  error: string | null;
}

// A short, human description of the row a push change came from - shown on
// the conflict this device's edit lost, in Settings, instead of a bare
// entity name and id. Best-effort: cache lookups can come back empty (e.g.
// the customer/property hasn't been primed on this device), in which case
// this just falls back to the entity name.
function describeChange(change: SyncChangePayload): string {
  switch (change.entity) {
    case "Inspection": {
      const customer = change.data.customerId ? getCachedCustomer(change.data.customerId as string)?.name : null;
      const address = change.data.propertyId ? getCachedProperty(change.data.propertyId as string)?.addressLine1 : null;
      return [customer, address].filter(Boolean).join(" — ") || "Inspection";
    }
    case "Finding":
      return change.data.areaLocation ? `Finding: ${change.data.areaLocation}` : "Finding";
    case "Recommendation":
      return change.data.title ? `Recommendation: ${change.data.title}` : "Recommendation";
    case "ChecklistResponse":
      return "Checklist answer";
    default:
      return change.entity;
  }
}

// Push order matters: Inspections first (Findings/Recommendations
// reference inspectionId), then Findings (Recommendations may reference
// findingId). The backend applies a batch sequentially for the same
// reason. Media (photos/signatures) uploads only after their parent row is
// confirmed synced, since those endpoints are nested under it.
//
// Only one sync runs at a time: the reconnect/foreground/login triggers and
// the "Sync now" button can all fire together, and two overlapping runs each
// saw the same not-yet-uploaded photo and uploaded it, duplicating it on
// the server. A call made while one is running just waits for that run.
let inFlight: Promise<SyncResult> | null = null;

export function runSync(): Promise<SyncResult> {
  if (!inFlight) {
    inFlight = runSyncOnce().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

async function runSyncOnce(): Promise<SyncResult> {
  let pushed = 0;
  let uploaded = 0;
  let conflicts = 0;
  // One bad photo/signature (too big, corrupt, a server hiccup) must not
  // stop everything queued behind it from syncing - remember the first
  // failure, keep going, and report it at the end. The failed item stays
  // pending and is retried on the next sync.
  let firstMediaError: string | null = null;
  const noteMediaError = (err: unknown) => {
    if (!firstMediaError) firstMediaError = err instanceof Error ? err.message : String(err);
  };

  try {
    const changes: SyncChangePayload[] = [
      ...getPendingInspections().map(inspectionToChange),
      ...getPendingFindings().map(findingToChange),
      ...getPendingRecommendations().map(recommendationToChange),
      ...getPendingChecklistResponses().map(checklistResponseToChange),
      ...getPendingInspectionSectionSkips().map(sectionSkipToChange),
    ];

    if (changes.length > 0) {
      const res = await apiRequest<{ results: PushResultItem[] }>("/api/sync/push", {
        method: "POST",
        body: { changes },
      });
      const changeById = new Map(changes.map((c) => [`${c.entity}:${c.id}`, c]));
      for (const result of res.results) {
        const key = `${result.entity}:${result.id}`;
        if (result.result === "applied") {
          pushed += 1;
          const table = ENTITY_TABLE[result.entity];
          if (table) markSynced(table, result.id);
          // Applied successfully this time - drop any earlier conflict
          // recorded for this same row (e.g. after "Keep my version").
          clearSyncConflict(result.entity, result.id);
        } else {
          conflicts += 1;
          const change = changeById.get(key);
          recordSyncConflict(result.entity, result.id, change ? describeChange(change) : result.entity, result.serverRow);
        }
      }
    }

    for (const photo of getUploadableFindingPhotos()) {
      try {
        const form = new FormData();
        await appendPhotoFile(form, photo.localUri, `photo-${photo.id}.jpg`);
        if (photo.caption) form.append("caption", photo.caption);
        if (photo.lat != null) form.append("lat", String(photo.lat));
        if (photo.lng != null) form.append("lng", String(photo.lng));
        const created = await apiRequest<{ fileUrl: string }>(`/api/findings/${photo.findingId}/photos`, {
          method: "POST",
          body: form,
          isFormData: true,
        });
        markFindingPhotoSynced(photo.id, created.fileUrl);
        uploaded += 1;
      } catch (err) {
        noteMediaError(err);
      }
    }

    for (const photo of getUploadableChecklistResponsePhotos()) {
      try {
        const form = new FormData();
        await appendPhotoFile(form, photo.localUri, `photo-${photo.id}.jpg`);
        if (photo.caption) form.append("caption", photo.caption);
        const created = await apiRequest<{ fileUrl: string }>(`/api/checklist-responses/${photo.checklistResponseId}/photos`, {
          method: "POST",
          body: form,
          isFormData: true,
        });
        markChecklistResponsePhotoSynced(photo.id, created.fileUrl);
        uploaded += 1;
      } catch (err) {
        noteMediaError(err);
      }
    }

    for (const signature of getUploadableSignatures()) {
      try {
        const created = await apiRequest<{ imageUrl: string }>(`/api/inspections/${signature.inspectionId}/signatures`, {
          method: "POST",
          body: { signerType: signature.signerType, signerName: signature.signerName, imageBase64: signature.imageBase64 },
        });
        markSignatureSynced(signature.id, created.imageUrl);
        uploaded += 1;
      } catch (err) {
        noteMediaError(err);
      }
    }

    // Also refreshes reference data, picking up server-side edits made to
    // customers/properties/templates while this device was offline.
    await primeCache();

    return { pushed, uploaded, conflicts, error: firstMediaError };
  } catch (err) {
    return { pushed, uploaded, conflicts, error: err instanceof Error ? err.message : String(err) };
  }
}

export function getPendingSyncCount(): number {
  return countPendingSyncRows();
}

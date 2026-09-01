import { apiRequest } from "../api/client";
import { primeCache } from "../db/cache";
import {
  countPendingSyncRows,
  getPendingChecklistResponses,
  getPendingFindings,
  getPendingInspections,
  getPendingRecommendations,
  getPendingTreatments,
  getUploadableFindingPhotos,
  getUploadableSignatures,
  markFindingPhotoSynced,
  markSignatureSynced,
  markSynced,
} from "../db/inspectionStore";
import type {
  LocalChecklistResponse,
  LocalFinding,
  LocalInspection,
  LocalRecommendation,
  LocalTreatmentProduct,
  LocalTreatmentRecord,
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
      pestTypeId: f.pestTypeId,
      pestTypeOther: f.pestTypeOther,
      areaLocation: f.areaLocation,
      locationDetail: f.locationDetail,
      evidenceTypes: f.evidenceTypes,
      severity: f.severity,
      riskFactors: f.riskFactors,
      entryPoints: f.entryPoints,
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

function treatmentToChanges(t: LocalTreatmentRecord & { products: LocalTreatmentProduct[] }): SyncChangePayload[] {
  const recordChange: SyncChangePayload = {
    entity: "TreatmentRecord",
    op: "create",
    id: t.id,
    updatedAt: t.updatedAt,
    data: {
      inspectionId: t.inspectionId,
      findingId: t.findingId,
      technicianId: t.technicianId,
      method: t.method,
      targetPest: t.targetPest,
      areaTreated: t.areaTreated,
      appliedAt: t.appliedAt,
      safetyInstructions: t.safetyInstructions,
      notes: t.notes,
      approvalStatus: t.approvalStatus,
    },
  };
  const productChanges: SyncChangePayload[] = t.products.map((p) => ({
    entity: "TreatmentProduct",
    op: "create",
    id: p.id,
    updatedAt: t.updatedAt,
    data: {
      treatmentRecordId: p.treatmentRecordId,
      productName: p.productName,
      epaRegistrationNumber: p.epaRegistrationNumber,
      activeIngredient: p.activeIngredient,
      quantity: p.quantity,
      unit: p.unit,
      concentration: p.concentration,
      applicationMethod: p.applicationMethod,
    },
  }));
  return [recordChange, ...productChanges];
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

const TABLE_BY_ENTITY: Record<
  string,
  "inspections" | "findings" | "recommendations" | "treatment_records" | "checklist_responses"
> = {
  Inspection: "inspections",
  Finding: "findings",
  Recommendation: "recommendations",
  TreatmentRecord: "treatment_records",
  ChecklistResponse: "checklist_responses",
};

export interface SyncResult {
  pushed: number;
  uploaded: number;
  conflicts: number;
  error: string | null;
}

// Push order matters: Inspections first (Findings/Recommendations/Treatments
// reference inspectionId), then Findings (Recommendations/Treatments may
// reference findingId). The backend applies a batch sequentially for the
// same reason. Media (photos/signatures) uploads only after their parent
// row is confirmed synced, since those endpoints are nested under it.
export async function runSync(): Promise<SyncResult> {
  let pushed = 0;
  let uploaded = 0;
  let conflicts = 0;

  try {
    const changes: SyncChangePayload[] = [
      ...getPendingInspections().map(inspectionToChange),
      ...getPendingFindings().map(findingToChange),
      ...getPendingRecommendations().map(recommendationToChange),
      ...getPendingTreatments().flatMap(treatmentToChanges),
      ...getPendingChecklistResponses().map(checklistResponseToChange),
    ];

    if (changes.length > 0) {
      const res = await apiRequest<{ results: PushResultItem[] }>("/api/sync/push", {
        method: "POST",
        body: { changes },
      });
      for (const result of res.results) {
        if (result.result === "applied") {
          pushed += 1;
          const table = TABLE_BY_ENTITY[result.entity];
          if (table) markSynced(table, result.id);
        } else {
          conflicts += 1;
        }
      }
    }

    for (const photo of getUploadableFindingPhotos()) {
      const form = new FormData();
      form.append("file", { uri: photo.localUri, name: `photo-${photo.id}.jpg`, type: "image/jpeg" } as unknown as Blob);
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
    }

    for (const signature of getUploadableSignatures()) {
      const created = await apiRequest<{ imageUrl: string }>(`/api/inspections/${signature.inspectionId}/signatures`, {
        method: "POST",
        body: { signerType: signature.signerType, signerName: signature.signerName, imageBase64: signature.imageBase64 },
      });
      markSignatureSynced(signature.id, created.imageUrl);
      uploaded += 1;
    }

    // Also refreshes reference data, picking up server-side edits made to
    // customers/properties/templates/pest types while this device was offline.
    await primeCache();

    return { pushed, uploaded, conflicts, error: null };
  } catch (err) {
    return { pushed, uploaded, conflicts, error: err instanceof Error ? err.message : String(err) };
  }
}

export function getPendingSyncCount(): number {
  return countPendingSyncRows();
}

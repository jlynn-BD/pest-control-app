import { getDb, isLocalDbAvailable } from "./database";
import { generateId } from "../lib/uuid";
import type {
  LocalChecklistResponse,
  LocalFinding,
  LocalFindingPhoto,
  LocalInspection,
  LocalRecommendation,
  LocalSignature,
  LocalTreatmentProduct,
  LocalTreatmentRecord,
} from "./types";

function nowIso(): string {
  return new Date().toISOString();
}

export interface NewInspectionInput {
  propertyId: string;
  customerId: string;
  templateId: string | null;
  technicianId: string;
}

export function createLocalInspection(input: NewInspectionInput): LocalInspection {
  const db = getDb();
  const now = nowIso();
  const inspection: LocalInspection = {
    id: generateId(),
    propertyId: input.propertyId,
    customerId: input.customerId,
    templateId: input.templateId,
    technicianId: input.technicianId,
    status: "IN_PROGRESS",
    scheduledAt: null,
    startedAt: now,
    completedAt: null,
    generalNotes: null,
    weatherConditions: null,
    createdAt: now,
    updatedAt: now,
    syncStatus: "pending",
  };
  db.runSync(
    `INSERT INTO inspections (id, propertyId, customerId, templateId, technicianId, status, scheduledAt, startedAt, completedAt, generalNotes, weatherConditions, createdAt, updatedAt, syncStatus)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      inspection.id,
      inspection.propertyId,
      inspection.customerId,
      inspection.templateId,
      inspection.technicianId,
      inspection.status,
      inspection.scheduledAt,
      inspection.startedAt,
      inspection.completedAt,
      inspection.generalNotes,
      inspection.weatherConditions,
      inspection.createdAt,
      inspection.updatedAt,
      inspection.syncStatus,
    ]
  );
  return inspection;
}

export interface LocalInspectionListItem extends LocalInspection {
  customerName: string;
  propertyAddress: string;
}

export function listLocalInspections(technicianId: string): LocalInspectionListItem[] {
  if (!isLocalDbAvailable()) return [];
  return getDb().getAllSync<LocalInspectionListItem>(
    `SELECT i.*, c.name as customerName, p.addressLine1 as propertyAddress
     FROM inspections i
     LEFT JOIN local_customers c ON c.id = i.customerId
     LEFT JOIN local_properties p ON p.id = i.propertyId
     WHERE i.technicianId = ?
     ORDER BY i.createdAt DESC`,
    [technicianId]
  );
}

export interface LocalInspectionDetail {
  inspection: LocalInspection;
  findings: (LocalFinding & { photos: LocalFindingPhoto[] })[];
  recommendations: LocalRecommendation[];
  treatments: (LocalTreatmentRecord & { products: LocalTreatmentProduct[] })[];
  signatures: LocalSignature[];
  checklistResponses: LocalChecklistResponse[];
}

export function getLocalInspectionDetail(inspectionId: string): LocalInspectionDetail | null {
  if (!isLocalDbAvailable()) return null;
  const db = getDb();
  const inspection = db.getFirstSync<LocalInspection>(`SELECT * FROM inspections WHERE id = ?`, [inspectionId]);
  if (!inspection) return null;

  const findings = db.getAllSync<LocalFinding>(`SELECT * FROM findings WHERE inspectionId = ? ORDER BY createdAt ASC`, [inspectionId]);
  const findingsWithPhotos = findings.map((f) => ({
    ...f,
    photos: db.getAllSync<LocalFindingPhoto>(`SELECT * FROM finding_photos WHERE findingId = ? ORDER BY sortOrder ASC`, [f.id]),
  }));

  const recommendations = db.getAllSync<LocalRecommendation>(
    `SELECT * FROM recommendations WHERE inspectionId = ? ORDER BY createdAt ASC`,
    [inspectionId]
  );

  const treatments = db.getAllSync<LocalTreatmentRecord>(
    `SELECT * FROM treatment_records WHERE inspectionId = ? ORDER BY createdAt ASC`,
    [inspectionId]
  );
  const treatmentsWithProducts = treatments.map((t) => ({
    ...t,
    products: db.getAllSync<LocalTreatmentProduct>(`SELECT * FROM treatment_products WHERE treatmentRecordId = ?`, [t.id]),
  }));

  const signatures = db.getAllSync<LocalSignature>(`SELECT * FROM signatures WHERE inspectionId = ? ORDER BY signedAt ASC`, [
    inspectionId,
  ]);

  const checklistResponses = db.getAllSync<LocalChecklistResponse>(
    `SELECT * FROM checklist_responses WHERE inspectionId = ?`,
    [inspectionId]
  );

  return {
    inspection,
    findings: findingsWithPhotos,
    recommendations,
    treatments: treatmentsWithProducts,
    signatures,
    checklistResponses,
  };
}

export interface NewFindingInput {
  pestTypeId: string | null;
  pestTypeOther: string | null;
  areaLocation: string;
  locationDetail: string | null;
  evidenceTypes: string[];
  severity: string;
  riskFactors: string[];
  entryPoints: string[];
  description: string | null;
  lat: number | null;
  lng: number | null;
  floorPlanX?: number | null;
  floorPlanY?: number | null;
  siteMapArrowStartX?: number | null;
  siteMapArrowStartY?: number | null;
}

export function addLocalFinding(inspectionId: string, input: NewFindingInput): LocalFinding {
  const db = getDb();
  const now = nowIso();
  const finding: LocalFinding = {
    id: generateId(),
    inspectionId,
    pestTypeId: input.pestTypeId,
    pestTypeOther: input.pestTypeOther,
    areaLocation: input.areaLocation,
    locationDetail: input.locationDetail,
    evidenceTypes: JSON.stringify(input.evidenceTypes),
    severity: input.severity,
    riskFactors: JSON.stringify(input.riskFactors),
    entryPoints: JSON.stringify(input.entryPoints),
    description: input.description,
    lat: input.lat,
    lng: input.lng,
    floorPlanX: input.floorPlanX ?? null,
    floorPlanY: input.floorPlanY ?? null,
    siteMapArrowStartX: input.siteMapArrowStartX ?? null,
    siteMapArrowStartY: input.siteMapArrowStartY ?? null,
    createdAt: now,
    updatedAt: now,
    syncStatus: "pending",
  };
  db.runSync(
    `INSERT INTO findings (id, inspectionId, pestTypeId, pestTypeOther, areaLocation, locationDetail, evidenceTypes, severity, riskFactors, entryPoints, description, lat, lng, floorPlanX, floorPlanY, siteMapArrowStartX, siteMapArrowStartY, createdAt, updatedAt, syncStatus)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      finding.id,
      finding.inspectionId,
      finding.pestTypeId,
      finding.pestTypeOther,
      finding.areaLocation,
      finding.locationDetail,
      finding.evidenceTypes,
      finding.severity,
      finding.riskFactors,
      finding.entryPoints,
      finding.description,
      finding.lat,
      finding.lng,
      finding.floorPlanX,
      finding.floorPlanY,
      finding.siteMapArrowStartX,
      finding.siteMapArrowStartY,
      finding.createdAt,
      finding.updatedAt,
      finding.syncStatus,
    ]
  );
  touchInspection(inspectionId);
  return finding;
}

export function addLocalFindingPhoto(
  findingId: string,
  input: { localUri: string; caption: string | null; lat: number | null; lng: number | null; sortOrder: number }
): LocalFindingPhoto {
  const db = getDb();
  const photo: LocalFindingPhoto = {
    id: generateId(),
    findingId,
    localUri: input.localUri,
    remoteUrl: null,
    caption: input.caption,
    takenAt: nowIso(),
    lat: input.lat,
    lng: input.lng,
    sortOrder: input.sortOrder,
    syncStatus: "pending",
  };
  db.runSync(
    `INSERT INTO finding_photos (id, findingId, localUri, remoteUrl, caption, takenAt, lat, lng, sortOrder, syncStatus)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [photo.id, photo.findingId, photo.localUri, photo.remoteUrl, photo.caption, photo.takenAt, photo.lat, photo.lng, photo.sortOrder, photo.syncStatus]
  );
  return photo;
}

export interface NewRecommendationInput {
  findingId: string | null;
  title: string;
  description: string | null;
  priority: string;
  ownerType: string;
  deadline: string | null;
}

export function addLocalRecommendation(inspectionId: string, input: NewRecommendationInput): LocalRecommendation {
  const db = getDb();
  const now = nowIso();
  const recommendation: LocalRecommendation = {
    id: generateId(),
    inspectionId,
    findingId: input.findingId,
    title: input.title,
    description: input.description,
    priority: input.priority,
    ownerType: input.ownerType,
    deadline: input.deadline,
    status: "OPEN",
    createdAt: now,
    updatedAt: now,
    syncStatus: "pending",
  };
  db.runSync(
    `INSERT INTO recommendations (id, inspectionId, findingId, title, description, priority, ownerType, deadline, status, createdAt, updatedAt, syncStatus)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      recommendation.id,
      recommendation.inspectionId,
      recommendation.findingId,
      recommendation.title,
      recommendation.description,
      recommendation.priority,
      recommendation.ownerType,
      recommendation.deadline,
      recommendation.status,
      recommendation.createdAt,
      recommendation.updatedAt,
      recommendation.syncStatus,
    ]
  );
  touchInspection(inspectionId);
  return recommendation;
}

export interface NewTreatmentInput {
  findingId: string | null;
  technicianId: string;
  method: string;
  targetPest: string | null;
  areaTreated: string | null;
  appliedAt: string;
  safetyInstructions: string | null;
  notes: string | null;
  products: Array<{
    productName: string;
    epaRegistrationNumber: string | null;
    activeIngredient: string | null;
    quantity: number;
    unit: string;
    concentration: string | null;
    applicationMethod: string | null;
  }>;
}

export function addLocalTreatment(inspectionId: string, input: NewTreatmentInput): LocalTreatmentRecord {
  const db = getDb();
  const now = nowIso();
  const treatment: LocalTreatmentRecord = {
    id: generateId(),
    inspectionId,
    findingId: input.findingId,
    technicianId: input.technicianId,
    method: input.method,
    targetPest: input.targetPest,
    areaTreated: input.areaTreated,
    appliedAt: input.appliedAt,
    safetyInstructions: input.safetyInstructions,
    notes: input.notes,
    approvalStatus: "PENDING",
    createdAt: now,
    updatedAt: now,
    syncStatus: "pending",
  };
  db.withTransactionSync(() => {
    db.runSync(
      `INSERT INTO treatment_records (id, inspectionId, findingId, technicianId, method, targetPest, areaTreated, appliedAt, safetyInstructions, notes, approvalStatus, createdAt, updatedAt, syncStatus)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        treatment.id,
        treatment.inspectionId,
        treatment.findingId,
        treatment.technicianId,
        treatment.method,
        treatment.targetPest,
        treatment.areaTreated,
        treatment.appliedAt,
        treatment.safetyInstructions,
        treatment.notes,
        treatment.approvalStatus,
        treatment.createdAt,
        treatment.updatedAt,
        treatment.syncStatus,
      ]
    );
    for (const p of input.products) {
      db.runSync(
        `INSERT INTO treatment_products (id, treatmentRecordId, productName, epaRegistrationNumber, activeIngredient, quantity, unit, concentration, applicationMethod)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [generateId(), treatment.id, p.productName, p.epaRegistrationNumber, p.activeIngredient, p.quantity, p.unit, p.concentration, p.applicationMethod]
      );
    }
  });
  touchInspection(inspectionId);
  return treatment;
}

export function addLocalSignature(
  inspectionId: string,
  input: { signerType: string; signerName: string; imageBase64: string }
): LocalSignature {
  const db = getDb();
  const signature: LocalSignature = {
    id: generateId(),
    inspectionId,
    signerType: input.signerType,
    signerName: input.signerName,
    imageBase64: input.imageBase64,
    remoteUrl: null,
    signedAt: nowIso(),
    syncStatus: "pending",
  };
  db.runSync(
    `INSERT INTO signatures (id, inspectionId, signerType, signerName, imageBase64, remoteUrl, signedAt, syncStatus) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [signature.id, signature.inspectionId, signature.signerType, signature.signerName, signature.imageBase64, signature.remoteUrl, signature.signedAt, signature.syncStatus]
  );
  touchInspection(inspectionId);
  return signature;
}

// One response per (inspection, templateItem) - finds the existing local row
// for that pair and updates it in place (keeping its id) rather than
// inserting a new one, so re-answering a checklist item doesn't create
// duplicates or fight the server's matching unique constraint on sync.
export function upsertLocalChecklistResponse(
  inspectionId: string,
  templateItemId: string,
  status: string,
  notes: string | null
): LocalChecklistResponse {
  const db = getDb();
  const now = nowIso();
  const existing = db.getFirstSync<LocalChecklistResponse>(
    `SELECT * FROM checklist_responses WHERE inspectionId = ? AND templateItemId = ?`,
    [inspectionId, templateItemId]
  );

  if (existing) {
    db.runSync(`UPDATE checklist_responses SET status = ?, notes = ?, updatedAt = ?, syncStatus = 'pending' WHERE id = ?`, [
      status,
      notes,
      now,
      existing.id,
    ]);
    touchInspection(inspectionId);
    return { ...existing, status, notes, updatedAt: now, syncStatus: "pending" };
  }

  const response: LocalChecklistResponse = {
    id: generateId(),
    inspectionId,
    templateItemId,
    status,
    notes,
    createdAt: now,
    updatedAt: now,
    syncStatus: "pending",
  };
  db.runSync(
    `INSERT INTO checklist_responses (id, inspectionId, templateItemId, status, notes, createdAt, updatedAt, syncStatus)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [response.id, response.inspectionId, response.templateItemId, response.status, response.notes, response.createdAt, response.updatedAt, response.syncStatus]
  );
  touchInspection(inspectionId);
  return response;
}

export function completeLocalInspection(inspectionId: string): void {
  const db = getDb();
  const now = nowIso();
  db.runSync(`UPDATE inspections SET status = 'COMPLETED', completedAt = ?, updatedAt = ? WHERE id = ?`, [now, now, inspectionId]);
}

// Adding a child record after the inspection itself was already synced
// (e.g. syncing mid-inspection, then adding more findings) must re-flag it
// so the next sync run picks up the new updatedAt - otherwise it stays
// filtered out of getPendingInspections() forever.
function touchInspection(inspectionId: string): void {
  getDb().runSync(`UPDATE inspections SET updatedAt = ?, syncStatus = 'pending' WHERE id = ?`, [nowIso(), inspectionId]);
}

// --- Sync support -----------------------------------------------------
// Pending rows for the "pure data" entities the generic /api/sync/push
// endpoint handles (LWW by updatedAt). Media (photos/signatures) is synced
// separately via their dedicated upload endpoints - see below.

export function getPendingInspections(): LocalInspection[] {
  if (!isLocalDbAvailable()) return [];
  return getDb().getAllSync<LocalInspection>(`SELECT * FROM inspections WHERE syncStatus = 'pending'`);
}
export function getPendingFindings(): LocalFinding[] {
  if (!isLocalDbAvailable()) return [];
  return getDb().getAllSync<LocalFinding>(`SELECT * FROM findings WHERE syncStatus = 'pending'`);
}
export function getPendingRecommendations(): LocalRecommendation[] {
  if (!isLocalDbAvailable()) return [];
  return getDb().getAllSync<LocalRecommendation>(`SELECT * FROM recommendations WHERE syncStatus = 'pending'`);
}
export function getPendingTreatments(): (LocalTreatmentRecord & { products: LocalTreatmentProduct[] })[] {
  if (!isLocalDbAvailable()) return [];
  const db = getDb();
  const treatments = db.getAllSync<LocalTreatmentRecord>(`SELECT * FROM treatment_records WHERE syncStatus = 'pending'`);
  return treatments.map((t) => ({
    ...t,
    products: db.getAllSync<LocalTreatmentProduct>(`SELECT * FROM treatment_products WHERE treatmentRecordId = ?`, [t.id]),
  }));
}

export function getPendingChecklistResponses(): LocalChecklistResponse[] {
  if (!isLocalDbAvailable()) return [];
  return getDb().getAllSync<LocalChecklistResponse>(`SELECT * FROM checklist_responses WHERE syncStatus = 'pending'`);
}

export function markSynced(
  table: "inspections" | "findings" | "recommendations" | "treatment_records" | "checklist_responses",
  id: string
): void {
  getDb().runSync(`UPDATE ${table} SET syncStatus = 'synced' WHERE id = ?`, [id]);
}

// Findings must exist server-side (synced) before their photos can be
// uploaded, since the upload endpoint is nested under /findings/:id/photos.
export function getUploadableFindingPhotos(): (LocalFindingPhoto & { findingSyncStatus: string })[] {
  if (!isLocalDbAvailable()) return [];
  return getDb().getAllSync<LocalFindingPhoto & { findingSyncStatus: string }>(
    `SELECT p.*, f.syncStatus as findingSyncStatus
     FROM finding_photos p
     JOIN findings f ON f.id = p.findingId
     WHERE p.syncStatus = 'pending' AND f.syncStatus = 'synced'`
  );
}
export function markFindingPhotoSynced(id: string, remoteUrl: string): void {
  getDb().runSync(`UPDATE finding_photos SET syncStatus = 'synced', remoteUrl = ? WHERE id = ?`, [remoteUrl, id]);
}

// Signatures likewise need their parent inspection to exist server-side first.
export function getUploadableSignatures(): (LocalSignature & { inspectionSyncStatus: string })[] {
  if (!isLocalDbAvailable()) return [];
  return getDb().getAllSync<LocalSignature & { inspectionSyncStatus: string }>(
    `SELECT s.*, i.syncStatus as inspectionSyncStatus
     FROM signatures s
     JOIN inspections i ON i.id = s.inspectionId
     WHERE s.syncStatus = 'pending' AND i.syncStatus = 'synced'`
  );
}
export function markSignatureSynced(id: string, remoteUrl: string): void {
  getDb().runSync(`UPDATE signatures SET syncStatus = 'synced', remoteUrl = ? WHERE id = ?`, [remoteUrl, id]);
}

export function countPendingSyncRows(): number {
  if (!isLocalDbAvailable()) return 0;
  const db = getDb();
  const tables = ["inspections", "findings", "recommendations", "treatment_records", "finding_photos", "signatures", "checklist_responses"];
  return tables.reduce((sum, table) => {
    const row = db.getFirstSync<{ count: number }>(`SELECT COUNT(*) as count FROM ${table} WHERE syncStatus = 'pending'`);
    return sum + (row?.count ?? 0);
  }, 0);
}

import { getDb, isLocalDbAvailable } from "./database";
import { generateId } from "../lib/uuid";
import type {
  LocalChecklistResponse,
  LocalChecklistResponsePhoto,
  LocalFinding,
  LocalFindingPhoto,
  LocalInspection,
  LocalInspectionSectionSkip,
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
    checklistCategories: null,
    createdAt: now,
    updatedAt: now,
    syncStatus: "pending",
  };
  db.runSync(
    `INSERT INTO inspections (id, propertyId, customerId, templateId, technicianId, status, scheduledAt, startedAt, completedAt, generalNotes, weatherConditions, checklistCategories, createdAt, updatedAt, syncStatus)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      inspection.checklistCategories,
      inspection.createdAt,
      inspection.updatedAt,
      inspection.syncStatus,
    ]
  );
  return inspection;
}

// Hard delete, same reasoning as deleteLocalFinding - the caller also fires
// a best-effort remote delete (api/inspections.ts's deleteInspection) since
// removing the local row here forfeits any further chance to sync it. Used
// to discard a stray/duplicate in-progress inspection (e.g. one left behind
// by a sync that never completed) - there's no cascade in this schema, so
// every child table needs its own DELETE.
export function deleteLocalInspection(id: string): void {
  const db = getDb();
  db.runSync(`DELETE FROM finding_photos WHERE findingId IN (SELECT id FROM findings WHERE inspectionId = ?)`, [id]);
  db.runSync(`DELETE FROM findings WHERE inspectionId = ?`, [id]);
  db.runSync(`DELETE FROM recommendations WHERE inspectionId = ?`, [id]);
  db.runSync(
    `DELETE FROM treatment_products WHERE treatmentRecordId IN (SELECT id FROM treatment_records WHERE inspectionId = ?)`,
    [id]
  );
  db.runSync(`DELETE FROM treatment_records WHERE inspectionId = ?`, [id]);
  db.runSync(`DELETE FROM signatures WHERE inspectionId = ?`, [id]);
  db.runSync(
    `DELETE FROM checklist_response_photos WHERE checklistResponseId IN (SELECT id FROM checklist_responses WHERE inspectionId = ?)`,
    [id]
  );
  db.runSync(`DELETE FROM checklist_responses WHERE inspectionId = ?`, [id]);
  db.runSync(`DELETE FROM inspection_section_skips WHERE inspectionId = ?`, [id]);
  db.runSync(`DELETE FROM inspections WHERE id = ?`, [id]);
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
  checklistResponses: (LocalChecklistResponse & { photos: LocalChecklistResponsePhoto[] })[];
  sectionSkips: LocalInspectionSectionSkip[];
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
  const checklistResponsesWithPhotos = checklistResponses.map((r) => ({
    ...r,
    photos: db.getAllSync<LocalChecklistResponsePhoto>(
      `SELECT * FROM checklist_response_photos WHERE checklistResponseId = ? ORDER BY sortOrder ASC`,
      [r.id]
    ),
  }));

  const sectionSkips = db.getAllSync<LocalInspectionSectionSkip>(
    `SELECT * FROM inspection_section_skips WHERE inspectionId = ?`,
    [inspectionId]
  );

  return {
    inspection,
    findings: findingsWithPhotos,
    recommendations,
    treatments: treatmentsWithProducts,
    signatures,
    checklistResponses: checklistResponsesWithPhotos,
    sectionSkips,
  };
}

export interface NewFindingInput {
  areaLocation: string;
  locationDetail: string | null;
  severity: string;
  description: string | null;
  lat: number | null;
  lng: number | null;
  floorPlanX?: number | null;
  floorPlanY?: number | null;
  siteMapArrowStartX?: number | null;
  siteMapArrowStartY?: number | null;
  siteMapLevel?: string | null;
}

export function addLocalFinding(inspectionId: string, input: NewFindingInput): LocalFinding {
  const db = getDb();
  const now = nowIso();
  const finding: LocalFinding = {
    id: generateId(),
    inspectionId,
    areaLocation: input.areaLocation,
    locationDetail: input.locationDetail,
    severity: input.severity,
    description: input.description,
    lat: input.lat,
    lng: input.lng,
    floorPlanX: input.floorPlanX ?? null,
    floorPlanY: input.floorPlanY ?? null,
    siteMapArrowStartX: input.siteMapArrowStartX ?? null,
    siteMapArrowStartY: input.siteMapArrowStartY ?? null,
    siteMapLevel: input.siteMapLevel ?? null,
    createdAt: now,
    updatedAt: now,
    syncStatus: "pending",
  };
  db.runSync(
    `INSERT INTO findings (id, inspectionId, areaLocation, locationDetail, severity, description, lat, lng, floorPlanX, floorPlanY, siteMapArrowStartX, siteMapArrowStartY, siteMapLevel, createdAt, updatedAt, syncStatus)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      finding.id,
      finding.inspectionId,
      finding.areaLocation,
      finding.locationDetail,
      finding.severity,
      finding.description,
      finding.lat,
      finding.lng,
      finding.floorPlanX,
      finding.floorPlanY,
      finding.siteMapArrowStartX,
      finding.siteMapArrowStartY,
      finding.siteMapLevel,
      finding.createdAt,
      finding.updatedAt,
      finding.syncStatus,
    ]
  );
  touchInspection(inspectionId);
  return finding;
}

// Partial update - only fields present in `input` are changed, so callers
// like the site-map marker edit flow (which only touches location/severity)
// don't need to round-trip every other field. Bumping updatedAt + flipping
// syncStatus back to 'pending' is what gets the edit picked up by the next
// sync push (same last-write-wins path a brand-new finding already goes
// through - see syncEngine's findingToChange).
export function updateLocalFinding(id: string, input: Partial<NewFindingInput>): void {
  const db = getDb();
  const existing = db.getFirstSync<LocalFinding>(`SELECT * FROM findings WHERE id = ?`, [id]);
  if (!existing) return;
  const merged: LocalFinding = {
    ...existing,
    ...(input.areaLocation !== undefined ? { areaLocation: input.areaLocation } : {}),
    ...(input.locationDetail !== undefined ? { locationDetail: input.locationDetail } : {}),
    ...(input.severity !== undefined ? { severity: input.severity } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.lat !== undefined ? { lat: input.lat } : {}),
    ...(input.lng !== undefined ? { lng: input.lng } : {}),
    ...(input.floorPlanX !== undefined ? { floorPlanX: input.floorPlanX } : {}),
    ...(input.floorPlanY !== undefined ? { floorPlanY: input.floorPlanY } : {}),
    ...(input.siteMapArrowStartX !== undefined ? { siteMapArrowStartX: input.siteMapArrowStartX } : {}),
    ...(input.siteMapArrowStartY !== undefined ? { siteMapArrowStartY: input.siteMapArrowStartY } : {}),
    ...(input.siteMapLevel !== undefined ? { siteMapLevel: input.siteMapLevel } : {}),
    updatedAt: nowIso(),
    syncStatus: "pending",
  };
  db.runSync(
    `UPDATE findings SET areaLocation = ?, locationDetail = ?, severity = ?, description = ?, lat = ?, lng = ?, floorPlanX = ?, floorPlanY = ?, siteMapArrowStartX = ?, siteMapArrowStartY = ?, siteMapLevel = ?, updatedAt = ?, syncStatus = 'pending'
     WHERE id = ?`,
    [
      merged.areaLocation,
      merged.locationDetail,
      merged.severity,
      merged.description,
      merged.lat,
      merged.lng,
      merged.floorPlanX,
      merged.floorPlanY,
      merged.siteMapArrowStartX,
      merged.siteMapArrowStartY,
      merged.siteMapLevel,
      merged.updatedAt,
      id,
    ]
  );
  touchInspection(merged.inspectionId);
}

// Hard delete, mirroring deleteLocalChecklistResponse - the caller is
// responsible for also firing a best-effort remote delete (see
// api/inspections.ts's deleteFinding) since removing the local row here
// forfeits any further chance to sync it.
export function deleteLocalFinding(id: string): void {
  const db = getDb();
  db.runSync(`DELETE FROM finding_photos WHERE findingId = ?`, [id]);
  db.runSync(`DELETE FROM findings WHERE id = ?`, [id]);
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

export function addLocalChecklistResponsePhoto(
  checklistResponseId: string,
  input: { localUri: string; caption: string | null; sortOrder: number }
): LocalChecklistResponsePhoto {
  const db = getDb();
  const photo: LocalChecklistResponsePhoto = {
    id: generateId(),
    checklistResponseId,
    localUri: input.localUri,
    remoteUrl: null,
    caption: input.caption,
    takenAt: nowIso(),
    sortOrder: input.sortOrder,
    syncStatus: "pending",
  };
  db.runSync(
    `INSERT INTO checklist_response_photos (id, checklistResponseId, localUri, remoteUrl, caption, takenAt, sortOrder, syncStatus)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [photo.id, photo.checklistResponseId, photo.localUri, photo.remoteUrl, photo.caption, photo.takenAt, photo.sortOrder, photo.syncStatus]
  );
  return photo;
}

// Lets a technician attach or detach a checklist template on an
// already-started inspection, not just at creation time (NewInspectionScreen).
// Detaching only hides the checklist section - it doesn't delete any
// checklist_responses rows, so re-attaching the same template later restores
// the technician's prior answers instead of losing them. Which categories
// are relevant is no longer a per-inspection opt-in list (see the mandatory
// checklist wizard, shared/src/constants/checklistWizard.ts) - it's derived
// from the template's sections crossed with the property's applicability.
export function setLocalInspectionTemplate(inspectionId: string, templateId: string | null): void {
  getDb().runSync(`UPDATE inspections SET templateId = ?, updatedAt = ?, syncStatus = 'pending' WHERE id = ?`, [
    templateId,
    nowIso(),
    inspectionId,
  ]);
}

// Hard delete - unlike other entities, checklist responses have no
// syncStatus="pending-delete" tombstone path (the generic sync engine only
// pushes create/update). The caller is responsible for also firing a
// best-effort remote delete since removing the local row here forfeits any
// further chance to sync it.
export function deleteLocalChecklistResponse(id: string): void {
  const db = getDb();
  // Cascades to photos too - unchecking already silently discards notes
  // (they live on this same row), so dropping photo evidence along with it
  // is consistent rather than leaving orphaned local rows nothing can ever
  // surface or sync (their JOIN in getUploadableChecklistResponsePhotos
  // requires this parent row to exist).
  db.runSync(`DELETE FROM checklist_response_photos WHERE checklistResponseId = ?`, [id]);
  db.runSync(`DELETE FROM checklist_responses WHERE id = ?`, [id]);
}

// Matt's accountability ask: creates the technician's personal sign-off
// that THIS inspection found a conditional area not present - separate from
// (and required in addition to) the property-level applicability flag,
// which only pre-fills the wizard's suggestion text on future visits. One
// per (inspection, category) - re-confirming replaces the prior row instead
// of accumulating duplicates, since only one technician can be doing this
// inspection's walkthrough at a time.
export function createLocalInspectionSectionSkip(
  inspectionId: string,
  category: string,
  technicianId: string,
  initials: string
): LocalInspectionSectionSkip {
  const db = getDb();
  const now = nowIso();
  db.runSync(`DELETE FROM inspection_section_skips WHERE inspectionId = ? AND category = ?`, [inspectionId, category]);
  const skip: LocalInspectionSectionSkip = {
    id: generateId(),
    inspectionId,
    category,
    technicianId,
    initials,
    confirmedAt: now,
    createdAt: now,
    syncStatus: "pending",
  };
  db.runSync(
    `INSERT INTO inspection_section_skips (id, inspectionId, category, technicianId, initials, confirmedAt, createdAt, syncStatus)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [skip.id, skip.inspectionId, skip.category, skip.technicianId, skip.initials, skip.confirmedAt, skip.createdAt, skip.syncStatus]
  );
  touchInspection(inspectionId);
  return skip;
}

// Undoing a "not applicable" answer removes this inspection's sign-off
// entirely (matching updateLocalPropertyApplicability's undo, which resets
// the property flag rather than leaving a stale record) - the technician is
// asserting the area does exist after all, so there's nothing left to attest.
export function deleteLocalInspectionSectionSkip(inspectionId: string, category: string): void {
  getDb().runSync(`DELETE FROM inspection_section_skips WHERE inspectionId = ? AND category = ?`, [inspectionId, category]);
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

export function getPendingInspectionSectionSkips(): LocalInspectionSectionSkip[] {
  if (!isLocalDbAvailable()) return [];
  return getDb().getAllSync<LocalInspectionSectionSkip>(`SELECT * FROM inspection_section_skips WHERE syncStatus = 'pending'`);
}

export function markSynced(
  table: "inspections" | "findings" | "recommendations" | "treatment_records" | "checklist_responses" | "inspection_section_skips",
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

// Checklist responses must exist server-side (synced) before their photos
// can be uploaded, since the upload endpoint is nested under
// /checklist-responses/:id/photos.
export function getUploadableChecklistResponsePhotos(): (LocalChecklistResponsePhoto & { responseSyncStatus: string })[] {
  if (!isLocalDbAvailable()) return [];
  return getDb().getAllSync<LocalChecklistResponsePhoto & { responseSyncStatus: string }>(
    `SELECT p.*, r.syncStatus as responseSyncStatus
     FROM checklist_response_photos p
     JOIN checklist_responses r ON r.id = p.checklistResponseId
     WHERE p.syncStatus = 'pending' AND r.syncStatus = 'synced'`
  );
}
export function markChecklistResponsePhotoSynced(id: string, remoteUrl: string): void {
  getDb().runSync(`UPDATE checklist_response_photos SET syncStatus = 'synced', remoteUrl = ? WHERE id = ?`, [remoteUrl, id]);
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
  const tables = [
    "inspections",
    "findings",
    "recommendations",
    "treatment_records",
    "finding_photos",
    "signatures",
    "checklist_responses",
    "checklist_response_photos",
    "inspection_section_skips",
  ];
  return tables.reduce((sum, table) => {
    const row = db.getFirstSync<{ count: number }>(`SELECT COUNT(*) as count FROM ${table} WHERE syncStatus = 'pending'`);
    return sum + (row?.count ?? 0);
  }, 0);
}

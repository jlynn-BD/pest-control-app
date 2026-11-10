import {
  CarriedIssue,
  CarriedIssues,
  parseCarriedIssues,
} from "@pest-app/shared";
import { deleteFinding, deleteRecommendation, getInspection } from "../api/inspections";
import {
  addLocalFinding,
  createLocalInspection,
  deleteLocalFinding,
  getLocalInspectionDetail,
} from "../db/inspectionStore";
import type { LocalInspection } from "../db/types";

// Follow-up inspections: start a new inspection from a completed one at the
// same property so the technician doesn't begin from scratch. See
// shared/src/constants/followUp.ts for what is carried over and how it is stored.

interface SourceFinding extends CarriedIssue {
  id: string;
  checklistResponseId?: string | null;
}

interface Source {
  id: string;
  status: string;
  propertyId: string;
  customerId: string;
  templateId: string | null;
  completedAt: string | null;
  responses: { id: string; templateItemId: string; status: string; notes: string | null }[];
  findings: SourceFinding[];
}

const toIssue = (f: SourceFinding): CarriedIssue => ({
  areaLocation: f.areaLocation,
  locationDetail: f.locationDetail ?? null,
  severity: f.severity,
  description: f.description ?? null,
  floorPlanX: f.floorPlanX ?? null,
  floorPlanY: f.floorPlanY ?? null,
  siteMapArrowStartX: f.siteMapArrowStartX ?? null,
  siteMapArrowStartY: f.siteMapArrowStartY ?? null,
  siteMapLevel: f.siteMapLevel ?? null,
});

// This device's copy when it has one (it may be newer than the server's),
// otherwise the server's - which needs a connection.
async function loadSource(inspectionId: string): Promise<Source> {
  const local = getLocalInspectionDetail(inspectionId);
  if (local) {
    return {
      id: local.inspection.id,
      status: local.inspection.status,
      propertyId: local.inspection.propertyId,
      customerId: local.inspection.customerId,
      templateId: local.inspection.templateId,
      completedAt: local.inspection.completedAt,
      responses: local.checklistResponses.map((r) => ({ id: r.id, templateItemId: r.templateItemId, status: r.status, notes: r.notes })),
      findings: local.findings,
    };
  }
  const remote = await getInspection(inspectionId);
  return {
    id: remote.id,
    status: remote.status,
    propertyId: remote.propertyId,
    customerId: remote.customerId,
    templateId: remote.templateId ?? null,
    completedAt: remote.completedAt ? String(remote.completedAt) : null,
    responses: remote.checklistResponses.map((r) => ({ id: r.id, templateItemId: r.templateItemId, status: r.status, notes: r.notes ?? null })),
    findings: remote.findings,
  };
}

export function buildCarriedIssues(source: Source): CarriedIssues {
  const byResponseId = new Map(source.responses.map((r) => [r.id, r]));
  const carried: CarriedIssues = {
    v: 1,
    sourceInspectionId: source.id,
    sourceDate: source.completedAt,
    responses: {},
    issuesByItem: {},
    standalone: [],
  };
  for (const r of source.responses) carried.responses[r.templateItemId] = { status: r.status, notes: r.notes };
  for (const f of source.findings) {
    const response = f.checklistResponseId ? byResponseId.get(f.checklistResponseId) : undefined;
    if (response && response.status === "NEEDS_ATTENTION") {
      (carried.issuesByItem[response.templateItemId] ??= []).push(toIssue(f));
    }
    // A finding that isn't under a checklist item isn't carried over: the
    // technician can open the previous inspection to see it.
  }
  return carried;
}

// Creates the follow-up on this device (it syncs like any new inspection).
// Needs a completed source; loads it from the server when this device doesn't
// have it, so that part needs a connection.
export async function createFollowUpInspection(sourceInspectionId: string, technicianId: string): Promise<LocalInspection> {
  const source = await loadSource(sourceInspectionId);
  if (source.status !== "COMPLETED") throw new Error("Only a completed inspection can be followed up.");
  return createLocalInspection({
    propertyId: source.propertyId,
    customerId: source.customerId,
    templateId: source.templateId,
    technicianId,
    basedOnInspectionId: source.id,
    carriedIssues: JSON.stringify(buildCarriedIssues(source)),
  });
}

function newFindingFrom(inspectionId: string, issue: CarriedIssue, checklistResponseId: string | null) {
  return addLocalFinding(inspectionId, {
    areaLocation: issue.areaLocation,
    locationDetail: issue.locationDetail ?? null,
    severity: issue.severity,
    description: issue.description ?? null,
    lat: null,
    lng: null,
    floorPlanX: issue.floorPlanX ?? null,
    floorPlanY: issue.floorPlanY ?? null,
    siteMapArrowStartX: issue.siteMapArrowStartX ?? null,
    siteMapArrowStartY: issue.siteMapArrowStartY ?? null,
    siteMapLevel: issue.siteMapLevel ?? null,
    checklistResponseId,
  });
}

function removeFinding(findingId: string) {
  const { recommendationId } = deleteLocalFinding(findingId);
  deleteFinding(findingId).catch(() => {});
  if (recommendationId) deleteRecommendation(recommendationId).catch(() => {});
}

export function getCarriedIssues(inspectionId: string): CarriedIssues | null {
  return parseCarriedIssues(getLocalInspectionDetail(inspectionId)?.inspection.carriedIssues);
}

// "This issue is still present" on a checklist item: the issues recorded last
// time for it are copied in (to edit, add photos to, or remove the ones that
// were fixed). Does nothing when the item already has issues.
export function copyCarriedItemIssues(inspectionId: string, templateItemId: string, responseId: string): void {
  const detail = getLocalInspectionDetail(inspectionId);
  const carried = parseCarriedIssues(detail?.inspection.carriedIssues);
  if (!detail || !carried) return;
  if (detail.findings.some((f) => f.checklistResponseId === responseId)) return;
  for (const issue of carried.issuesByItem[templateItemId] ?? []) newFindingFrom(inspectionId, issue, responseId);
}

// "This issue has been resolved" (or clearing the answer): no issues are left
// on that checklist item.
export function removeItemFindings(inspectionId: string, responseId: string): void {
  const detail = getLocalInspectionDetail(inspectionId);
  for (const f of detail?.findings ?? []) if (f.checklistResponseId === responseId) removeFinding(f.id);
}

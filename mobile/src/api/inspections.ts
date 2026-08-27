import type {
  ChecklistResponse,
  Customer,
  Finding,
  FindingPhoto,
  Inspection,
  InspectionTemplate,
  Property,
  Recommendation,
  Signature,
  TemplateItem,
  TemplateSection,
  TreatmentProduct,
  TreatmentRecord,
} from "@pest-app/shared";
import { apiRequest } from "./client";

export type InspectionSummary = Inspection & {
  property: Property;
  customer: Customer;
  technician: { id: string; firstName: string; lastName: string };
};

export type InspectionDetail = InspectionSummary & {
  findings: (Finding & { photos: FindingPhoto[] })[];
  recommendations: Recommendation[];
  treatmentRecords: (TreatmentRecord & { products: TreatmentProduct[] })[];
  signatures: Signature[];
  report: { id: string; pdfUrl: string } | null;
  template: (InspectionTemplate & { sections: (TemplateSection & { items: TemplateItem[] })[] }) | null;
  checklistResponses: ChecklistResponse[];
};

export function listInspections(params?: { technicianId?: string; status?: string }): Promise<InspectionSummary[]> {
  const search = new URLSearchParams(params as Record<string, string>).toString();
  return apiRequest(`/api/inspections${search ? `?${search}` : ""}`);
}

export function getInspection(id: string): Promise<InspectionDetail> {
  return apiRequest(`/api/inspections/${id}`);
}

export function createInspection(input: {
  propertyId: string;
  customerId: string;
  technicianId: string;
  templateId?: string;
  status?: string;
}): Promise<Inspection> {
  return apiRequest("/api/inspections", { method: "POST", body: input });
}

// Best-effort immediate delete (unchecking a checklist item) - not routed
// through the generic sync engine since that only supports create/update.
// If offline, the local delete still applies; the server-side row is cleaned
// up next time this runs while online.
export function deleteChecklistResponse(inspectionId: string, responseId: string): Promise<void> {
  return apiRequest(`/api/inspections/${inspectionId}/checklist-responses/${responseId}`, { method: "DELETE" });
}

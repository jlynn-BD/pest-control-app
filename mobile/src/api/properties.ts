import type { Inspection, Property, RawSketch } from "@pest-app/shared";
import { apiRequest } from "./client";
import { appendPhotoFile } from "../lib/photoUpload";

export type ServiceHistoryEntry = Inspection & {
  technician: { id: string; firstName: string; lastName: string };
  findings: unknown[];
  report: { id: string } | null;
};

export type PropertyWithCustomer = Property & { customer: { id: string; name: string } };

export function getProperty(id: string): Promise<PropertyWithCustomer> {
  return apiRequest<PropertyWithCustomer>(`/api/properties/${id}`);
}

export interface CreatePropertyInput {
  customerId: string;
  label?: string;
  addressLine1: string;
  city: string;
  state: string;
  postalCode: string;
  country?: string;
  propertyType: "RESIDENTIAL_SINGLE" | "RESIDENTIAL_MULTI" | "COMMERCIAL" | "INDUSTRIAL" | "OTHER";
  accessNotes?: string;
  notes?: string;
}

export function createProperty(input: CreatePropertyInput): Promise<Property> {
  return apiRequest<Property>("/api/properties", { method: "POST", body: input });
}

// Only works for a property with no inspections or bookings on record.
export function deleteProperty(id: string): Promise<void> {
  return apiRequest<void>(`/api/properties/${id}`, { method: "DELETE" });
}

export function getPropertyServiceHistory(id: string): Promise<ServiceHistoryEntry[]> {
  return apiRequest(`/api/properties/${id}/inspections`);
}

export async function uploadSiteMap(propertyId: string, imageUri: string): Promise<Property> {
  const form = new FormData();
  // In a browser the file has to be attached as real bytes; the phone-app
  // style { uri } object is sent as the text "[object Object]", which the
  // server reports as "No file uploaded".
  await appendPhotoFile(form, imageUri, `site-map-${propertyId}.jpg`);
  return apiRequest<Property>(`/api/properties/${propertyId}/site-map`, { method: "POST", body: form, isFormData: true });
}

export function deleteSiteMap(propertyId: string): Promise<void> {
  return apiRequest<void>(`/api/properties/${propertyId}/site-map`, { method: "DELETE" });
}

export function saveSiteMapSketch(propertyId: string, sketch: RawSketch): Promise<Property> {
  return apiRequest<Property>(`/api/properties/${propertyId}/site-map-sketch`, { method: "PATCH", body: sketch });
}

export interface PropertyApplicabilityPatch {
  hasSecondFloor?: boolean | null;
  hasThirdFloor?: boolean | null;
  hasBasement?: boolean | null;
  hasCrawlspace?: boolean | null;
  hasAttic?: boolean | null;
}

// Best-effort remote write for the checklist wizard's "this property
// doesn't have this" answers - the caller writes to local cache first
// (updateLocalPropertyApplicability) and fires this without blocking the
// wizard, same reasoning as ChecklistPanel's deleteChecklistResponse: the
// wizard has to keep working in the field without connectivity.
export function patchPropertyApplicability(propertyId: string, patch: PropertyApplicabilityPatch): Promise<Property> {
  return apiRequest<Property>(`/api/properties/${propertyId}`, { method: "PATCH", body: patch });
}

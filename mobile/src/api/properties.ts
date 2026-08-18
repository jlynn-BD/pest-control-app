import type { Inspection, Property, SiteMapSketch } from "@pest-app/shared";
import { apiRequest } from "./client";

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

export function getPropertyServiceHistory(id: string): Promise<ServiceHistoryEntry[]> {
  return apiRequest(`/api/properties/${id}/inspections`);
}

export function uploadSiteMap(propertyId: string, imageUri: string): Promise<Property> {
  const form = new FormData();
  form.append("file", { uri: imageUri, name: `site-map-${propertyId}.jpg`, type: "image/jpeg" } as unknown as Blob);
  return apiRequest<Property>(`/api/properties/${propertyId}/site-map`, { method: "POST", body: form, isFormData: true });
}

export function saveSiteMapSketch(propertyId: string, sketch: SiteMapSketch): Promise<Property> {
  return apiRequest<Property>(`/api/properties/${propertyId}/site-map-sketch`, { method: "PATCH", body: sketch });
}

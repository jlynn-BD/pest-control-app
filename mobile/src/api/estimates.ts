import type { Estimate, EstimateLineItem } from "@pest-app/shared";
import { apiRequest } from "./client";

export type EstimateSummary = Estimate & {
  lineItems: EstimateLineItem[];
  customer: { id: string; name: string };
  property: { id: string; addressLine1: string; city: string; state: string; postalCode: string };
  createdBy: { id: string; firstName: string; lastName: string };
};

export interface LineItemInput {
  description: string;
  quantity: number;
  unitPrice: number;
}

export interface CreateEstimateInput {
  customerId: string;
  propertyId: string;
  inspectionId?: string | null;
  taxRate?: number;
  notes?: string | null;
  validUntil?: string | null;
  lineItems: LineItemInput[];
}

export interface UpdateEstimateInput {
  status?: string;
  taxRate?: number;
  notes?: string | null;
  validUntil?: string | null;
  lineItems?: LineItemInput[];
}

export function listEstimates(params?: { customerId?: string; propertyId?: string; status?: string }): Promise<EstimateSummary[]> {
  const search = new URLSearchParams(params as Record<string, string>).toString();
  return apiRequest(`/api/estimates${search ? `?${search}` : ""}`);
}

export function getEstimate(id: string): Promise<EstimateSummary> {
  return apiRequest(`/api/estimates/${id}`);
}

export function createEstimate(input: CreateEstimateInput): Promise<EstimateSummary> {
  return apiRequest("/api/estimates", { method: "POST", body: input });
}

export function updateEstimate(id: string, input: UpdateEstimateInput): Promise<EstimateSummary> {
  return apiRequest(`/api/estimates/${id}`, { method: "PATCH", body: input });
}

export function draftEstimateFromInspection(inspectionId: string): Promise<EstimateSummary> {
  return apiRequest(`/api/inspections/${inspectionId}/estimate-draft`, { method: "POST" });
}

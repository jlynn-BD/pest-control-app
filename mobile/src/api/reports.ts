import type { Report } from "@pest-app/shared";
import { apiRequest } from "./client";

export function generateReport(inspectionId: string): Promise<Report> {
  return apiRequest(`/api/inspections/${inspectionId}/report/generate`, { method: "POST" });
}

export function getReport(inspectionId: string): Promise<Report> {
  return apiRequest(`/api/inspections/${inspectionId}/report`);
}

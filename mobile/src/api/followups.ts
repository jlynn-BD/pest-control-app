import type { FollowUp, Inspection, Property, Customer } from "@pest-app/shared";
import { apiRequest } from "./client";

export type FollowUpWithInspection = FollowUp & {
  inspection: Inspection & { property: Property; customer: Customer };
};

export type FollowUpDetail = FollowUp & {
  inspection: Inspection & { property: Property; customer: Customer };
  followUpInspection: Inspection | null;
};

export function listUpcomingFollowUps(): Promise<FollowUpWithInspection[]> {
  return apiRequest("/api/followups?upcoming=true");
}

export function getFollowUp(id: string): Promise<FollowUpDetail> {
  return apiRequest(`/api/followups/${id}`);
}

export interface ScheduleFollowUpInput {
  reason?: string;
  scheduledDate?: string;
}

export function scheduleFollowUp(inspectionId: string, input: ScheduleFollowUpInput): Promise<FollowUp> {
  return apiRequest(`/api/inspections/${inspectionId}/followups`, { method: "POST", body: input });
}

export interface UpdateFollowUpInput {
  correctiveActionStatus?: "PENDING" | "VERIFIED" | "FAILED" | "NOT_APPLICABLE";
  status?: "SCHEDULED" | "COMPLETED" | "CANCELED";
  notes?: string;
}

export function updateFollowUp(id: string, input: UpdateFollowUpInput): Promise<FollowUp> {
  return apiRequest(`/api/followups/${id}`, { method: "PATCH", body: input });
}

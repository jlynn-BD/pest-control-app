import { apiRequest } from "./client";

export interface ActivityEntry {
  id: string;
  createdAt: string;
  actorId: string | null;
  actorName: string;
  actorRole: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  entityLabel: string | null;
  summary: string;
  inspectionId: string | null;
  customerId: string | null;
  propertyId: string | null;
  details: {
    changes?: Record<string, { from: unknown; to: unknown }>;
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
    sketch?: Record<string, unknown>;
  } | null;
  clientTime: string | null;
  ip: string | null;
  userAgent: string | null;
}

export interface SignInEvent {
  id: string;
  createdAt: string;
  email: string | null;
  type: string;
  ip: string | null;
  userAgent: string | null;
  detail: string | null;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface ActivityFilters {
  actorId?: string;
  area?: string;
  inspectionId?: string;
  customerId?: string;
  propertyId?: string;
  q?: string;
  cursor?: string | null;
}

export function fetchActivity(filters: ActivityFilters): Promise<Page<ActivityEntry>> {
  const params = new URLSearchParams({ limit: "40" });
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
  return apiRequest<Page<ActivityEntry>>(`/api/audit?${params.toString()}`);
}

export function fetchSignIns(cursor?: string | null): Promise<Page<SignInEvent>> {
  const params = new URLSearchParams({ limit: "40" });
  if (cursor) params.set("cursor", cursor);
  return apiRequest<Page<SignInEvent>>(`/api/audit/sign-ins?${params.toString()}`);
}

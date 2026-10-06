import type { User } from "@pest-app/shared";
import { apiRequest } from "./client";

export type Role = "ADMIN" | "OFFICE" | "TECHNICIAN";

export function listUsers(): Promise<User[]> {
  return apiRequest<User[]>("/api/users");
}

export function createUser(input: { email: string; firstName: string; lastName: string; role: Role; phone?: string }) {
  return apiRequest<{ user: User; temporaryPassword: string }>("/api/users", { method: "POST", body: input });
}

export function updateUser(id: string, patch: { role?: Role; active?: boolean; phone?: string | null; firstName?: string; lastName?: string }) {
  return apiRequest<User>(`/api/users/${id}`, { method: "PATCH", body: patch });
}

export function resetUserPassword(id: string) {
  return apiRequest<{ temporaryPassword: string }>(`/api/users/${id}/reset-password`, { method: "POST" });
}

export function resetUserMfa(id: string) {
  return apiRequest<void>(`/api/users/${id}/reset-mfa`, { method: "POST" });
}

export function unlockUser(id: string) {
  return apiRequest<void>(`/api/users/${id}/unlock`, { method: "POST" });
}

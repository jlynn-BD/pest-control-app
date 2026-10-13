import type { Appointment, Customer, Property } from "@pest-app/shared";
import { apiRequest } from "./client";

export type AppointmentWithRelations = Appointment & { property: Property; customer: Customer };

export function getTechnicianSchedule(technicianId: string, date: string): Promise<AppointmentWithRelations[]> {
  return apiRequest(`/api/appointments/technician/${technicianId}/schedule?date=${date}`);
}

export type AppointmentType = "INITIAL_INSPECTION" | "FOLLOWUP_INSPECTION" | "TREATMENT" | "OTHER";

export type ScheduledAppointment = AppointmentWithRelations & {
  technician?: { id: string; firstName: string; lastName: string };
};

// Everything on the calendar between two moments (the whole month on screen).
// Technicians pass their own id; admins and office staff leave it out to see
// everyone's.
export function listAppointments(params: { technicianId?: string; from: string; to: string }): Promise<ScheduledAppointment[]> {
  const q = new URLSearchParams({ from: params.from, to: params.to });
  if (params.technicianId) q.set("technicianId", params.technicianId);
  return apiRequest(`/api/appointments?${q.toString()}`);
}

export interface CreateAppointmentInput {
  propertyId: string;
  customerId: string;
  technicianId: string;
  type: AppointmentType;
  scheduledStart: string; // ISO date-time
  notes?: string;
}

export function createAppointment(input: CreateAppointmentInput): Promise<Appointment> {
  return apiRequest<Appointment>("/api/appointments", { method: "POST", body: input });
}

export function cancelAppointment(id: string): Promise<Appointment> {
  return apiRequest<Appointment>(`/api/appointments/${id}`, { method: "PATCH", body: { status: "CANCELED" } });
}

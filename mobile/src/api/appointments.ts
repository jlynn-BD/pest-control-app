import type { Appointment, Customer, Property } from "@pest-app/shared";
import { apiRequest } from "./client";

export type AppointmentWithRelations = Appointment & { property: Property; customer: Customer };

export function getTechnicianSchedule(technicianId: string, date: string): Promise<AppointmentWithRelations[]> {
  return apiRequest(`/api/appointments/technician/${technicianId}/schedule?date=${date}`);
}

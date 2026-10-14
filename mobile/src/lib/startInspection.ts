import { listInspections } from "../api/inspections";
import { markAppointmentInProgress } from "../api/appointments";
import { getCachedProperty, primeCache } from "../db/cache";
import { getSyncMeta, setSyncMeta } from "../db/database";
import { createLocalInspection, getLocalInspectionDetail, listLocalInspections } from "../db/inspectionStore";
import { ensureLocalInspection } from "./resumeInspection";

// A booking that has become an inspection is remembered here so the Schedule
// stops offering "Start inspection" for it (the inspection itself shows on the
// calendar instead). Kept on the device so it works offline too; the booking's
// status is also set to IN_PROGRESS on the server so other devices agree.
const key = (appointmentId: string) => `apptInspection:${appointmentId}`;

export function inspectionForAppointment(appointmentId: string): string | null {
  return getSyncMeta(key(appointmentId));
}

// Starts (or resumes) the inspection for a booked client in one step: no
// property list, no template question (a checklist can be added from the
// inspection). Returns the inspection to open.
export async function startInspectionFromAppointment(
  appointment: { id: string; propertyId: string; customerId: string; scheduledStart: string | Date },
  technicianId: string
): Promise<string> {
  // Already started from this booking.
  const linked = inspectionForAppointment(appointment.id);
  if (linked && getLocalInspectionDetail(linked)) return linked;

  // Never start a second inspection where one is already open at this property.
  let existingId = listLocalInspections(technicianId).find((i) => i.propertyId === appointment.propertyId && i.status !== "COMPLETED")?.id ?? null;
  if (!existingId) {
    try {
      const open = await listInspections({ technicianId, status: "IN_PROGRESS" });
      existingId = open.find((r) => r.propertyId === appointment.propertyId)?.id ?? null;
    } catch {
      // offline - the on-device check above is all there is
    }
  }
  if (existingId) {
    await ensureLocalInspection(existingId);
    setSyncMeta(key(appointment.id), existingId);
    markAppointmentInProgress(appointment.id).catch(() => {});
    return existingId;
  }

  // A client added moments ago may not be on this device yet.
  let property = getCachedProperty(appointment.propertyId);
  if (!property) {
    await primeCache().catch(() => {});
    property = getCachedProperty(appointment.propertyId);
  }
  if (!property) throw new Error("This client's address isn't on this device yet. Connect to the internet and try again.");

  const inspection = createLocalInspection({
    propertyId: property.id,
    customerId: property.customerId,
    templateId: null,
    technicianId,
    scheduledAt: new Date(appointment.scheduledStart).toISOString(),
  });
  setSyncMeta(key(appointment.id), inspection.id);
  markAppointmentInProgress(appointment.id).catch(() => {});
  return inspection.id;
}

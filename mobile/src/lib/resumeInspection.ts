import { getInspection } from "../api/inspections";
import { getLocalInspectionDetail, hydrateLocalInspectionFromRemote } from "../db/inspectionStore";

// An in-progress inspection that only exists on the server (started on
// another device, or this device's copy was cleared) has to be loaded into
// local storage before the editable workspace can open it. A no-op when the
// device already has it - that copy may hold newer edits.
export async function ensureLocalInspection(inspectionId: string): Promise<void> {
  if (getLocalInspectionDetail(inspectionId)) return;
  hydrateLocalInspectionFromRemote(await getInspection(inspectionId));
}

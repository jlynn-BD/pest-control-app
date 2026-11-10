import { ensureLocalInspection } from "./resumeInspection";
import { getLocalInspectionDetail } from "../db/inspectionStore";

// Opens an inspection from anywhere (the home screen, a property's history):
//   - unfinished -> the editable workspace, so it can be continued
//   - finished   -> the read-only summary (report, signatures, share)
// This device's own copy wins when there is one (it may hold newer edits);
// an unfinished inspection that only exists on the server (started on another
// device) is downloaded first.
// Works from any stack: it goes through the tab navigator above.
export async function openInspection(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  navigation: any,
  inspection: { id: string; status: string }
): Promise<void> {
  const root = navigation.getParent?.() ?? navigation;
  const local = getLocalInspectionDetail(inspection.id);
  const status = local?.inspection.status ?? inspection.status;
  const go = (screen: string) => root.navigate("Inspections", { screen, params: { inspectionId: inspection.id } });
  if (status !== "COMPLETED") {
    if (!local) await ensureLocalInspection(inspection.id);
    go("InspectionWorkspace");
  } else {
    go(local ? "LocalInspectionDetail" : "InspectionDetail");
  }
}

// Starts (or continues) an inspection at a property: opens the New Inspection
// screen with that property already chosen.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function startInspectionAt(navigation: any, propertyId: string): void {
  const root = navigation.getParent?.() ?? navigation;
  root.navigate("Inspections", { screen: "NewInspection", params: { propertyId } });
}

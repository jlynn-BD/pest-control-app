import { useFocusEffect } from "@react-navigation/native";
import { useCallback } from "react";
import { getLocalInspectionDetail } from "../db/inspectionStore";

// The first two steps of every inspection are fixed: pick the property, then
// measure and map it - findings and photos need an accurate place on the
// diagram. Until the technician confirms the property is measured, the
// checklist, findings and photos are closed: a screen that records any of them
// calls this, and sends the person back to the inspection page, where the
// "Measure & map the property" step is waiting. After that, every section is
// open in any order.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useMeasuredLock(inspectionId: string | undefined, navigation: any): void {
  useFocusEffect(
    useCallback(() => {
      if (!inspectionId) return;
      const d = getLocalInspectionDetail(inspectionId);
      if (d && d.inspection.status !== "COMPLETED" && !d.inspection.measuredAt) navigation.replace("InspectionWorkspace", { inspectionId });
    }, [inspectionId, navigation])
  );
}

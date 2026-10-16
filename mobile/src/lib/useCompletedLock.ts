import { useFocusEffect } from "@react-navigation/native";
import { useCallback } from "react";
import { getLocalInspectionDetail } from "../db/inspectionStore";

// A completed inspection is a finished record and can't be edited. Every
// screen that edits one calls this: if the inspection is completed (finished
// here, or already finished when the screen was opened), the screen is
// replaced by the read-only inspection page.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useCompletedLock(inspectionId: string | undefined, navigation: any): void {
  useFocusEffect(
    useCallback(() => {
      if (!inspectionId) return;
      const d = getLocalInspectionDetail(inspectionId);
      if (d?.inspection.status === "COMPLETED") navigation.replace("LocalInspectionDetail", { inspectionId });
    }, [inspectionId, navigation])
  );
}

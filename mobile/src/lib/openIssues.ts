import type { LocalInspectionDetail } from "../db/inspectionStore";

// Checklist items answered "Issues" where nothing says what the issue is or where
// it is - no issue added through "Add to site map", and no older note or photo.
// These are not finished: the inspector marked a problem without recording it.
// `itemIds` narrows the count to one checklist step.
export function countOpenIssues(detail: LocalInspectionDetail | null, itemIds?: Set<string>): number {
  if (!detail) return 0;
  return detail.checklistResponses.filter(
    (r) =>
      r.status === "NEEDS_ATTENTION" &&
      (!itemIds || itemIds.has(r.templateItemId)) &&
      !(r.notes && r.notes.trim()) &&
      r.photos.length === 0 &&
      !detail.findings.some((f) => f.checklistResponseId === r.id)
  ).length;
}

import { RecommendationPriority, Severity } from "../enums";

export * from "./checklistWizard";

// Findings describe evidence, entry points, and risk factors as guidance
// text for the Notes field rather than structured pickers - Matt's ask, see
// FindingEditorForm.tsx's guidance line above the notes box. This constant
// is what that line is built from, so the two stay in sync.
export const FINDING_NOTES_GUIDANCE =
  "Describe the issue and include, when applicable: evidence observed, potential entry points, risk factors, condition of the area, and recommended corrective action.";

// Matt's ask: a finding automatically becomes its recommendation - no
// second manual entry of the same area/notes/severity (see
// db/inspectionStore.ts's upsertRecommendationFromFinding on mobile). A
// finding's severity is the only field that needs remapping onto the
// recommendation's own priority scale; everything else copies verbatim.
const SEVERITY_TO_RECOMMENDATION_PRIORITY: Record<string, string> = {
  [Severity.LOW]: RecommendationPriority.LOW,
  [Severity.MEDIUM]: RecommendationPriority.MEDIUM,
  [Severity.HIGH]: RecommendationPriority.HIGH,
  [Severity.CRITICAL]: RecommendationPriority.URGENT,
};

export function severityToRecommendationPriority(severity: string): string {
  return SEVERITY_TO_RECOMMENDATION_PRIORITY[severity] ?? RecommendationPriority.MEDIUM;
}

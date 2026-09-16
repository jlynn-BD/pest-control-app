export * from "./checklistWizard";

// Findings describe evidence, entry points, and risk factors as guidance
// text for the Notes field rather than structured pickers - Matt's ask, see
// FindingEditorForm.tsx's guidance line above the notes box. This constant
// is what that line is built from, so the two stay in sync.
export const FINDING_NOTES_GUIDANCE =
  "Describe the issue and include, when applicable: evidence observed, potential entry points, risk factors, condition of the area, and recommended corrective action.";

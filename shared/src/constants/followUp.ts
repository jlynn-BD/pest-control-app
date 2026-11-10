// A follow-up inspection starts from an earlier, completed one at the same
// property, so a technician who is going back doesn't start from scratch.
// What it carries over is stored on the new inspection (Inspection.carriedIssues,
// JSON text) and is read-only context except for the "still present / resolved"
// answers:
//
//   - for every checklist item that had an issue last time, the technician says
//     "this issue is still present" (the item is answered Needs attention and the
//     earlier issues are copied forward to edit) or "this issue has been resolved"
//     (the item is answered No visible issues). That answer lives in the normal
//     checklist response, so nothing new is needed to store it.
//   - for every other earlier issue (one added straight from "Add finding" or the
//     site map, not under a checklist item) the same two choices are stored here.
//   - what each item was last time, so every row can say "Last time: ...".

export type CarriedDecision = "STILL_PRESENT" | "RESOLVED";

export interface CarriedIssue {
  areaLocation: string;
  locationDetail?: string | null;
  severity: string;
  description?: string | null;
  floorPlanX?: number | null;
  floorPlanY?: number | null;
  siteMapArrowStartX?: number | null;
  siteMapArrowStartY?: number | null;
  siteMapLevel?: string | null;
}

export interface CarriedStandaloneIssue extends CarriedIssue {
  id: string;
  decision: CarriedDecision | null;
  // The finding created in the new inspection when "still present" was chosen.
  newFindingId?: string | null;
}

export interface CarriedIssues {
  v: 1;
  sourceInspectionId: string;
  sourceDate: string | null;
  // templateItemId -> how that item was answered last time
  responses: Record<string, { status: string; notes: string | null }>;
  // templateItemId -> the issues (findings) that were raised from it
  issuesByItem: Record<string, CarriedIssue[]>;
  standalone: CarriedStandaloneIssue[];
}

export function parseCarriedIssues(raw: string | null | undefined): CarriedIssues | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<CarriedIssues>;
    if (!parsed || parsed.v !== 1 || typeof parsed.sourceInspectionId !== "string") return null;
    return {
      v: 1,
      sourceInspectionId: parsed.sourceInspectionId,
      sourceDate: parsed.sourceDate ?? null,
      responses: parsed.responses ?? {},
      issuesByItem: parsed.issuesByItem ?? {},
      standalone: parsed.standalone ?? [],
    };
  } catch {
    return null;
  }
}

// Checklist items that had an issue last time (these get the two checkboxes).
export function carriedIssueItemIds(c: CarriedIssues): string[] {
  return Object.keys(c.responses).filter((id) => c.responses[id].status === "NEEDS_ATTENTION");
}

// Earlier issues outside the checklist that have not been answered yet.
export function undecidedStandaloneCount(c: CarriedIssues | null): number {
  return c ? c.standalone.filter((s) => s.decision === null).length : 0;
}

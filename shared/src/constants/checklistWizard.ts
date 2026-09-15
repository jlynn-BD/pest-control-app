import type { TemplateSectionCategory } from "../enums";

// The mandatory inspection wizard's step order - every technician walks
// these in this exact sequence, every time (Matt's ask: inspection quality
// shouldn't depend on which sections an individual technician feels like
// checking). EXTERIOR/FIRST_FLOOR/ATTIC are required and can never be
// skipped; the rest are conditional and can only be bypassed by an
// explicit "this property doesn't have this" answer (see
// `applicabilityField`, which names the Property boolean that answer is
// stored on - see getWizardStepStatus below for how that combines with
// per-item responses into a single resolved/unresolved state per step).
export type WizardStepCategory = Exclude<TemplateSectionCategory, "OTHER">;
export type PropertyApplicabilityField = "hasSecondFloor" | "hasThirdFloor" | "hasBasement" | "hasCrawlspace";

export interface WizardStepDefinition {
  category: WizardStepCategory;
  label: string;
  shortLabel: string;
  required: boolean;
  applicabilityField?: PropertyApplicabilityField;
}

export const WIZARD_STEPS: WizardStepDefinition[] = [
  { category: "EXTERIOR", label: "Exterior Inspection Checklist", shortLabel: "Exterior", required: true },
  { category: "FIRST_FLOOR", label: "First Floor Inspection Checklist", shortLabel: "1st Floor", required: true },
  { category: "SECOND_FLOOR", label: "Second Floor Inspection Checklist", shortLabel: "2nd Floor", required: false, applicabilityField: "hasSecondFloor" },
  { category: "THIRD_FLOOR", label: "Third Floor Inspection Checklist", shortLabel: "3rd Floor", required: false, applicabilityField: "hasThirdFloor" },
  { category: "BASEMENT", label: "Basement Inspection Checklist", shortLabel: "Basement", required: false, applicabilityField: "hasBasement" },
  { category: "CRAWLSPACE", label: "Crawl Space Inspection Checklist", shortLabel: "Crawl Space", required: false, applicabilityField: "hasCrawlspace" },
  { category: "ATTIC", label: "Attic Inspection Checklist", shortLabel: "Attic", required: true },
];

// Single source of truth for category display metadata - previously
// duplicated by hand across mobile/lib/checklist.ts, ChecklistPanel.tsx,
// and the backend report generator, which is exactly how INTERIOR ended up
// needing six independent updates instead of one.
export const CHECKLIST_CATEGORY_LABEL: Record<string, string> = {
  ...Object.fromEntries(WIZARD_STEPS.map((s) => [s.category, s.label])),
  OTHER: "Additional Checklist Items",
};
export const CHECKLIST_CATEGORY_SHORT_LABEL: Record<string, string> = {
  ...Object.fromEntries(WIZARD_STEPS.map((s) => [s.category, s.shortLabel])),
  OTHER: "Other",
};

// Maps a site-map level's free-text name (SITE_MAP_LEVEL_SUGGESTIONS, or
// anything a technician typed by hand) to its rank in the wizard's
// canonical order, so the site map's level tabs - a separate, independently
// named drawing feature - display Exterior -> ... -> Attic in the same
// fixed sequence as the checklist itself, not whatever order they happened
// to get drawn in. Case-insensitive with a couple of common synonyms;
// anything unrecognized (a custom level name) sorts after every canonical
// one rather than erroring.
const LEVEL_NAME_TO_CATEGORY: Record<string, WizardStepCategory> = {
  exterior: "EXTERIOR",
  "1st floor": "FIRST_FLOOR",
  "first floor": "FIRST_FLOOR",
  "2nd floor": "SECOND_FLOOR",
  "second floor": "SECOND_FLOOR",
  "3rd floor": "THIRD_FLOOR",
  "third floor": "THIRD_FLOOR",
  basement: "BASEMENT",
  crawlspace: "CRAWLSPACE",
  "crawl space": "CRAWLSPACE",
  attic: "ATTIC",
};

export function getSiteMapLevelRank(name: string): number {
  const category = LEVEL_NAME_TO_CATEGORY[name.trim().toLowerCase()];
  if (!category) return WIZARD_STEPS.length;
  return WIZARD_STEPS.findIndex((s) => s.category === category);
}
export const CHECKLIST_CATEGORY_DISPLAY_ORDER: string[] = [...WIZARD_STEPS.map((s) => s.category), "OTHER"];

// Duck-typed (not coupled to the Prisma or SQLite row shapes directly) so
// this same function works against both the backend's real rows and
// mobile's local-cache rows (whose `required` column is SQLite's 0/1
// INTEGER, not a real boolean).
export interface WizardSectionLike {
  category: string;
  items: { id: string; required: boolean | number }[];
}
export interface WizardResponseLike {
  templateItemId: string;
}
export interface PropertyApplicabilityLike {
  hasSecondFloor?: boolean | number | null;
  hasThirdFloor?: boolean | number | null;
  hasBasement?: boolean | number | null;
  hasCrawlspace?: boolean | number | null;
}

export interface WizardStepStatus {
  category: WizardStepCategory;
  label: string;
  shortLabel: string;
  required: boolean;
  // true/false once resolved (answered or explicitly marked N/A), null if
  // a conditional step's applicability has never been set on the property.
  applicable: boolean | null;
  resolved: boolean;
  itemsTotal: number;
  itemsAnswered: number;
}

export interface WizardStatus {
  steps: WizardStepStatus[];
  canComplete: boolean;
  // Index of the first unresolved step, or the last step's index once
  // every step is resolved. A step is reachable iff its index is <= this -
  // doubles as both the wizard's default landing step and the forward-
  // navigation boundary (can always go back, never jump ahead).
  furthestUnlockedIndex: number;
}

export function getWizardStepStatus(
  sections: WizardSectionLike[],
  responses: WizardResponseLike[],
  applicability?: PropertyApplicabilityLike | null
): WizardStatus {
  const answeredItemIds = new Set(responses.map((r) => r.templateItemId));
  const steps: WizardStepStatus[] = [];
  let blocked = false;
  let furthestUnlockedIndex = 0;

  WIZARD_STEPS.forEach((def, index) => {
    const requiredItems = sections
      .filter((s) => s.category === def.category)
      .flatMap((s) => s.items)
      .filter((i) => Boolean(i.required));
    const itemsTotal = requiredItems.length;
    const itemsAnswered = requiredItems.filter((i) => answeredItemIds.has(i.id)).length;
    const applicable = !def.applicabilityField
      ? true
      : applicability?.[def.applicabilityField] == null
        ? null
        : Boolean(applicability[def.applicabilityField]);
    // A category with zero required items (e.g. a custom template that
    // never defined any for that area) is vacuously resolved rather than
    // permanently blocking the wizard on nothing to answer.
    const answeredEnough = itemsTotal === 0 || itemsAnswered >= itemsTotal;
    const resolved = def.required ? answeredEnough : applicable === false || answeredEnough;

    steps.push({ category: def.category, label: def.label, shortLabel: def.shortLabel, required: def.required, applicable, resolved, itemsTotal, itemsAnswered });

    if (!blocked) {
      furthestUnlockedIndex = index;
      if (!resolved) blocked = true;
    }
  });

  return { steps, canComplete: steps.every((s) => s.resolved), furthestUnlockedIndex };
}

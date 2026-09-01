export const CHECKLIST_CATEGORY_LABEL: Record<string, string> = {
  EXTERIOR: "Exterior Inspection Checklist",
  INTERIOR: "Interior Inspection Checklist",
  ATTIC: "Attic Inspection Checklist",
  CRAWLSPACE: "Crawl Space Inspection Checklist",
  OTHER: "Additional Checklist Items",
};
export const CHECKLIST_CATEGORY_ORDER = ["EXTERIOR", "INTERIOR", "ATTIC", "CRAWLSPACE", "OTHER"];

export const CHECKLIST_STATUS_LABEL: Record<string, string> = {
  SATISFACTORY: "Satisfactory",
  NEEDS_ATTENTION: "Needs Attention",
  NOT_APPLICABLE: "N/A",
};

// The categories a technician can opt into per inspection - e.g. skip Crawl
// Space on a slab-foundation house. Excludes OTHER, a catch-all bucket
// rather than a physical area someone would deliberately include/skip.
export const CHECKLIST_SELECTABLE_CATEGORIES = ["EXTERIOR", "INTERIOR", "ATTIC", "CRAWLSPACE"];
export const CHECKLIST_CATEGORY_SHORT_LABEL: Record<string, string> = {
  EXTERIOR: "Exterior",
  INTERIOR: "Interior",
  ATTIC: "Attic",
  CRAWLSPACE: "Crawl Space",
};

// Inspection.checklistCategories is JSON-encoded; null/empty/unparseable
// means "show every category" (also covers inspections created before this
// field existed).
export function parseChecklistCategories(json: string | null | undefined): string[] {
  if (!json) return CHECKLIST_SELECTABLE_CATEGORIES;
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : CHECKLIST_SELECTABLE_CATEGORIES;
  } catch {
    return CHECKLIST_SELECTABLE_CATEGORIES;
  }
}

export interface ChecklistDisplaySection {
  category: string;
  items: { prompt: string; status: string; notes: string | null }[];
}

interface SectionLike {
  category: string;
  sortOrder: number;
  items: { id: string; prompt: string }[];
}
interface ResponseLike {
  templateItemId: string;
  status: string;
  notes?: string | null;
}

// Joins template sections/items against an inspection's answered responses,
// grouped by exterior/interior/other for display in reports and detail
// screens. Only answered items are shown - an inspection that never touched
// a section (no template selected, or offline before the checklist screen
// was opened) should show nothing rather than a wall of blanks.
export function groupChecklistForDisplay(sections: SectionLike[], responses: ResponseLike[]): ChecklistDisplaySection[] {
  const responseByItem = new Map(responses.map((r) => [r.templateItemId, r]));
  const byCategory = new Map<string, ChecklistDisplaySection["items"]>();

  const sorted = [...sections].sort((a, b) => a.sortOrder - b.sortOrder);
  for (const section of sorted) {
    for (const item of section.items) {
      const response = responseByItem.get(item.id);
      if (!response) continue;
      const list = byCategory.get(section.category) ?? [];
      list.push({ prompt: item.prompt, status: response.status, notes: response.notes ?? null });
      byCategory.set(section.category, list);
    }
  }

  return CHECKLIST_CATEGORY_ORDER.filter((c) => byCategory.has(c)).map((category) => ({
    category,
    items: byCategory.get(category)!,
  }));
}

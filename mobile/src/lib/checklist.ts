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

// Generic over the photo shape since local (LocalChecklistResponsePhoto,
// keyed off localUri/remoteUrl) and remote (ChecklistResponsePhoto, keyed
// off fileUrl) resolve a displayable URI differently - this just passes
// whatever was given straight through for the caller to render.
export interface ChecklistDisplaySection<P = unknown> {
  category: string;
  items: { prompt: string; status: string; notes: string | null; photos: P[] }[];
}

interface SectionLike {
  category: string;
  sortOrder: number;
  items: { id: string; prompt: string }[];
}
interface ResponseLike<P = unknown> {
  templateItemId: string;
  status: string;
  notes?: string | null;
  photos?: P[];
}

// Joins template sections/items against an inspection's answered responses,
// grouped by exterior/interior/other for display in reports and detail
// screens. Only answered items are shown - an inspection that never touched
// a section (no template selected, or offline before the checklist screen
// was opened) should show nothing rather than a wall of blanks.
export function groupChecklistForDisplay<P = unknown>(
  sections: SectionLike[],
  responses: ResponseLike<P>[]
): ChecklistDisplaySection<P>[] {
  const responseByItem = new Map(responses.map((r) => [r.templateItemId, r]));
  const byCategory = new Map<string, ChecklistDisplaySection<P>["items"]>();

  const sorted = [...sections].sort((a, b) => a.sortOrder - b.sortOrder);
  for (const section of sorted) {
    for (const item of section.items) {
      const response = responseByItem.get(item.id);
      if (!response) continue;
      const list = byCategory.get(section.category) ?? [];
      list.push({ prompt: item.prompt, status: response.status, notes: response.notes ?? null, photos: response.photos ?? [] });
      byCategory.set(section.category, list);
    }
  }

  return CHECKLIST_CATEGORY_ORDER.filter((c) => byCategory.has(c)).map((category) => ({
    category,
    items: byCategory.get(category)!,
  }));
}

export interface ChecklistResponseSummary {
  id: string;
  prompt: string;
  notes: string | null;
  photos: { localUri: string }[];
}

// Resolves an answered checklist response to what a technician would
// recognize it by (its prompt text) plus whatever notes/photos already
// exist for it - used to carry that data over onto a site-map finding
// instead of making the technician retype it (see SiteMapScreen and
// FindingFormScreen's fromChecklistResponseId param).
export function findChecklistResponseSummary(
  responseId: string,
  responses: (ResponseLike<{ localUri: string }> & { id: string })[],
  sections: SectionLike[]
): ChecklistResponseSummary | null {
  const response = responses.find((r) => r.id === responseId);
  if (!response) return null;
  const item = sections.flatMap((s) => s.items).find((i) => i.id === response.templateItemId);
  if (!item) return null;
  return { id: response.id, prompt: item.prompt, notes: response.notes ?? null, photos: response.photos ?? [] };
}

export interface ChecklistResponseListItem extends ChecklistResponseSummary {
  category: string;
}

// Every answered checklist response as a flat, pickable list (category +
// prompt + notes preview) - backs the "Copy from Checklist" action on a
// site-map marker/finding, the reverse direction of
// findChecklistResponseSummary above: instead of the checklist screen
// handing off one specific response via a navigation param, this lets the
// technician browse and pick one while already on the finding form.
export function listChecklistResponseSummaries(
  responses: (ResponseLike<{ localUri: string }> & { id: string })[],
  sections: SectionLike[]
): ChecklistResponseListItem[] {
  const itemById = new Map(sections.flatMap((s) => s.items.map((i) => [i.id, { ...i, category: s.category }] as const)));
  const list: ChecklistResponseListItem[] = [];
  for (const r of responses) {
    const item = itemById.get(r.templateItemId);
    if (!item) continue;
    list.push({ id: r.id, prompt: item.prompt, category: item.category, notes: r.notes ?? null, photos: r.photos ?? [] });
  }
  return list;
}

import { useFocusEffect } from "@react-navigation/native";
import React, { useCallback, useMemo, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { deleteChecklistResponse } from "../api/inspections";
import { getCachedTemplateSections } from "../db/cache";
import {
  addLocalChecklistResponsePhoto,
  deleteLocalChecklistResponse,
  getLocalInspectionDetail,
  upsertLocalChecklistResponse,
} from "../db/inspectionStore";
import type { LocalChecklistResponse, LocalChecklistResponsePhoto, LocalTemplateItem } from "../db/types";
import { CHECKLIST_CATEGORY_DISPLAY_ORDER, CHECKLIST_CATEGORY_LABEL } from "../lib/checklist";
import { capturePhoto } from "../lib/photo";
import { Badge, Card, Checkbox, Field, colors } from "./ui";

type ResponseWithPhotos = LocalChecklistResponse & { photos: LocalChecklistResponsePhoto[] };
type TemplateSection = ReturnType<typeof getCachedTemplateSections>[number];

// The actual checklist UI (search, collapsible categories/sections, items),
// factored out of ChecklistScreen so it can be rendered several ways: as
// that screen's full-page review body, embedded directly on SiteMapScreen
// (Tate's "Site Map + Checklist + Finding Editor, all in one workspace"
// ask), and one-category-at-a-time inside the mandatory checklist wizard
// (Matt's ask - see InspectionWizardScreen). `onAddToSiteMap` is the one
// behavioral difference between the navigate-away hosts and the embedded
// ones: ChecklistScreen navigates to a separate SiteMap route, while
// SiteMapScreen/the wizard (already showing the map, or driving their own
// navigation) just update state in place.
export function ChecklistPanel({
  inspectionId,
  onAddToSiteMap,
  categoryFilter,
  hideCategoryHeader,
  allowedCategories,
  onChange,
}: {
  inspectionId: string;
  onAddToSiteMap: (responseId: string) => void;
  // Show only this one category (the wizard, scoped to its current step).
  categoryFilter?: string;
  // Skip the collapsible category header/badge row - pairs with
  // categoryFilter so a single-step view isn't wrapped in redundant chrome.
  hideCategoryHeader?: boolean;
  // Restrict which categories are visible at all (OTHER is always exempt,
  // same as before) without narrowing to just one - used by ChecklistScreen
  // and SiteMapScreen to show every category the wizard has unlocked so
  // far, so a technician can review/edit anything already reached but can't
  // answer a category out of sequence from these entry points.
  allowedCategories?: string[];
  // Fires after every response mutation (check/uncheck/notes/photo) - lets
  // a host that derives its own state from responses (the wizard's
  // step-resolved/Next-button gating) stay in sync live instead of only on
  // next focus, since this component owns its response state independently.
  onChange?: () => void;
}) {
  const [responses, setResponses] = useState<ResponseWithPhotos[]>([]);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

  useFocusEffect(
    useCallback(() => {
      const detail = getLocalInspectionDetail(inspectionId);
      setResponses(detail?.checklistResponses ?? []);
      setTemplateId(detail?.inspection.templateId ?? null);
    }, [inspectionId])
  );

  const responseByItem = useMemo(() => {
    const map = new Map<string, ResponseWithPhotos>();
    for (const r of responses) map.set(r.templateItemId, r);
    return map;
  }, [responses]);

  const sections = useMemo(() => (templateId ? getCachedTemplateSections(templateId) : []), [templateId]);

  const sectionsByCategory = useMemo(() => {
    const grouped = new Map<string, TemplateSection[]>();
    for (const section of sections) {
      if (categoryFilter) {
        if (section.category !== categoryFilter) continue;
      } else if (allowedCategories && section.category !== "OTHER" && !allowedCategories.includes(section.category)) {
        continue;
      }
      const list = grouped.get(section.category) ?? [];
      list.push(section);
      grouped.set(section.category, list);
    }
    return grouped;
  }, [sections, categoryFilter, allowedCategories]);

  const query = search.trim().toLowerCase();
  const isSearching = query.length > 0;

  function itemMatches(item: LocalTemplateItem, section: TemplateSection, category: string): boolean {
    return (
      item.prompt.toLowerCase().includes(query) ||
      section.name.toLowerCase().includes(query) ||
      (CHECKLIST_CATEGORY_LABEL[category] ?? category).toLowerCase().includes(query)
    );
  }

  function toggleCategory(category: string) {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }

  function toggleSection(sectionId: string) {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });
  }

  // Matt/the field team's ask: answering every item one at a time is slow
  // when the whole area is in fine shape - one tap marks every
  // not-yet-answered item in this category SATISFACTORY (with no notes),
  // and the technician can still uncheck or add notes/photos to the one
  // item that actually needs attention afterward. Scoped to whatever's
  // currently visible (respects an active search filter) rather than the
  // category's full unfiltered item list.
  function handleCheckAllInCategory(items: LocalTemplateItem[]) {
    const newlyChecked: ResponseWithPhotos[] = [];
    for (const item of items) {
      if (responseByItem.has(item.id)) continue;
      const response = upsertLocalChecklistResponse(inspectionId, item.id, "SATISFACTORY", null);
      newlyChecked.push({ ...response, photos: [] });
    }
    if (newlyChecked.length === 0) return;
    setResponses((prev) => [...prev, ...newlyChecked]);
    onChange?.();
  }

  function handleCheck(item: LocalTemplateItem, notes: string | null) {
    const response = upsertLocalChecklistResponse(inspectionId, item.id, "SATISFACTORY", notes);
    const existingPhotos = responseByItem.get(item.id)?.photos ?? [];
    setResponses((prev) => [...prev.filter((r) => r.templateItemId !== item.id), { ...response, photos: existingPhotos }]);
    onChange?.();
  }

  function handleUncheck(item: LocalTemplateItem) {
    const existing = responseByItem.get(item.id);
    if (!existing) return;
    deleteLocalChecklistResponse(existing.id);
    setResponses((prev) => prev.filter((r) => r.templateItemId !== item.id));
    deleteChecklistResponse(inspectionId, existing.id).catch(() => {});
    onChange?.();
  }

  function handleNotesChange(item: LocalTemplateItem, notes: string | null) {
    const existing = responseByItem.get(item.id);
    if (!existing) return;
    const response = upsertLocalChecklistResponse(inspectionId, item.id, existing.status, notes);
    setResponses((prev) => [...prev.filter((r) => r.templateItemId !== item.id), { ...response, photos: existing.photos }]);
    onChange?.();
  }

  function commitResponse(item: LocalTemplateItem, notes: string | null): ResponseWithPhotos {
    const existing = responseByItem.get(item.id);
    const status = existing?.status ?? "SATISFACTORY";
    const updated = upsertLocalChecklistResponse(inspectionId, item.id, status, notes);
    const response = { ...updated, photos: existing?.photos ?? [] };
    setResponses((prev) => [...prev.filter((r) => r.templateItemId !== item.id), response]);
    onChange?.();
    return response;
  }

  async function handleAddPhoto(item: LocalTemplateItem, notes: string | null) {
    const uri = await capturePhoto();
    if (!uri) return;
    const response = commitResponse(item, notes);
    const photo = addLocalChecklistResponsePhoto(response.id, { localUri: uri, caption: null, sortOrder: response.photos.length });
    setResponses((prev) => [
      ...prev.filter((r) => r.templateItemId !== item.id),
      { ...response, photos: [...response.photos, photo] },
    ]);
  }

  function handleAddToSiteMap(item: LocalTemplateItem, notes: string | null) {
    const response = commitResponse(item, notes);
    onAddToSiteMap(response.id);
  }

  if (!templateId) {
    return <Text style={styles.emptyText}>This inspection has no template assigned, so there's no checklist to fill out.</Text>;
  }

  const visibleCategories = CHECKLIST_CATEGORY_DISPLAY_ORDER.filter((c) => sectionsByCategory.has(c));
  let anyMatches = false;

  return (
    <View>
      <Field label="" placeholder="Search checklist (e.g. door, weep hole, foundation)" value={search} onChangeText={setSearch} />

      {visibleCategories.map((category) => {
        const categorySections = sectionsByCategory.get(category)!;
        const totalItems = categorySections.reduce((sum, s) => sum + s.items.length, 0);
        const checkedCount = categorySections.reduce(
          (sum, s) => sum + s.items.filter((i) => responseByItem.has(i.id)).length,
          0
        );

        const visibleSections = categorySections
          .map((section) => ({
            section,
            items: isSearching ? section.items.filter((i) => itemMatches(i, section, category)) : section.items,
          }))
          .filter(({ items }) => !isSearching || items.length > 0);

        if (isSearching && visibleSections.length === 0) return null;
        if (isSearching) anyMatches = true;

        const categoryExpanded = hideCategoryHeader || isSearching || expandedCategories.has(category);
        const visibleUncheckedItems = visibleSections.flatMap(({ items }) => items.filter((i) => !responseByItem.has(i.id)));

        return (
          <View key={category} style={styles.categoryBlock}>
            {!hideCategoryHeader ? (
              <Pressable style={styles.categoryHeaderRow} onPress={() => toggleCategory(category)}>
                <Text style={styles.categoryTitle}>
                  {categoryExpanded ? "▾" : "▸"} {CHECKLIST_CATEGORY_LABEL[category] ?? category}
                </Text>
                <Badge
                  label={`${checkedCount}/${totalItems}`}
                  tone={checkedCount === totalItems && totalItems > 0 ? "success" : "default"}
                />
              </Pressable>
            ) : null}
            {categoryExpanded && visibleUncheckedItems.length > 0 ? (
              <Text style={styles.checkAllLink} onPress={() => handleCheckAllInCategory(visibleUncheckedItems)}>
                ✓ Check all as satisfactory ({visibleUncheckedItems.length} remaining)
              </Text>
            ) : null}
            {categoryExpanded
              ? visibleSections.map(({ section, items }) => {
                  const sectionChecked = section.items.filter((i) => responseByItem.has(i.id)).length;
                  const sectionExpanded = isSearching || expandedSections.has(section.id);
                  return (
                    <View key={section.id} style={styles.sectionBlock}>
                      <Pressable style={styles.sectionHeaderRow} onPress={() => toggleSection(section.id)}>
                        <Text style={styles.sectionName}>
                          {sectionExpanded ? "▾" : "▸"} {section.name}
                        </Text>
                        <Text style={styles.sectionCount}>
                          {sectionChecked}/{section.items.length}
                        </Text>
                      </Pressable>
                      {sectionExpanded
                        ? items.map((item) => {
                            const response = responseByItem.get(item.id);
                            return (
                              <ChecklistItemRow
                                key={item.id}
                                item={item}
                                checked={!!response}
                                notes={response?.notes ?? null}
                                photos={response?.photos ?? []}
                                onCheck={(notes) => handleCheck(item, notes)}
                                onUncheck={() => handleUncheck(item)}
                                onNotesChange={(notes) => handleNotesChange(item, notes)}
                                onAddPhoto={(notes) => handleAddPhoto(item, notes)}
                                onAddToSiteMap={(notes) => handleAddToSiteMap(item, notes)}
                              />
                            );
                          })
                        : null}
                    </View>
                  );
                })
              : null}
          </View>
        );
      })}
      {sections.length === 0 ? <Text style={styles.emptyText}>This template has no checklist items.</Text> : null}
      {isSearching && !anyMatches ? <Text style={styles.emptyText}>No checklist items match "{search.trim()}".</Text> : null}
    </View>
  );
}

function ChecklistItemRow({
  item,
  checked,
  notes,
  photos,
  onCheck,
  onUncheck,
  onNotesChange,
  onAddPhoto,
  onAddToSiteMap,
}: {
  item: LocalTemplateItem;
  checked: boolean;
  notes: string | null;
  photos: LocalChecklistResponsePhoto[];
  onCheck: (notes: string | null) => void;
  onUncheck: () => void;
  onNotesChange: (notes: string | null) => void;
  onAddPhoto: (notes: string | null) => void;
  onAddToSiteMap: (notes: string | null) => void;
}) {
  const [localNotes, setLocalNotes] = useState(notes ?? "");

  return (
    <Card style={styles.itemCard}>
      <Checkbox
        label={item.prompt}
        required={!!item.required}
        checked={checked}
        onChange={(next) => (next ? onCheck(localNotes.trim() || null) : onUncheck())}
      />
      <Field
        label="Notes"
        placeholder="Optional notes"
        value={localNotes}
        onChangeText={setLocalNotes}
        onBlur={() => {
          if (checked) onNotesChange(localNotes.trim() || null);
        }}
      />
      <View style={styles.photoRow}>
        {photos.map((p) => (
          <Image key={p.id} source={{ uri: p.localUri }} style={styles.photoThumb} />
        ))}
        <Text style={styles.addPhotoLink} onPress={() => onAddPhoto(localNotes.trim() || null)}>
          + Photo
        </Text>
        <Text style={styles.addPhotoLink} onPress={() => onAddToSiteMap(localNotes.trim() || null)}>
          📍 Add to Site Map
        </Text>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  emptyText: { color: colors.textMuted, textAlign: "center", marginTop: 12 },
  categoryBlock: { marginBottom: 12 },
  categoryHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 8,
  },
  categoryTitle: { fontSize: 16, fontWeight: "700", color: colors.text },
  checkAllLink: { color: colors.primary, fontWeight: "600", fontSize: 13, marginBottom: 10 },
  sectionBlock: { marginBottom: 8, marginLeft: 8 },
  sectionHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
    marginBottom: 4,
  },
  sectionName: { fontSize: 13, fontWeight: "600", color: colors.textMuted, textTransform: "uppercase" },
  sectionCount: { fontSize: 12, color: colors.textMuted, fontWeight: "600" },
  itemCard: { marginBottom: 8, gap: 4 },
  photoRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 4 },
  photoThumb: { width: 48, height: 48, borderRadius: 6 },
  addPhotoLink: { color: colors.primary, fontWeight: "600", fontSize: 13 },
});

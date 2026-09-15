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
import { parseChecklistCategories } from "../lib/checklist";
import { capturePhoto } from "../lib/photo";
import { Badge, Card, Checkbox, Field, colors } from "./ui";

type ResponseWithPhotos = LocalChecklistResponse & { photos: LocalChecklistResponsePhoto[] };
type TemplateSection = ReturnType<typeof getCachedTemplateSections>[number];

const CATEGORY_LABEL: Record<string, string> = {
  EXTERIOR: "Exterior Inspection Checklist",
  INTERIOR: "Interior Inspection Checklist",
  ATTIC: "Attic Inspection Checklist",
  CRAWLSPACE: "Crawl Space Inspection Checklist",
  OTHER: "Additional Checklist Items",
};
const CATEGORY_ORDER = ["EXTERIOR", "INTERIOR", "ATTIC", "CRAWLSPACE", "OTHER"];

// The actual checklist UI (search, collapsible categories/sections, items),
// factored out of ChecklistScreen so it can be rendered two ways: as that
// screen's full-page body, and embedded directly on SiteMapScreen - Tate's
// "Site Map + Checklist + Finding Editor, all in one workspace" ask, so a
// technician never has to leave the map to consult or update the checklist.
// `onAddToSiteMap` is the one behavioral difference between the two hosts:
// ChecklistScreen navigates to a separate SiteMap route, while SiteMapScreen
// (already showing the map) just updates its own route param in place.
export function ChecklistPanel({ inspectionId, onAddToSiteMap }: { inspectionId: string; onAddToSiteMap: (responseId: string) => void }) {
  const [responses, setResponses] = useState<ResponseWithPhotos[]>([]);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [activeCategories, setActiveCategories] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

  useFocusEffect(
    useCallback(() => {
      const detail = getLocalInspectionDetail(inspectionId);
      setResponses(detail?.checklistResponses ?? []);
      setTemplateId(detail?.inspection.templateId ?? null);
      setActiveCategories(parseChecklistCategories(detail?.inspection.checklistCategories));
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
      if (section.category !== "OTHER" && !activeCategories.includes(section.category)) continue;
      const list = grouped.get(section.category) ?? [];
      list.push(section);
      grouped.set(section.category, list);
    }
    return grouped;
  }, [sections, activeCategories]);

  const query = search.trim().toLowerCase();
  const isSearching = query.length > 0;

  function itemMatches(item: LocalTemplateItem, section: TemplateSection, category: string): boolean {
    return (
      item.prompt.toLowerCase().includes(query) ||
      section.name.toLowerCase().includes(query) ||
      (CATEGORY_LABEL[category] ?? category).toLowerCase().includes(query)
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

  function handleCheck(item: LocalTemplateItem, notes: string | null) {
    const response = upsertLocalChecklistResponse(inspectionId, item.id, "SATISFACTORY", notes);
    const existingPhotos = responseByItem.get(item.id)?.photos ?? [];
    setResponses((prev) => [...prev.filter((r) => r.templateItemId !== item.id), { ...response, photos: existingPhotos }]);
  }

  function handleUncheck(item: LocalTemplateItem) {
    const existing = responseByItem.get(item.id);
    if (!existing) return;
    deleteLocalChecklistResponse(existing.id);
    setResponses((prev) => prev.filter((r) => r.templateItemId !== item.id));
    deleteChecklistResponse(inspectionId, existing.id).catch(() => {});
  }

  function handleNotesChange(item: LocalTemplateItem, notes: string | null) {
    const existing = responseByItem.get(item.id);
    if (!existing) return;
    const response = upsertLocalChecklistResponse(inspectionId, item.id, existing.status, notes);
    setResponses((prev) => [...prev.filter((r) => r.templateItemId !== item.id), { ...response, photos: existing.photos }]);
  }

  function commitResponse(item: LocalTemplateItem, notes: string | null): ResponseWithPhotos {
    const existing = responseByItem.get(item.id);
    const status = existing?.status ?? "SATISFACTORY";
    const updated = upsertLocalChecklistResponse(inspectionId, item.id, status, notes);
    const response = { ...updated, photos: existing?.photos ?? [] };
    setResponses((prev) => [...prev.filter((r) => r.templateItemId !== item.id), response]);
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

  const visibleCategories = CATEGORY_ORDER.filter((c) => sectionsByCategory.has(c));
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

        const categoryExpanded = isSearching || expandedCategories.has(category);

        return (
          <View key={category} style={styles.categoryBlock}>
            <Pressable style={styles.categoryHeaderRow} onPress={() => toggleCategory(category)}>
              <Text style={styles.categoryTitle}>
                {categoryExpanded ? "▾" : "▸"} {CATEGORY_LABEL[category] ?? category}
              </Text>
              <Badge
                label={`${checkedCount}/${totalItems}`}
                tone={checkedCount === totalItems && totalItems > 0 ? "success" : "default"}
              />
            </Pressable>
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

import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useMemo, useState } from "react";
import { Image, ScrollView, StyleSheet, Text, View } from "react-native";
import { deleteChecklistResponse } from "../../api/inspections";
import { getCachedTemplateSections } from "../../db/cache";
import {
  addLocalChecklistResponsePhoto,
  deleteLocalChecklistResponse,
  getLocalInspectionDetail,
  upsertLocalChecklistResponse,
} from "../../db/inspectionStore";
import type { LocalChecklistResponse, LocalChecklistResponsePhoto, LocalTemplateItem } from "../../db/types";
import { InspectionsStackParamList } from "../../navigation/navigationTypes";
import { Badge, Card, Checkbox, Field, colors } from "../../components/ui";
import { parseChecklistCategories } from "../../lib/checklist";
import { capturePhoto } from "../../lib/photo";

type Props = NativeStackScreenProps<InspectionsStackParamList, "Checklist">;

type ResponseWithPhotos = LocalChecklistResponse & { photos: LocalChecklistResponsePhoto[] };

const CATEGORY_LABEL: Record<string, string> = {
  EXTERIOR: "Exterior Inspection Checklist",
  INTERIOR: "Interior Inspection Checklist",
  ATTIC: "Attic Inspection Checklist",
  CRAWLSPACE: "Crawl Space Inspection Checklist",
  OTHER: "Additional Checklist Items",
};
const CATEGORY_ORDER = ["EXTERIOR", "INTERIOR", "ATTIC", "CRAWLSPACE", "OTHER"];

export default function ChecklistScreen({ route, navigation }: Props) {
  const { inspectionId } = route.params;
  const [responses, setResponses] = useState<ResponseWithPhotos[]>([]);
  const [templateId, setTemplateId] = useState<string | null>(null);
  // OTHER always shows (it's not a category the technician chose to include
  // or skip - see parseChecklistCategories/CHECKLIST_SELECTABLE_CATEGORIES).
  const [activeCategories, setActiveCategories] = useState<string[]>([]);

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
    const grouped = new Map<string, typeof sections>();
    for (const section of sections) {
      if (section.category !== "OTHER" && !activeCategories.includes(section.category)) continue;
      const list = grouped.get(section.category) ?? [];
      list.push(section);
      grouped.set(section.category, list);
    }
    return grouped;
  }, [sections, activeCategories]);

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
    // Best-effort - if this fails (offline, etc.) the local uncheck still
    // stands; there's no retry/tombstone path for this since checklist
    // deletes don't go through the generic sync engine (see inspectionStore).
    deleteChecklistResponse(inspectionId, existing.id).catch(() => {});
  }

  function handleNotesChange(item: LocalTemplateItem, notes: string | null) {
    const existing = responseByItem.get(item.id);
    if (!existing) return;
    const response = upsertLocalChecklistResponse(inspectionId, item.id, existing.status, notes);
    setResponses((prev) => [...prev.filter((r) => r.templateItemId !== item.id), { ...response, photos: existing.photos }]);
  }

  // Persists whatever's currently in the (possibly unblurred) notes field
  // and returns the up-to-date response - shared by +Photo and Add to Site
  // Map so neither one silently drops notes the technician just typed but
  // hadn't tabbed away from yet. Also creates the response (defaulting to
  // Satisfactory, same as checking the box) if the item hadn't been touched
  // yet, so neither action is ever a dead tap on an unchecked item.
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
    navigation.navigate("SiteMap", { inspectionId, fromChecklistResponseId: response.id });
  }

  if (!templateId) {
    return (
      <View style={styles.container}>
        <Text style={styles.emptyText}>This inspection has no template assigned, so there's no checklist to fill out.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {CATEGORY_ORDER.filter((c) => sectionsByCategory.has(c)).map((category) => {
        const categorySections = sectionsByCategory.get(category)!;
        const totalItems = categorySections.reduce((sum, s) => sum + s.items.length, 0);
        const checkedCount = categorySections.reduce(
          (sum, s) => sum + s.items.filter((i) => responseByItem.has(i.id)).length,
          0
        );
        return (
          <View key={category} style={styles.categoryBlock}>
            <View style={styles.categoryHeaderRow}>
              <Text style={styles.categoryTitle}>{CATEGORY_LABEL[category] ?? category}</Text>
              <Badge
                label={`${checkedCount}/${totalItems}`}
                tone={checkedCount === totalItems && totalItems > 0 ? "success" : "default"}
              />
            </View>
            {categorySections.map((section) => (
              <View key={section.id} style={styles.sectionBlock}>
                <Text style={styles.sectionName}>{section.name}</Text>
                {section.items.map((item) => {
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
                })}
              </View>
            ))}
          </View>
        );
      })}
      {sections.length === 0 ? <Text style={styles.emptyText}>This template has no checklist items.</Text> : null}
    </ScrollView>
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
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 40 },
  emptyText: { color: colors.textMuted, textAlign: "center", marginTop: 24 },
  categoryBlock: { marginBottom: 20 },
  categoryHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  categoryTitle: { fontSize: 17, fontWeight: "700", color: colors.text },
  sectionBlock: { marginBottom: 12 },
  sectionName: { fontSize: 13, fontWeight: "600", color: colors.textMuted, marginBottom: 6, textTransform: "uppercase" },
  itemCard: { marginBottom: 8, gap: 4 },
  photoRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 4 },
  photoThumb: { width: 48, height: 48, borderRadius: 6 },
  addPhotoLink: { color: colors.primary, fontWeight: "600", fontSize: 13 },
});

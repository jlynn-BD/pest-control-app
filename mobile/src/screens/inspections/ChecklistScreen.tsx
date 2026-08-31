import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { deleteChecklistResponse } from "../../api/inspections";
import { getCachedTemplateSections } from "../../db/cache";
import {
  deleteLocalChecklistResponse,
  getLocalInspectionDetail,
  upsertLocalChecklistResponse,
} from "../../db/inspectionStore";
import type { LocalChecklistResponse, LocalTemplateItem } from "../../db/types";
import { InspectionsStackParamList } from "../../navigation/navigationTypes";
import { Badge, Card, Checkbox, Field, colors } from "../../components/ui";

type Props = NativeStackScreenProps<InspectionsStackParamList, "Checklist">;

const CATEGORY_LABEL: Record<string, string> = {
  EXTERIOR: "Exterior Inspection Checklist",
  INTERIOR: "Interior Inspection Checklist",
  ATTIC: "Attic Inspection Checklist",
  CRAWLSPACE: "Crawl Space Inspection Checklist",
  OTHER: "Additional Checklist Items",
};
const CATEGORY_ORDER = ["EXTERIOR", "INTERIOR", "ATTIC", "CRAWLSPACE", "OTHER"];

export default function ChecklistScreen({ route }: Props) {
  const { inspectionId } = route.params;
  const [responses, setResponses] = useState<LocalChecklistResponse[]>([]);
  const [templateId, setTemplateId] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      const detail = getLocalInspectionDetail(inspectionId);
      setResponses(detail?.checklistResponses ?? []);
      setTemplateId(detail?.inspection.templateId ?? null);
    }, [inspectionId])
  );

  const responseByItem = useMemo(() => {
    const map = new Map<string, LocalChecklistResponse>();
    for (const r of responses) map.set(r.templateItemId, r);
    return map;
  }, [responses]);

  const sections = useMemo(() => (templateId ? getCachedTemplateSections(templateId) : []), [templateId]);

  const sectionsByCategory = useMemo(() => {
    const grouped = new Map<string, typeof sections>();
    for (const section of sections) {
      const list = grouped.get(section.category) ?? [];
      list.push(section);
      grouped.set(section.category, list);
    }
    return grouped;
  }, [sections]);

  function handleCheck(item: LocalTemplateItem, notes: string | null) {
    const response = upsertLocalChecklistResponse(inspectionId, item.id, "SATISFACTORY", notes);
    setResponses((prev) => [...prev.filter((r) => r.templateItemId !== item.id), response]);
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
    setResponses((prev) => [...prev.filter((r) => r.templateItemId !== item.id), response]);
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
                      onCheck={(notes) => handleCheck(item, notes)}
                      onUncheck={() => handleUncheck(item)}
                      onNotesChange={(notes) => handleNotesChange(item, notes)}
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
  onCheck,
  onUncheck,
  onNotesChange,
}: {
  item: LocalTemplateItem;
  checked: boolean;
  notes: string | null;
  onCheck: (notes: string | null) => void;
  onUncheck: () => void;
  onNotesChange: (notes: string | null) => void;
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
});

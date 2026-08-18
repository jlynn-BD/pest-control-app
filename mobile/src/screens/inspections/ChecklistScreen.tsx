import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { getCachedTemplateSections } from "../../db/cache";
import { getLocalInspectionDetail, upsertLocalChecklistResponse } from "../../db/inspectionStore";
import type { LocalChecklistResponse, LocalTemplateItem } from "../../db/types";
import { InspectionsStackParamList } from "../../navigation/navigationTypes";
import { Badge, Card, Field, colors } from "../../components/ui";
import { SegmentedControl } from "../../components/ChipMultiSelect";

type Props = NativeStackScreenProps<InspectionsStackParamList, "Checklist">;

const STATUS_OPTIONS = ["SATISFACTORY", "NEEDS_ATTENTION", "NOT_APPLICABLE"] as const;
const STATUS_LABEL: Record<string, string> = {
  SATISFACTORY: "Satisfactory",
  NEEDS_ATTENTION: "Needs Attention",
  NOT_APPLICABLE: "N/A",
};
const CATEGORY_LABEL: Record<string, string> = {
  EXTERIOR: "Exterior Inspection Checklist",
  INTERIOR: "Interior Inspection Checklist",
  OTHER: "Additional Checklist Items",
};
const CATEGORY_ORDER = ["EXTERIOR", "INTERIOR", "OTHER"];

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

  function handleUpdate(item: LocalTemplateItem, status: string, notes: string | null) {
    upsertLocalChecklistResponse(inspectionId, item.id, status, notes);
    setResponses((prev) => {
      const next = prev.filter((r) => r.templateItemId !== item.id);
      next.push({
        id: prev.find((r) => r.templateItemId === item.id)?.id ?? item.id,
        inspectionId,
        templateItemId: item.id,
        status,
        notes,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        syncStatus: "pending",
      });
      return next;
    });
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
        const answered = categorySections.reduce(
          (sum, s) => sum + s.items.filter((i) => responseByItem.has(i.id)).length,
          0
        );
        const needsAttention = categorySections.some((s) =>
          s.items.some((i) => responseByItem.get(i.id)?.status === "NEEDS_ATTENTION")
        );
        return (
          <View key={category} style={styles.categoryBlock}>
            <View style={styles.categoryHeaderRow}>
              <Text style={styles.categoryTitle}>{CATEGORY_LABEL[category] ?? category}</Text>
              <Badge
                label={`${answered}/${totalItems}`}
                tone={needsAttention ? "danger" : answered === totalItems && totalItems > 0 ? "success" : "default"}
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
                      status={response?.status ?? null}
                      notes={response?.notes ?? null}
                      onChange={(status, notes) => handleUpdate(item, status, notes)}
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
  status,
  notes,
  onChange,
}: {
  item: LocalTemplateItem;
  status: string | null;
  notes: string | null;
  onChange: (status: string, notes: string | null) => void;
}) {
  const [localNotes, setLocalNotes] = useState(notes ?? "");

  return (
    <Card style={styles.itemCard}>
      <Text style={styles.itemPrompt}>
        {item.prompt}
        {item.required ? " *" : ""}
      </Text>
      <SegmentedControl
        label=""
        options={STATUS_OPTIONS}
        labels={STATUS_LABEL}
        value={status ?? ""}
        onChange={(next) => onChange(next, localNotes.trim() || null)}
      />
      <Field
        label="Notes"
        placeholder="Optional notes"
        value={localNotes}
        onChangeText={setLocalNotes}
        onBlur={() => {
          if (status) onChange(status, localNotes.trim() || null);
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
  itemPrompt: { fontSize: 14, fontWeight: "600", color: colors.text, marginBottom: 4 },
});

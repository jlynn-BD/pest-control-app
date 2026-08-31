import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { getCachedCustomer, getCachedProperty, getCachedTemplateSections, getCachedTemplates } from "../../db/cache";
import {
  completeLocalInspection,
  getLocalInspectionDetail,
  LocalInspectionDetail,
  setLocalInspectionTemplate,
} from "../../db/inspectionStore";
import { InspectionsStackParamList } from "../../navigation/navigationTypes";
import { Badge, Card, PrimaryButton, colors } from "../../components/ui";

type Props = NativeStackScreenProps<InspectionsStackParamList, "InspectionWorkspace">;

export default function InspectionWorkspaceScreen({ route, navigation }: Props) {
  const { inspectionId } = route.params;
  const [detail, setDetail] = useState<LocalInspectionDetail | null>(null);

  useFocusEffect(
    useCallback(() => {
      setDetail(getLocalInspectionDetail(inspectionId));
    }, [inspectionId])
  );

  if (!detail) return null;

  const property = getCachedProperty(detail.inspection.propertyId);
  const customer = getCachedCustomer(detail.inspection.customerId);
  const templateSections = detail.inspection.templateId ? getCachedTemplateSections(detail.inspection.templateId) : [];
  const checklistItemCount = templateSections.reduce((sum, s) => sum + s.items.length, 0);
  const checklistAnsweredCount = detail.checklistResponses.length;
  const siteMapMarkerCount = detail.findings.filter((f) => f.floorPlanX != null).length;
  const hasSiteMapImage = Boolean(property?.siteMapLocalUri || property?.siteMapImageUrl);
  const hasCustomerSignature = detail.signatures.some((s) => s.signerType === "CUSTOMER");
  const hasTechnicianSignature = detail.signatures.some((s) => s.signerType === "TECHNICIAN");
  const isCompleted = detail.inspection.status === "COMPLETED";
  const availableTemplates = !detail.inspection.templateId ? getCachedTemplates() : [];

  function handleComplete() {
    completeLocalInspection(inspectionId);
    navigation.replace("LocalInspectionDetail", { inspectionId });
  }

  function handleAddChecklist(templateId: string) {
    setLocalInspectionTemplate(inspectionId, templateId);
    setDetail(getLocalInspectionDetail(inspectionId));
  }

  function handleRemoveChecklist() {
    setLocalInspectionTemplate(inspectionId, null);
    setDetail(getLocalInspectionDetail(inspectionId));
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.title}>{customer?.name ?? "Inspection"}</Text>
          <Text style={styles.meta}>{property?.addressLine1}</Text>
        </View>
        <Badge label={isCompleted ? "Completed" : "In progress"} tone={isCompleted ? "success" : "warning"} />
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Checklist</Text>
          {detail.inspection.templateId ? (
            <Badge
              label={`${checklistAnsweredCount}/${checklistItemCount}`}
              tone={checklistAnsweredCount >= checklistItemCount && checklistItemCount > 0 ? "success" : "warning"}
            />
          ) : null}
        </View>
        {detail.inspection.templateId ? (
          <Card style={styles.itemCard}>
            <Text style={styles.addLink} onPress={() => navigation.navigate("Checklist", { inspectionId })}>
              Open exterior/interior checklist
            </Text>
            <Text style={styles.removeLink} onPress={handleRemoveChecklist}>
              Remove checklist from this inspection
            </Text>
          </Card>
        ) : availableTemplates.length === 0 ? (
          <Text style={styles.itemMeta}>No checklist templates available offline yet.</Text>
        ) : availableTemplates.length === 1 ? (
          <Pressable style={styles.addButton} onPress={() => handleAddChecklist(availableTemplates[0].id)}>
            <Text style={styles.addButtonText}>+ Add Checklist</Text>
          </Pressable>
        ) : (
          availableTemplates.map((template) => (
            <Card key={template.id} style={styles.itemCard}>
              <Text style={styles.itemTitle}>{template.name}</Text>
              <Text style={styles.addLink} onPress={() => handleAddChecklist(template.id)}>
                + Add this checklist to the inspection
              </Text>
            </Card>
          ))
        )}
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Site Map</Text>
          {hasSiteMapImage ? <Badge label={`${siteMapMarkerCount} marker(s)`} /> : null}
        </View>
        <Card style={styles.itemCard}>
          <Text style={styles.addLink} onPress={() => navigation.navigate("SiteMap", { inspectionId })}>
            {hasSiteMapImage ? "Open site map" : "Set up property site plan"}
          </Text>
        </Card>
      </View>

      <WorkspaceSection
        title="Findings"
        count={detail.findings.length}
        onAdd={() => navigation.navigate("FindingForm", { inspectionId })}
        addLabel="+ Add finding"
      >
        {detail.findings.map((f) => (
          <Card key={f.id} style={styles.itemCard}>
            <Text style={styles.itemTitle}>{f.areaLocation}</Text>
            <Text style={styles.itemMeta}>
              {f.severity} · {f.photos.length} photo(s)
            </Text>
          </Card>
        ))}
      </WorkspaceSection>

      <WorkspaceSection
        title="Recommendations"
        count={detail.recommendations.length}
        onAdd={() => navigation.navigate("RecommendationForm", { inspectionId })}
        addLabel="+ Add recommendation"
      >
        {detail.recommendations.map((r) => (
          <Card key={r.id} style={styles.itemCard}>
            <Text style={styles.itemTitle}>{r.title}</Text>
            <Text style={styles.itemMeta}>{r.priority}</Text>
          </Card>
        ))}
      </WorkspaceSection>

      <WorkspaceSection
        title="Treatments"
        count={detail.treatments.length}
        onAdd={() => navigation.navigate("TreatmentForm", { inspectionId })}
        addLabel="+ Add treatment"
      >
        {detail.treatments.map((t) => (
          <Card key={t.id} style={styles.itemCard}>
            <Text style={styles.itemTitle}>{t.method}</Text>
            <Text style={styles.itemMeta}>{t.products.length} product(s)</Text>
          </Card>
        ))}
      </WorkspaceSection>

      <Text style={styles.sectionTitle}>Signatures</Text>
      <View style={styles.signatureRow}>
        <SignatureSlot
          label="Customer"
          signed={hasCustomerSignature}
          onPress={() => navigation.navigate("SignatureCapture", { inspectionId, signerType: "CUSTOMER" })}
        />
        <SignatureSlot
          label="Technician"
          signed={hasTechnicianSignature}
          onPress={() => navigation.navigate("SignatureCapture", { inspectionId, signerType: "TECHNICIAN" })}
        />
      </View>

      <View style={styles.spacer} />
      {!isCompleted ? (
        <PrimaryButton
          title="Complete inspection"
          onPress={handleComplete}
          disabled={!hasCustomerSignature || !hasTechnicianSignature}
        />
      ) : (
        <Badge label="Inspection completed" tone="success" />
      )}
      {!isCompleted && (!hasCustomerSignature || !hasTechnicianSignature) ? (
        <Text style={styles.hint}>Both signatures are required to complete the inspection.</Text>
      ) : null}
    </ScrollView>
  );
}

function WorkspaceSection({
  title,
  count,
  addLabel,
  onAdd,
  children,
}: {
  title: string;
  count: number;
  addLabel: string;
  onAdd: () => void;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionTitle}>
          {title} ({count})
        </Text>
        <Text style={styles.addLink} onPress={onAdd}>
          {addLabel}
        </Text>
      </View>
      {children}
    </View>
  );
}

function SignatureSlot({ label, signed, onPress }: { label: string; signed: boolean; onPress: () => void }) {
  return (
    <Card style={[styles.signatureCard, signed && styles.signatureCardDone]}>
      <Text style={styles.itemTitle}>{label}</Text>
      <Text style={styles.addLink} onPress={onPress}>
        {signed ? "Re-sign" : "Capture signature"}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 40 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 },
  title: { fontSize: 20, fontWeight: "700", color: colors.text },
  meta: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  section: { marginTop: 16 },
  sectionHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  sectionTitle: { fontSize: 15, fontWeight: "700", color: colors.text },
  addLink: { color: colors.primary, fontWeight: "600", fontSize: 13 },
  removeLink: { color: colors.textMuted, fontWeight: "500", fontSize: 12, marginTop: 6 },
  addButton: { alignSelf: "flex-start" },
  addButtonText: { color: colors.primary, fontWeight: "600", fontSize: 15 },
  itemCard: { marginBottom: 6, gap: 2 },
  itemTitle: { fontSize: 14, fontWeight: "600", color: colors.text },
  itemMeta: { fontSize: 12, color: colors.textMuted },
  signatureRow: { flexDirection: "row", gap: 10, marginTop: 4 },
  signatureCard: { flex: 1, alignItems: "flex-start", gap: 8 },
  signatureCardDone: { borderColor: colors.primary },
  spacer: { height: 20 },
  hint: { color: colors.textMuted, fontSize: 12, textAlign: "center", marginTop: 8 },
});

import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { getWizardStepStatus } from "@pest-app/shared";
import { getCachedCustomer, getCachedProperty, getCachedTemplateSections, getCachedTemplates } from "../../db/cache";
import {
  completeLocalInspection,
  deleteLocalInspection,
  getLocalInspectionDetail,
  LocalInspectionDetail,
  setLocalInspectionTemplate,
} from "../../db/inspectionStore";
import { deleteInspection } from "../../api/inspections";
import { InspectionsStackParamList } from "../../navigation/navigationTypes";
import { Badge, Card, PrimaryButton, colors } from "../../components/ui";

type Props = NativeStackScreenProps<InspectionsStackParamList, "InspectionWorkspace">;

export default function InspectionWorkspaceScreen({ route, navigation }: Props) {
  const { inspectionId } = route.params;
  const [detail, setDetail] = useState<LocalInspectionDetail | null>(null);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);

  useFocusEffect(
    useCallback(() => {
      setDetail(getLocalInspectionDetail(inspectionId));
    }, [inspectionId])
  );

  if (!detail) return null;

  const property = getCachedProperty(detail.inspection.propertyId);
  const customer = getCachedCustomer(detail.inspection.customerId);
  // Every section, unfiltered - the wizard (not a category subset the
  // technician opted into) determines what's relevant, from the template's
  // full section list crossed with the property's applicability flags.
  const templateSections = detail.inspection.templateId ? getCachedTemplateSections(detail.inspection.templateId) : [];
  const wizardStatus = detail.inspection.templateId
    ? getWizardStepStatus(templateSections, detail.checklistResponses, property ?? undefined, detail.sectionSkips)
    : null;
  const resolvedStepCount = wizardStatus ? wizardStatus.steps.filter((s) => s.resolved).length : 0;
  const checklistResolved = !detail.inspection.templateId || Boolean(wizardStatus?.canComplete);
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

  // Discards a stray/duplicate in-progress inspection - e.g. one left behind
  // by a sync that never completed, which otherwise has no way to go away
  // (see deleteLocalInspection's comment: this schema has no delete UI at
  // all today, only Undo for the most recent site-map edit).
  function handleDiscard() {
    deleteLocalInspection(inspectionId);
    deleteInspection(inspectionId).catch(() => {});
    navigation.popToTop();
  }

  function handleAddChecklist(templateId: string) {
    setLocalInspectionTemplate(inspectionId, templateId);
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
          {wizardStatus ? (
            <Badge
              label={`${resolvedStepCount}/${wizardStatus.steps.length} steps`}
              tone={wizardStatus.canComplete ? "success" : "warning"}
            />
          ) : null}
        </View>
        {detail.inspection.templateId && wizardStatus ? (
          <Card style={styles.itemCard}>
            <View style={styles.wizardStepList}>
              {wizardStatus.steps.map((s) => (
                <View key={s.category} style={styles.wizardStepRow}>
                  <View style={[styles.wizardStepCheckbox, s.resolved && styles.wizardStepCheckboxChecked]}>
                    {s.resolved ? <Text style={styles.wizardStepCheckboxMark}>✓</Text> : null}
                  </View>
                  <Text style={styles.wizardStepLabel}>
                    {s.shortLabel}
                    {!s.required ? " (if applicable)" : ""}
                  </Text>
                </View>
              ))}
            </View>
            <Text style={styles.addLink} onPress={() => navigation.navigate("InspectionWizard", { inspectionId })}>
              {resolvedStepCount === 0 ? "Start checklist" : wizardStatus.canComplete ? "Review checklist" : "Continue checklist"}
            </Text>
            {resolvedStepCount > 0 ? (
              <Text style={styles.secondaryLink} onPress={() => navigation.navigate("Checklist", { inspectionId })}>
                View full checklist
              </Text>
            ) : null}
          </Card>
        ) : availableTemplates.length === 0 ? (
          <Text style={styles.itemMeta}>No checklist templates available offline yet.</Text>
        ) : availableTemplates.length === 1 ? (
          <Card style={styles.itemCard}>
            <Text style={styles.addLink} onPress={() => handleAddChecklist(availableTemplates[0].id)}>
              + Add Checklist
            </Text>
          </Card>
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

      <WorkspaceSection title="Recommendations" count={detail.recommendations.length}>
        {detail.recommendations.length === 0 ? (
          <Text style={styles.itemMeta}>Created automatically from each finding - nothing to enter here.</Text>
        ) : null}
        {detail.recommendations.map((r) => {
          // Auto-generated from a finding (Matt's ask - no re-typing the
          // same area/notes/severity a second time under Recommendations),
          // so the notes and photos shown here are the finding's own.
          const sourceFinding = r.findingId ? detail.findings.find((f) => f.id === r.findingId) : null;
          return (
            <Card key={r.id} style={styles.itemCard}>
              <Text style={styles.itemTitle}>{r.title}</Text>
              <Text style={styles.itemMeta}>
                {r.priority}
                {sourceFinding ? " · From finding" : ""}
              </Text>
              {r.description ? (
                <Text style={styles.itemMeta} numberOfLines={3}>
                  {r.description}
                </Text>
              ) : null}
              {sourceFinding && sourceFinding.photos.length > 0 ? (
                <View style={styles.recPhotoRow}>
                  {sourceFinding.photos.map((p) => (
                    <Image key={p.id} source={{ uri: p.localUri }} style={styles.recPhoto} />
                  ))}
                </View>
              ) : null}
            </Card>
          );
        })}
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
          disabled={!hasCustomerSignature || !hasTechnicianSignature || !checklistResolved}
        />
      ) : (
        <Badge label="Inspection completed" tone="success" />
      )}
      {!isCompleted && !checklistResolved ? (
        <Text style={styles.hint}>Finish the checklist before completing this inspection.</Text>
      ) : !isCompleted && (!hasCustomerSignature || !hasTechnicianSignature) ? (
        <Text style={styles.hint}>Both signatures are required to complete the inspection.</Text>
      ) : null}

      {!isCompleted ? (
        confirmingDiscard ? (
          <View style={styles.deleteConfirmRow}>
            <Text style={styles.deleteConfirmText}>Discard this inspection? This can't be undone.</Text>
            <View style={styles.buttonRow}>
              <Pressable onPress={handleDiscard} style={styles.deleteConfirmButton}>
                <Text style={styles.deleteConfirmButtonText}>Discard</Text>
              </Pressable>
              <Pressable onPress={() => setConfirmingDiscard(false)} style={styles.cancelConfirmButton}>
                <Text style={styles.cancelConfirmButtonText}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Text style={styles.deleteLink} onPress={() => setConfirmingDiscard(true)}>
            Discard inspection
          </Text>
        )
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
  addLabel?: string;
  onAdd?: () => void;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionTitle}>
          {title} ({count})
        </Text>
        {onAdd && addLabel ? (
          <Text style={styles.addLink} onPress={onAdd}>
            {addLabel}
          </Text>
        ) : null}
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
  secondaryLink: { color: colors.textMuted, fontWeight: "500", fontSize: 12, marginTop: 4 },
  itemCard: { marginBottom: 6, gap: 2 },
  wizardStepList: { gap: 2, marginBottom: 8 },
  wizardStepRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 3 },
  wizardStepCheckbox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg,
  },
  wizardStepCheckboxChecked: { backgroundColor: colors.primary, borderColor: colors.primary },
  wizardStepCheckboxMark: { color: "#fff", fontSize: 12, fontWeight: "700", lineHeight: 13 },
  wizardStepLabel: { fontSize: 13, fontWeight: "600", color: colors.text },
  itemTitle: { fontSize: 14, fontWeight: "600", color: colors.text },
  itemMeta: { fontSize: 12, color: colors.textMuted },
  recPhotoRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
  recPhoto: { width: 48, height: 48, borderRadius: 6 },
  signatureRow: { flexDirection: "row", gap: 10, marginTop: 4 },
  signatureCard: { flex: 1, alignItems: "flex-start", gap: 8 },
  signatureCardDone: { borderColor: colors.primary },
  spacer: { height: 20 },
  hint: { color: colors.textMuted, fontSize: 12, textAlign: "center", marginTop: 8 },
  buttonRow: { flexDirection: "row", gap: 10 },
  deleteLink: { color: colors.danger, fontWeight: "600", fontSize: 13, textAlign: "center", marginTop: 16 },
  deleteConfirmRow: { marginTop: 16, gap: 8 },
  deleteConfirmText: { color: colors.text, fontSize: 13, textAlign: "center" },
  deleteConfirmButton: { flex: 1, backgroundColor: colors.danger, borderRadius: 8, paddingVertical: 12, alignItems: "center" },
  deleteConfirmButtonText: { color: "#fff", fontWeight: "600" },
  cancelConfirmButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
  },
  cancelConfirmButtonText: { color: colors.text, fontWeight: "600" },
});

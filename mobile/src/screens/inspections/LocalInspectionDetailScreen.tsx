import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useMemo } from "react";
import { Image, ScrollView, StyleSheet, Text, View } from "react-native";
import { getCachedCustomer, getCachedProperty, getCachedTemplateSections } from "../../db/cache";
import { getLocalInspectionDetail } from "../../db/inspectionStore";
import { CHECKLIST_CATEGORY_LABEL, CHECKLIST_STATUS_LABEL, groupChecklistForDisplay } from "../../lib/checklist";
import { buildSiteMapPanels, parseSiteMapSketch } from "../../lib/siteMapSketch";
import { InspectionsStackParamList } from "../../navigation/navigationTypes";
import { SiteMapCanvas } from "../../components/ArrowCanvas";
import { Badge, Card, colors } from "../../components/ui";

type Props = NativeStackScreenProps<InspectionsStackParamList, "LocalInspectionDetail">;

export default function LocalInspectionDetailScreen({ route }: Props) {
  const { inspectionId } = route.params;
  const detail = useMemo(() => getLocalInspectionDetail(inspectionId), [inspectionId]);

  if (!detail) return null;

  const property = getCachedProperty(detail.inspection.propertyId);
  const customer = getCachedCustomer(detail.inspection.customerId);
  const templateSections = detail.inspection.templateId ? getCachedTemplateSections(detail.inspection.templateId) : [];
  const checklistSections = groupChecklistForDisplay(templateSections, detail.checklistResponses);
  const siteMapImageUri = property?.siteMapLocalUri || property?.siteMapImageUrl || null;
  const siteMapSketch = parseSiteMapSketch(property?.siteMapSketchJson);
  const siteMapPanels = buildSiteMapPanels(siteMapImageUri, siteMapSketch, detail.findings);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>{customer?.name ?? "Inspection"}</Text>
        <Badge label={detail.inspection.status.replace(/_/g, " ")} tone={detail.inspection.status === "COMPLETED" ? "success" : "default"} />
      </View>
      <Text style={styles.meta}>{property?.addressLine1}</Text>
      {detail.inspection.syncStatus === "synced" ? (
        <Badge label="Synced" tone="success" />
      ) : (
        <Badge label="Stored on this device — not yet synced" tone="warning" />
      )}

      {siteMapPanels.map((panel, i) => (
        <View key={i}>
          <Text style={styles.sectionTitle}>{panel.title}</Text>
          <SiteMapCanvas imageUri={panel.imageUri} arrows={panel.arrows} savedLines={panel.lines} labels={panel.labels} mode="view" />
        </View>
      ))}

      {checklistSections.map((section) => (
        <View key={section.category}>
          <Text style={styles.sectionTitle}>{CHECKLIST_CATEGORY_LABEL[section.category] ?? section.category}</Text>
          {section.items.map((item, i) => (
            <Card key={i} style={styles.card}>
              <View style={styles.rowTop}>
                <Text style={styles.cardTitle}>{item.prompt}</Text>
                <Badge
                  label={CHECKLIST_STATUS_LABEL[item.status] ?? item.status}
                  tone={item.status === "NEEDS_ATTENTION" ? "danger" : item.status === "SATISFACTORY" ? "success" : "default"}
                />
              </View>
              {item.notes ? <Text style={styles.body}>{item.notes}</Text> : null}
            </Card>
          ))}
        </View>
      ))}

      <Text style={styles.sectionTitle}>Findings ({detail.findings.length})</Text>
      {detail.findings.map((f) => (
        <Card key={f.id} style={styles.card}>
          <View style={styles.rowTop}>
            <Text style={styles.cardTitle}>{f.areaLocation}</Text>
            <Badge label={f.severity} tone={f.severity === "CRITICAL" || f.severity === "HIGH" ? "danger" : "warning"} />
          </View>
          {f.description ? <Text style={styles.body}>{f.description}</Text> : null}
          <View style={styles.photoRow}>
            {f.photos.map((p) => (
              <Image key={p.id} source={{ uri: p.localUri }} style={styles.photoThumb} />
            ))}
          </View>
        </Card>
      ))}

      <Text style={styles.sectionTitle}>Recommendations ({detail.recommendations.length})</Text>
      {detail.recommendations.map((r) => (
        <Card key={r.id} style={styles.card}>
          <Text style={styles.cardTitle}>{r.title}</Text>
          <Text style={styles.meta}>{r.priority}</Text>
        </Card>
      ))}

      <Text style={styles.sectionTitle}>Treatments ({detail.treatments.length})</Text>
      {detail.treatments.map((t) => (
        <Card key={t.id} style={styles.card}>
          <Text style={styles.cardTitle}>{t.method}</Text>
          {t.products.map((p) => (
            <Text key={p.id} style={styles.body}>
              • {p.productName} — {p.quantity} {p.unit}
            </Text>
          ))}
        </Card>
      ))}

      <Text style={styles.sectionTitle}>Signatures ({detail.signatures.length})</Text>
      {detail.signatures.map((s) => (
        <Card key={s.id} style={styles.card}>
          <Text style={styles.cardTitle}>
            {s.signerName} ({s.signerType})
          </Text>
          <Image source={{ uri: s.imageBase64 }} style={styles.signatureImage} resizeMode="contain" />
        </Card>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 4 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { fontSize: 20, fontWeight: "700", color: colors.text },
  meta: { fontSize: 13, color: colors.textMuted, marginTop: 2, marginBottom: 8 },
  sectionTitle: { fontSize: 15, fontWeight: "700", color: colors.text, marginTop: 18, marginBottom: 8 },
  card: { marginBottom: 8, gap: 2 },
  cardTitle: { fontSize: 14, fontWeight: "600", color: colors.text },
  body: { fontSize: 14, color: colors.text, marginTop: 4 },
  rowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  photoRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  photoThumb: { width: 60, height: 60, borderRadius: 6 },
  signatureImage: { width: "100%", height: 80, marginTop: 8, backgroundColor: "#fff" },
});

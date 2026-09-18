import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useState } from "react";
import { Image, ScrollView, StyleSheet, Text, View } from "react-native";
import { getInspection } from "../../api/inspections";
import { API_BASE_URL } from "../../api/config";
import { generateReport, getReport } from "../../api/reports";
import { ApiError } from "../../api/client";
import { downloadAndShareReport } from "../../lib/report";
import { CHECKLIST_CATEGORY_LABEL, CHECKLIST_STATUS_LABEL, groupChecklistForDisplay } from "../../lib/checklist";
import { buildSiteMapPanels, parseSiteMapSketch } from "../../lib/siteMapSketch";
import { InspectionsStackParamList } from "../../navigation/navigationTypes";
import { SiteMapCanvas } from "../../components/ArrowCanvas";
import { AuthImage } from "../../components/AuthImage";
import { FindingsAndRecommendations } from "../../components/FindingsAndRecommendations";
import { Badge, Card, ErrorView, LoadingView, PrimaryButton, colors } from "../../components/ui";

type Props = NativeStackScreenProps<InspectionsStackParamList, "InspectionDetail">;

export default function InspectionDetailScreen({ route }: Props) {
  const { inspectionId } = route.params;
  const queryClient = useQueryClient();
  const [reportError, setReportError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);

  const { data: inspection, isLoading, isError } = useQuery({
    queryKey: ["inspections", inspectionId],
    queryFn: () => getInspection(inspectionId),
  });

  const { data: report } = useQuery({
    queryKey: ["reports", inspectionId],
    queryFn: () => getReport(inspectionId),
    enabled: inspection?.status === "COMPLETED",
    retry: false,
  });

  const generateMutation = useMutation({
    mutationFn: () => generateReport(inspectionId),
    onSuccess: () => {
      setReportError(null);
      queryClient.invalidateQueries({ queryKey: ["reports", inspectionId] });
    },
    onError: (err) => setReportError(err instanceof ApiError ? err.message : "Failed to generate report"),
  });

  async function handleShare(reportId: string) {
    setSharing(true);
    try {
      await downloadAndShareReport(reportId, inspectionId);
    } catch (err) {
      setReportError(err instanceof Error ? err.message : "Failed to share report");
    } finally {
      setSharing(false);
    }
  }

  if (isLoading) return <LoadingView />;
  if (isError || !inspection) return <ErrorView message="Failed to load inspection" />;

  const checklistSections = groupChecklistForDisplay(inspection.template?.sections ?? [], inspection.checklistResponses);
  const siteMapSketch = parseSiteMapSketch(inspection.property.siteMapSketch);
  const siteMapPanels = buildSiteMapPanels(inspection.property.siteMapImageUrl ?? null, siteMapSketch, inspection.findings);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>{inspection.customer.name}</Text>
        <Badge label={inspection.status.replace(/_/g, " ")} tone={inspection.status === "COMPLETED" ? "success" : "default"} />
      </View>
      <Text style={styles.meta}>{inspection.property.addressLine1}</Text>

      {inspection.status === "COMPLETED" ? (
        <Card style={styles.reportCard}>
          <Text style={styles.cardTitle}>Report</Text>
          {report ? (
            <>
              <Text style={styles.meta}>
                Version {report.version} · generated {new Date(report.generatedAt).toLocaleString()}
              </Text>
              <View style={styles.buttonRow}>
                <View style={styles.buttonHalf}>
                  <PrimaryButton title="Regenerate" onPress={() => generateMutation.mutate()} loading={generateMutation.isPending} />
                </View>
                <View style={styles.buttonHalf}>
                  <PrimaryButton title="Share PDF" onPress={() => handleShare(report.id)} loading={sharing} />
                </View>
              </View>
            </>
          ) : (
            <PrimaryButton title="Generate report" onPress={() => generateMutation.mutate()} loading={generateMutation.isPending} />
          )}
          {reportError ? <Text style={styles.errorText}>{reportError}</Text> : null}
        </Card>
      ) : null}

      {siteMapPanels.map((panel, i) => (
        <View key={i}>
          <Text style={styles.sectionTitle}>{panel.title}</Text>
          <SiteMapCanvas
            imageUri={panel.imageUri}
            arrows={panel.arrows}
            savedLines={panel.lines}
            labels={panel.labels}
            annotations={panel.annotations}
            mode="view"
          />
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
              {item.photos.length > 0 ? (
                <View style={styles.photoRow}>
                  {item.photos.map((p) => (
                    <AuthImage key={p.id} uri={`${API_BASE_URL}${p.fileUrl}`} style={styles.photoThumb} />
                  ))}
                </View>
              ) : null}
            </Card>
          ))}
        </View>
      ))}

      <FindingsAndRecommendations
        findings={inspection.findings.map((f) => ({
          id: f.id,
          areaLocation: f.areaLocation,
          severity: f.severity,
          description: f.description ?? null,
          photoUris: f.photos.map((p) => `${API_BASE_URL}${p.fileUrl}`),
          recommendationPriority: inspection.recommendations.find((r) => r.findingId === f.id)?.priority ?? null,
        }))}
        standalone={inspection.recommendations
          .filter((r) => !r.findingId || !inspection.findings.some((f) => f.id === r.findingId))
          .map((r) => ({ id: r.id, title: r.title, priority: r.priority, description: r.description ?? null }))}
      />

      <Text style={styles.sectionTitle}>Signatures ({inspection.signatures.length})</Text>
      {inspection.signatures.map((sig) => (
        <Card key={sig.id} style={styles.card}>
          <Text style={styles.cardTitle}>
            {sig.signerName} ({sig.signerType})
          </Text>
          <AuthImage uri={`${API_BASE_URL}${sig.imageUrl}`} style={styles.signatureImage} resizeMode="contain" />
          <Text style={styles.meta}>{new Date(sig.signedAt).toLocaleString()}</Text>
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
  meta: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  body: { fontSize: 14, color: colors.text, marginTop: 4 },
  sectionTitle: { fontSize: 15, fontWeight: "700", color: colors.text, marginTop: 18, marginBottom: 8 },
  card: { marginBottom: 8, gap: 2 },
  reportCard: { marginTop: 12, gap: 4 },
  cardTitle: { fontSize: 14, fontWeight: "600", color: colors.text },
  rowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  buttonRow: { flexDirection: "row", gap: 10, marginTop: 8 },
  buttonHalf: { flex: 1 },
  errorText: { color: colors.danger, fontSize: 12, marginTop: 6 },
  spacerSmall: { height: 8 },
  photoRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  photoThumb: { width: 60, height: 60, borderRadius: 6 },
  signatureImage: { width: "100%", height: 80, marginTop: 8, backgroundColor: "#fff" },
});

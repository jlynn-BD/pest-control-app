import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { getInspection } from "../../api/inspections";
import { generateReport, getReport } from "../../api/reports";
import { ApiError } from "../../api/client";
import { downloadAndShareReport } from "../../lib/report";
import { CHECKLIST_CATEGORY_LABEL, CHECKLIST_STATUS_LABEL, groupChecklistForDisplay } from "../../lib/checklist";
import { buildSiteMapPanels, parseSiteMapSketch } from "../../lib/siteMapSketch";
import { InspectionsStackParamList } from "../../navigation/navigationTypes";
import { SiteMapCanvas } from "../../components/ArrowCanvas";
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

      <Text style={styles.sectionTitle}>Findings ({inspection.findings.length})</Text>
      {inspection.findings.map((finding) => (
        <Card key={finding.id} style={styles.card}>
          <View style={styles.rowTop}>
            <Text style={styles.cardTitle}>{finding.areaLocation}</Text>
            <Badge
              label={finding.severity}
              tone={finding.severity === "CRITICAL" || finding.severity === "HIGH" ? "danger" : "warning"}
            />
          </View>
          {finding.pestTypeOther ? <Text style={styles.meta}>{finding.pestTypeOther}</Text> : null}
          {finding.description ? <Text style={styles.body}>{finding.description}</Text> : null}
          <Text style={styles.meta}>{finding.photos.length} photo(s)</Text>
        </Card>
      ))}

      <Text style={styles.sectionTitle}>Recommendations ({inspection.recommendations.length})</Text>
      {inspection.recommendations.map((rec) => (
        <Card key={rec.id} style={styles.card}>
          <View style={styles.rowTop}>
            <Text style={styles.cardTitle}>{rec.title}</Text>
            <Badge label={rec.priority} tone={rec.priority === "URGENT" || rec.priority === "HIGH" ? "danger" : "default"} />
          </View>
          <Text style={styles.meta}>Status: {rec.status.replace(/_/g, " ")}</Text>
        </Card>
      ))}

      <Text style={styles.sectionTitle}>Treatments ({inspection.treatmentRecords.length})</Text>
      {inspection.treatmentRecords.map((treatment) => (
        <Card key={treatment.id} style={styles.card}>
          <Text style={styles.cardTitle}>{treatment.method}</Text>
          <Text style={styles.meta}>Approval: {treatment.approvalStatus}</Text>
          {treatment.products.map((p) => (
            <Text key={p.id} style={styles.body}>
              • {p.productName} — {p.quantity} {p.unit}
            </Text>
          ))}
        </Card>
      ))}

      <Text style={styles.sectionTitle}>Signatures ({inspection.signatures.length})</Text>
      {inspection.signatures.map((sig) => (
        <Card key={sig.id} style={styles.card}>
          <Text style={styles.cardTitle}>
            {sig.signerName} ({sig.signerType})
          </Text>
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
});

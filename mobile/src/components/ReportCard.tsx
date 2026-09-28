import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { ApiError } from "../api/client";
import { generateReport, getReport } from "../api/reports";
import { downloadAndShareReport } from "../lib/report";
import { Card, PrimaryButton, colors } from "./ui";

// Generate / regenerate / share the PDF report for a completed inspection.
// Shared by the server-backed and on-device detail screens so both offer it.
export function ReportCard({ inspectionId }: { inspectionId: string }) {
  const queryClient = useQueryClient();
  const [reportError, setReportError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);

  const { data: report } = useQuery({
    queryKey: ["reports", inspectionId],
    queryFn: () => getReport(inspectionId),
    retry: false,
  });

  const generateMutation = useMutation({
    mutationFn: () => generateReport(inspectionId),
    onSuccess: () => {
      setReportError(null);
      queryClient.invalidateQueries({ queryKey: ["reports", inspectionId] });
    },
    onError: (err) => setReportError(err instanceof ApiError ? err.message : "Failed to generate report - check your connection and try again."),
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

  return (
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
  );
}

const styles = StyleSheet.create({
  reportCard: { marginTop: 12, marginBottom: 4, gap: 4 },
  cardTitle: { fontSize: 14, fontWeight: "600", color: colors.text },
  meta: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  buttonRow: { flexDirection: "row", gap: 10, marginTop: 8 },
  buttonHalf: { flex: 1 },
  errorText: { color: colors.danger, fontSize: 12, marginTop: 6 },
});

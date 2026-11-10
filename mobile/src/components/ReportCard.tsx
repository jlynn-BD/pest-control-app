import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { ApiError } from "../api/client";
import { emailReportToCustomer, generateReport, getReport } from "../api/reports";
import { downloadAndShareReport } from "../lib/report";
import { Card, PrimaryButton, colors, fonts } from "./ui";

// Generate / regenerate / share the PDF report for a completed inspection.
// Shared by the server-backed and on-device detail screens so both offer it.
//
// readOnly: someone else's inspection - the report can be opened and shared
// but not generated, regenerated or emailed from here.
export function ReportCard({ inspectionId, readOnly = false }: { inspectionId: string; readOnly?: boolean }) {
  const queryClient = useQueryClient();
  const [reportError, setReportError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [emailNote, setEmailNote] = useState<string | null>(null);

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

  const emailMutation = useMutation({
    mutationFn: () => emailReportToCustomer(inspectionId),
    onSuccess: (result) => {
      setReportError(null);
      setEmailNote(`Sent to ${result.maskedTo}`);
      queryClient.invalidateQueries({ queryKey: ["reports", inspectionId] });
    },
    onError: (err) => {
      setEmailNote(null);
      setReportError(err instanceof ApiError ? err.message : "Couldn't send the email - check your connection and try again.");
    },
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
            {readOnly ? null : (
              <View style={styles.buttonHalf}>
                <PrimaryButton title="Regenerate" onPress={() => generateMutation.mutate()} loading={generateMutation.isPending} />
              </View>
            )}
            <View style={styles.buttonHalf}>
              <PrimaryButton title="Share PDF" onPress={() => handleShare(report.id)} loading={sharing} variant="cta" />
            </View>
          </View>
          {readOnly ? null : <Text style={styles.meta}>
            {emailNote ??
              (report.customerEmailedAt
                ? `Emailed to the customer (${report.customerEmailedTo}) on ${new Date(report.customerEmailedAt).toLocaleString()}`
                : "Not emailed to the customer yet. It is sent automatically once you and the customer have both signed.")}
          </Text>}
          {readOnly ? null : (
            <PrimaryButton
              title={report.customerEmailedAt ? "Email to customer again" : "Email to customer"}
              onPress={() => emailMutation.mutate()}
              loading={emailMutation.isPending}
              variant="navy"
            />
          )}
        </>
      ) : readOnly ? (
        <Text style={styles.meta}>No report has been generated for this inspection yet.</Text>
      ) : (
        <PrimaryButton title="Generate report" onPress={() => generateMutation.mutate()} loading={generateMutation.isPending} variant="cta" />
      )}
      {reportError ? <Text style={styles.errorText}>{reportError}</Text> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  reportCard: { marginTop: 12, marginBottom: 4, gap: 4 },
  cardTitle: { fontFamily: fonts.display, fontSize: 14, fontWeight: "600", color: colors.text },
  meta: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  buttonRow: { flexDirection: "row", gap: 10, marginTop: 8 },
  buttonHalf: { flex: 1 },
  errorText: { color: colors.danger, fontSize: 12, marginTop: 6 },
});

import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { AuthImage } from "./AuthImage";
import { Badge, Card, colors } from "./ui";

export interface FindingRow {
  id: string;
  areaLocation: string;
  severity: string;
  description: string | null;
  photoUris: string[];
  recommendationPriority: string | null;
}

export interface StandaloneRecommendationRow {
  id: string;
  title: string;
  priority: string;
  description: string | null;
}

// One list for a finished inspection: every finding already carries the
// recommendation generated from it (Matt's "no second entry" ask), so
// listing Findings and Recommendations separately just repeated each item.
export function FindingsAndRecommendations({
  findings,
  standalone,
}: {
  findings: FindingRow[];
  standalone: StandaloneRecommendationRow[];
}) {
  return (
    <View>
      <Text style={styles.sectionTitle}>Findings & Recommendations ({findings.length + standalone.length})</Text>
      {findings.map((f) => (
        <Card key={f.id} style={styles.card}>
          <View style={styles.rowTop}>
            <Text style={styles.cardTitle}>{f.areaLocation}</Text>
            <Badge label={f.severity} tone={f.severity === "CRITICAL" || f.severity === "HIGH" ? "danger" : "warning"} />
          </View>
          {f.recommendationPriority ? <Text style={styles.meta}>Recommendation: {f.recommendationPriority}</Text> : null}
          {f.description ? <Text style={styles.body}>{f.description}</Text> : null}
          {f.photoUris.length > 0 ? (
            <View style={styles.photoRow}>
              {f.photoUris.map((uri) => (
                <AuthImage key={uri} uri={uri} style={styles.photoThumb} />
              ))}
            </View>
          ) : null}
        </Card>
      ))}
      {standalone.map((r) => (
        <Card key={r.id} style={styles.card}>
          <View style={styles.rowTop}>
            <Text style={styles.cardTitle}>{r.title}</Text>
            <Badge label={r.priority} tone={r.priority === "URGENT" || r.priority === "HIGH" ? "danger" : "default"} />
          </View>
          {r.description ? <Text style={styles.body}>{r.description}</Text> : null}
        </Card>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  sectionTitle: { fontSize: 15, fontWeight: "700", color: colors.text, marginTop: 18, marginBottom: 8 },
  card: { marginBottom: 8, gap: 2 },
  cardTitle: { fontSize: 14, fontWeight: "600", color: colors.text },
  meta: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  body: { fontSize: 14, color: colors.text, marginTop: 4 },
  rowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  photoRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  photoThumb: { width: 60, height: 60, borderRadius: 6 },
});

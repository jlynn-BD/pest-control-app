import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { CHECKLIST_CATEGORY_LABEL } from "../lib/checklist";
import { PhotoThumb } from "./PhotoThumb";
import { Card, colors, fonts } from "./ui";

export interface AreaNotInspected {
  category: string;
  // "NOT_ACCESSIBLE" (exists, couldn't be inspected) or "NOT_PRESENT".
  kind?: string | null;
  reason?: string | null;
  initials: string;
  confirmedAt: string;
  photoUris: string[];
}

// Read-only list of the checklist areas that weren't inspected on a finished
// inspection, with - for "not accessible" - why and the photo of it.
export function AreasNotInspected({ areas }: { areas: AreaNotInspected[] }) {
  if (areas.length === 0) return null;
  return (
    <View>
      <Text style={styles.title}>Areas not inspected ({areas.length})</Text>
      {areas.map((a) => (
        <Card key={a.category} style={styles.card}>
          <Text style={styles.name}>
            {CHECKLIST_CATEGORY_LABEL[a.category] ?? a.category} - {a.kind === "NOT_ACCESSIBLE" ? "not accessible" : "not present"}
          </Text>
          {a.reason ? <Text style={styles.body}>{a.reason}</Text> : null}
          {a.photoUris.length > 0 ? (
            <View style={styles.photoRow}>
              {a.photoUris.map((uri) => (
                <PhotoThumb key={uri} uri={uri} style={styles.thumb} />
              ))}
            </View>
          ) : null}
          <Text style={styles.meta}>
            Confirmed by {a.initials} · {new Date(a.confirmedAt).toLocaleString()}
          </Text>
        </Card>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontFamily: fonts.display, fontSize: 15, fontWeight: "700", color: colors.text, marginTop: 16, marginBottom: 8 },
  card: { marginBottom: 8, gap: 6 },
  name: { fontFamily: fonts.display, fontSize: 14, fontWeight: "600", color: colors.text },
  body: { fontSize: 14, color: colors.text },
  meta: { fontSize: 12, color: colors.textMuted },
  photoRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  thumb: { width: 80, height: 80, borderRadius: 8 },
});

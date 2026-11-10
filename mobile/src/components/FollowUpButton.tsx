import { useNavigation } from "@react-navigation/native";
import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { listInspections } from "../api/inspections";
import { listLocalInspections } from "../db/inspectionStore";
import { useAuth } from "../context/AuthContext";
import { createFollowUpInspection } from "../lib/followUp";
import { PrimaryButton, colors } from "./ui";

// "Start follow-up inspection": a new inspection at the same property that
// begins from a completed one - earlier issues are carried over to be marked
// still present or resolved - instead of from scratch.
export function FollowUpButton({ sourceInspectionId, propertyId, label }: { sourceInspectionId: string; propertyId: string; label?: string }) {
  const { user } = useAuth();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const navigation = useNavigation<any>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    if (!user || busy) return;
    setBusy(true);
    setError(null);
    try {
      // One open inspection per property per technician (see NewInspectionScreen).
      let existing = listLocalInspections(user.id).find((i) => i.propertyId === propertyId && i.status !== "COMPLETED")?.id ?? null;
      if (!existing) {
        try {
          existing = (await listInspections({ technicianId: user.id, status: "IN_PROGRESS" })).find((r) => r.propertyId === propertyId)?.id ?? null;
        } catch {
          // offline - the local check is all there is
        }
      }
      if (existing) {
        setError("You already have an inspection in progress at this property. Finish or continue that one first (it is on the home screen).");
        return;
      }
      const inspection = await createFollowUpInspection(sourceInspectionId, user.id);
      const root = navigation.getParent?.() ?? navigation;
      root.navigate("Inspections", { screen: "InspectionWorkspace", params: { inspectionId: inspection.id } });
    } catch (err) {
      setError(err instanceof Error && err.message.startsWith("Only") ? err.message : "Couldn't start the follow-up - check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.wrap}>
      <PrimaryButton title={label ?? "Start follow-up inspection"} onPress={start} loading={busy} variant="cta" />
      <Text style={styles.hint}>Starts from this inspection: earlier issues are carried over so you only mark each one still present or resolved.</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6, marginTop: 8, marginBottom: 4 },
  hint: { fontSize: 12, color: colors.textMuted },
  error: { fontSize: 13, color: colors.danger },
});

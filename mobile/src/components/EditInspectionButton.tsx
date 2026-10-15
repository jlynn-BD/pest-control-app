import { useNavigation } from "@react-navigation/native";
import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { reopenLocalInspection } from "../db/inspectionStore";
import { ensureLocalInspection } from "../lib/resumeInspection";
import { runSync } from "../sync/syncEngine";
import { PrimaryButton, colors } from "./ui";

// "I forgot something": opens a finished inspection back up so the checklist,
// site map, findings, photos and notes can be changed. It goes back to "in
// progress"; finishing it again and regenerating the report puts the changes
// in the report.
export function EditInspectionButton({ inspectionId }: { inspectionId: string }) {
  const navigation = useNavigation<any>();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reopen() {
    setBusy(true);
    setError(null);
    try {
      // An inspection finished on another device has to be loaded onto this one first.
      await ensureLocalInspection(inspectionId);
      reopenLocalInspection(inspectionId);
      runSync().catch(() => {});
      navigation.navigate("Inspections", { screen: "InspectionWorkspace", params: { inspectionId }, initial: false });
    } catch {
      setError("Couldn't open it for editing - check your connection and try again.");
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  if (!confirming) {
    return (
      <View>
        <PrimaryButton title="Edit inspection" onPress={() => setConfirming(true)} />
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    );
  }
  return (
    <View style={styles.box}>
      <Text style={styles.text}>
        Open this inspection back up to make changes? It goes back to "in progress". When you're done, complete it again and regenerate the report so the report includes your changes.
      </Text>
      <View style={styles.row}>
        <View style={styles.half}>
          <PrimaryButton title="Yes, edit it" onPress={reopen} loading={busy} />
        </View>
        <View style={styles.half}>
          <PrimaryButton title="Cancel" onPress={() => setConfirming(false)} disabled={busy} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, backgroundColor: colors.card },
  text: { fontSize: 14, color: colors.text, lineHeight: 20 },
  row: { flexDirection: "row", gap: 10 },
  half: { flex: 1 },
  error: { color: colors.danger, marginTop: 6 },
});

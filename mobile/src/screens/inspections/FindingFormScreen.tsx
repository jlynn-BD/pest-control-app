import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useLayoutEffect } from "react";
import { ScrollView, StyleSheet } from "react-native";
import { getLocalInspectionDetail } from "../../db/inspectionStore";
import { InspectionsStackParamList } from "../../navigation/navigationTypes";
import { FindingEditorForm } from "../../components/FindingEditorForm";
import { colors } from "../../components/ui";

type Props = NativeStackScreenProps<InspectionsStackParamList, "FindingForm">;

// Thin routed wrapper around FindingEditorForm, used for entry points that
// don't touch the site map (e.g. "+ Add finding" from the workspace's
// Findings list). Every map-marker flow instead renders FindingEditorForm
// directly inside SiteMapScreen so the map stays visible - see that
// screen's inline editor panel.
export default function FindingFormScreen({ route, navigation }: Props) {
  const { inspectionId, editingFindingId } = route.params;

  useLayoutEffect(() => {
    if (!editingFindingId) return;
    const exists = getLocalInspectionDetail(inspectionId)?.findings.some((f) => f.id === editingFindingId);
    if (exists) navigation.setOptions({ title: "Edit Finding" });
  }, [inspectionId, editingFindingId, navigation]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <FindingEditorForm {...route.params} onSaved={() => navigation.goBack()} onCancel={() => navigation.goBack()} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 40 },
});

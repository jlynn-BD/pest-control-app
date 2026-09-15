import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React from "react";
import { ScrollView, StyleSheet } from "react-native";
import { ChecklistPanel } from "../../components/ChecklistPanel";
import { InspectionsStackParamList } from "../../navigation/navigationTypes";
import { colors } from "../../components/ui";

type Props = NativeStackScreenProps<InspectionsStackParamList, "Checklist">;

// Thin wrapper around ChecklistPanel (the actual checklist UI lives there
// now, shared with SiteMapScreen's embedded copy - see that file's comment).
// This route stays around as the full-page entry point from the "Open
// checklist" link on InspectionWorkspaceScreen.
export default function ChecklistScreen({ route, navigation }: Props) {
  const { inspectionId } = route.params;
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <ChecklistPanel
        inspectionId={inspectionId}
        onAddToSiteMap={(responseId) => navigation.navigate("SiteMap", { inspectionId, fromChecklistResponseId: responseId })}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 40 },
});

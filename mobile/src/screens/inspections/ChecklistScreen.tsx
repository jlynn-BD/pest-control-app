import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { getWizardStepStatus } from "@pest-app/shared";
import React, { useCallback, useState } from "react";
import { ScrollView, StyleSheet } from "react-native";
import { ChecklistPanel } from "../../components/ChecklistPanel";
import { getCachedProperty, getCachedTemplateSections } from "../../db/cache";
import { getLocalInspectionDetail } from "../../db/inspectionStore";
import { InspectionsStackParamList } from "../../navigation/navigationTypes";
import { colors } from "../../components/ui";

type Props = NativeStackScreenProps<InspectionsStackParamList, "Checklist">;

// Thin wrapper around ChecklistPanel (the actual checklist UI lives there
// now, shared with SiteMapScreen's embedded copy - see that file's comment).
// This route is the "review everything at once" entry point (from
// InspectionWorkspaceScreen's "View full checklist" link) - unlike the
// step-by-step wizard, it's restricted to categories the wizard has already
// unlocked (not just the current step) so a technician can browse/edit
// anything reached so far without being able to jump ahead out of sequence.
export default function ChecklistScreen({ route, navigation }: Props) {
  const { inspectionId } = route.params;
  const [allowedCategories, setAllowedCategories] = useState<string[] | undefined>(undefined);

  useFocusEffect(
    useCallback(() => {
      const detail = getLocalInspectionDetail(inspectionId);
      if (!detail?.inspection.templateId) {
        setAllowedCategories(undefined);
        return;
      }
      const property = getCachedProperty(detail.inspection.propertyId);
      const sections = getCachedTemplateSections(detail.inspection.templateId);
      const status = getWizardStepStatus(sections, detail.checklistResponses, property ?? undefined, detail.sectionSkips);
      setAllowedCategories(status.steps.slice(0, status.furthestUnlockedIndex + 1).map((s) => s.category));
    }, [inspectionId])
  );

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <ChecklistPanel
        inspectionId={inspectionId}
        allowedCategories={allowedCategories}
        onAddToSiteMap={(responseId) => navigation.navigate("SiteMap", { inspectionId, fromChecklistResponseId: responseId })}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 40 },
});

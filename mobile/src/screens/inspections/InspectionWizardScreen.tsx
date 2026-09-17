import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { getWizardStepStatus, WIZARD_STEPS, WizardStatus } from "@pest-app/shared";
import React, { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { patchPropertyApplicability } from "../../api/properties";
import { ChecklistPanel } from "../../components/ChecklistPanel";
import { Card, Checkbox, Field, PrimaryButton, colors } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { getCachedProperty, getCachedTemplateSections, updateLocalPropertyApplicability } from "../../db/cache";
import {
  createLocalInspectionSectionSkip,
  deleteLocalInspectionSectionSkip,
  getLocalInspectionDetail,
} from "../../db/inspectionStore";
import type { LocalInspectionSectionSkip, LocalProperty } from "../../db/types";
import { InspectionsStackParamList } from "../../navigation/navigationTypes";

type Props = NativeStackScreenProps<InspectionsStackParamList, "InspectionWizard">;

// Matt's ask: every technician walks Exterior -> First Floor -> Second Floor
// (if applicable) -> Third Floor (if applicable) -> Basement (if applicable)
// -> Crawl Space (if applicable) -> Attic, in that fixed order, every time -
// no picking which sections to bother with. A step can only be reached once
// every step before it is resolved (see getWizardStepStatus); a conditional
// step resolves either by answering it or by explicitly marking the
// property as not having that area - never by silently leaving it blank.
export default function InspectionWizardScreen({ route, navigation }: Props) {
  const { inspectionId } = route.params;
  const { user } = useAuth();
  const [property, setProperty] = useState<LocalProperty | null>(null);
  const [status, setStatus] = useState<WizardStatus | null>(null);
  const [sectionSkips, setSectionSkips] = useState<LocalInspectionSectionSkip[]>([]);
  const [stepIndex, setStepIndex] = useState(0);
  const [confirmingNotApplicable, setConfirmingNotApplicable] = useState(false);
  const [initials, setInitials] = useState("");
  const [savingApplicability, setSavingApplicability] = useState(false);

  const refresh = useCallback(() => {
    const detail = getLocalInspectionDetail(inspectionId);
    if (!detail?.inspection.templateId) return;
    const p = getCachedProperty(detail.inspection.propertyId);
    setProperty(p);
    setSectionSkips(detail.sectionSkips);
    const sections = getCachedTemplateSections(detail.inspection.templateId);
    const next = getWizardStepStatus(sections, detail.checklistResponses, p ?? undefined, detail.sectionSkips);
    setStatus(next);
    return next;
  }, [inspectionId]);

  useFocusEffect(
    useCallback(() => {
      const next = refresh();
      // Drop the technician at wherever they need to continue each time
      // this screen is (re)focused - manual Back/chip taps within a single
      // visit aren't affected, only re-entering the wizard fresh.
      if (next) setStepIndex(next.furthestUnlockedIndex);
      setConfirmingNotApplicable(false);
      setInitials("");
    }, [refresh])
  );

  if (!status || !property) return null;

  const step = status.steps[stepIndex];
  const stepDef = WIZARD_STEPS[stepIndex];
  const canGoNext = step.resolved;
  const isLastStep = stepIndex === status.steps.length - 1;
  // This inspection's own accountability record for this step, if the
  // technician has already confirmed it here - a property flag left over
  // from a PRIOR inspection (step.applicable === false with no skip here
  // yet) isn't the same thing, see getWizardStepStatus in
  // shared/src/constants/checklistWizard.ts.
  const mySkip = sectionSkips.find((s) => s.category === step.category) ?? null;
  const previouslyMarkedElsewhere = step.applicable === false && !mySkip;

  function goToStep(index: number) {
    if (index > status!.furthestUnlockedIndex) return;
    setConfirmingNotApplicable(false);
    setInitials("");
    setStepIndex(index);
  }

  function handleNext() {
    if (!canGoNext) return;
    if (isLastStep) {
      navigation.goBack();
      return;
    }
    goToStep(stepIndex + 1);
  }

  async function handleConfirmNotApplicable() {
    if (!stepDef.applicabilityField || !user || !initials.trim()) return;
    setSavingApplicability(true);
    updateLocalPropertyApplicability(property!.id, { [stepDef.applicabilityField]: 0 });
    patchPropertyApplicability(property!.id, { [stepDef.applicabilityField]: false }).catch(() => {});
    createLocalInspectionSectionSkip(inspectionId, step.category, user.id, initials.trim());
    refresh();
    setConfirmingNotApplicable(false);
    setInitials("");
    setSavingApplicability(false);
  }

  // Lets a technician undo a mistaken "not applicable" without leaving the
  // wizard - flips the property flag back to unknown so the step re-opens
  // for answering (a false "true" isn't meaningful the other direction:
  // answering the step's items is itself what marks it applicable), and
  // removes this inspection's sign-off since it's no longer accurate.
  function handleUndoNotApplicable() {
    if (!stepDef.applicabilityField) return;
    updateLocalPropertyApplicability(property!.id, { [stepDef.applicabilityField]: null });
    patchPropertyApplicability(property!.id, { [stepDef.applicabilityField]: null }).catch(() => {});
    deleteLocalInspectionSectionSkip(inspectionId, step.category);
    refresh();
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.progressList}>
        {status.steps.map((s, index) => {
          const reachable = index <= status.furthestUnlockedIndex;
          const active = index === stepIndex;
          return (
            <Pressable
              key={s.category}
              disabled={!reachable}
              onPress={() => goToStep(index)}
              style={[styles.stepRow, active && styles.stepRowActive, !reachable && styles.stepRowLocked]}
            >
              <View style={[styles.stepCheckbox, s.resolved && styles.stepCheckboxChecked]}>
                {s.resolved ? <Text style={styles.stepCheckboxMark}>✓</Text> : null}
              </View>
              <Text style={[styles.stepRowLabel, active && styles.stepRowLabelActive, !reachable && styles.stepRowLabelLocked]}>
                {s.shortLabel}
                {!s.required ? " (if applicable)" : ""}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.stepTitle}>{step.label}</Text>
      {!step.required ? (
        <Text style={styles.stepHint}>
          {mySkip
            ? `Marked as not applicable to ${property.addressLine1}.`
            : previouslyMarkedElsewhere
              ? "This property was previously marked as not having this area - please confirm that's still accurate for this inspection."
              : "If this property doesn't have this area, you can mark it not applicable instead of answering it."}
        </Text>
      ) : null}

      {!step.required && mySkip ? (
        <Card style={styles.naCard}>
          <Text style={styles.naText}>This property doesn't have a {step.shortLabel.toLowerCase()}.</Text>
          <Text style={styles.naMeta}>
            Confirmed by {mySkip.initials} · {new Date(mySkip.confirmedAt).toLocaleString()}
          </Text>
          <Text style={styles.secondaryLink} onPress={handleUndoNotApplicable}>
            Actually, it does - let me answer this
          </Text>
        </Card>
      ) : !step.required && previouslyMarkedElsewhere && !confirmingNotApplicable ? (
        <Card style={styles.naCard}>
          <Text style={styles.naText}>This property doesn't have a {step.shortLabel.toLowerCase()}.</Text>
          <PrimaryButton title="Confirm for this inspection" onPress={() => setConfirmingNotApplicable(true)} />
          <Text style={styles.secondaryLink} onPress={handleUndoNotApplicable}>
            Actually, it does - let me answer this
          </Text>
        </Card>
      ) : !step.required && confirmingNotApplicable ? (
        <Card style={styles.naConfirmCard}>
          <Text style={styles.naConfirmText}>
            I confirm this property does not have a {step.shortLabel.toLowerCase()}. This is recorded on this inspection's audit
            trail with your initials, name, and the time - Blue Duck can show exactly who signed off on this if it's ever
            questioned.
          </Text>
          <Field label="Technician initials" value={initials} onChangeText={setInitials} placeholder="e.g. JL" autoCapitalize="characters" maxLength={6} />
          <View style={styles.buttonRow}>
            <View style={styles.buttonHalf}>
              <PrimaryButton title="Confirm" onPress={handleConfirmNotApplicable} loading={savingApplicability} disabled={!initials.trim()} />
            </View>
            <View style={styles.buttonHalf}>
              <PrimaryButton title="Cancel" onPress={() => setConfirmingNotApplicable(false)} />
            </View>
          </View>
        </Card>
      ) : (
        <>
          <ChecklistPanel
            inspectionId={inspectionId}
            categoryFilter={step.category}
            hideCategoryHeader
            onChange={refresh}
            onAddToSiteMap={(responseId) => navigation.navigate("SiteMap", { inspectionId, fromChecklistResponseId: responseId })}
          />
          {!step.required ? (
            <Card style={styles.naTriggerCard}>
              <Checkbox
                label={`This property doesn't have a ${step.shortLabel.toLowerCase()}`}
                checked={false}
                onChange={() => setConfirmingNotApplicable(true)}
              />
            </Card>
          ) : null}
        </>
      )}

      {!canGoNext ? (
        <Text style={styles.blockedHint}>
          {step.itemsTotal - step.itemsAnswered} of {step.itemsTotal} required item(s) still need an answer.
        </Text>
      ) : null}

      <View style={styles.footerRow}>
        <View style={styles.buttonHalf}>
          <PrimaryButton title="Back" onPress={() => goToStep(stepIndex - 1)} disabled={stepIndex === 0} />
        </View>
        <View style={styles.buttonHalf}>
          <PrimaryButton title={isLastStep ? "Finish" : "Next"} onPress={handleNext} disabled={!canGoNext} />
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 40 },
  progressList: { gap: 2, marginBottom: 16 },
  stepRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  stepRowActive: { backgroundColor: colors.chip },
  stepRowLocked: { opacity: 0.4 },
  stepCheckbox: {
    width: 22,
    height: 22,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.card,
  },
  stepCheckboxChecked: { backgroundColor: colors.primary, borderColor: colors.primary },
  stepCheckboxMark: { color: "#fff", fontSize: 14, fontWeight: "700", lineHeight: 15 },
  stepRowLabel: { fontSize: 14, fontWeight: "600", color: colors.textMuted },
  stepRowLabelActive: { color: colors.text },
  stepRowLabelLocked: { color: colors.textMuted },
  stepTitle: { fontSize: 18, fontWeight: "700", color: colors.text, marginBottom: 4 },
  stepHint: { fontSize: 12, color: colors.textMuted, marginBottom: 12 },
  naCard: { gap: 8, marginBottom: 16 },
  naText: { fontSize: 14, color: colors.text },
  naMeta: { fontSize: 12, color: colors.textMuted },
  naConfirmCard: { marginTop: 12, gap: 8 },
  naTriggerCard: { marginTop: 12 },
  naConfirmText: { fontSize: 13, color: colors.text },
  secondaryLink: { color: colors.textMuted, fontWeight: "500", fontSize: 12, marginTop: 12, textAlign: "center" },
  blockedHint: { color: colors.textMuted, fontSize: 12, textAlign: "center", marginTop: 16 },
  buttonRow: { flexDirection: "row", gap: 10 },
  buttonHalf: { flex: 1 },
  footerRow: { flexDirection: "row", gap: 10, marginTop: 24 },
});

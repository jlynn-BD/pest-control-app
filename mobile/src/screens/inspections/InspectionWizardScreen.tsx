import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { getWizardStepStatus, WIZARD_STEPS, WizardStatus } from "@pest-app/shared";
import React, { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { patchPropertyApplicability } from "../../api/properties";
import { ChecklistPanel } from "../../components/ChecklistPanel";
import { PhotoThumb } from "../../components/PhotoThumb";
import { Card, Checkbox, Field, PrimaryButton, colors } from "../../components/ui";
import { capturePhoto, pickPhotosFromLibrary } from "../../lib/photo";
import { useAuth } from "../../context/AuthContext";
import { getCachedProperty, getCachedTemplateSections, updateLocalPropertyApplicability } from "../../db/cache";
import {
  addLocalInspectionPhoto,
  createLocalInspectionSectionSkip,
  deleteLocalInspectionSectionSkip,
  getLocalInspectionDetail,
} from "../../db/inspectionStore";
import type { LocalInspectionPhoto, LocalInspectionSectionSkip, LocalProperty } from "../../db/types";
import { useCompletedLock } from "../../lib/useCompletedLock";
import { InspectionsStackParamList } from "../../navigation/navigationTypes";

type Props = NativeStackScreenProps<InspectionsStackParamList, "InspectionWizard">;

// Every step - Exterior, First Floor, Second Floor, Third Floor, Basement,
// Attic, Crawl Space (the last five "if applicable") - has to be finished
// before the inspection can be completed, but they can be done in ANY order:
// technicians are usually invited inside and talk with the customer first, so
// every step is open from the start. A conditional step resolves either by
// answering it or by explicitly marking the property as not having that
// area - never by silently leaving it blank (see getWizardStepStatus).
export default function InspectionWizardScreen({ route, navigation }: Props) {
  const { inspectionId } = route.params;
  useCompletedLock(inspectionId, navigation);
  const { user } = useAuth();
  const [property, setProperty] = useState<LocalProperty | null>(null);
  const [propertyId, setPropertyId] = useState<string | null>(null);
  const [status, setStatus] = useState<WizardStatus | null>(null);
  const [sectionSkips, setSectionSkips] = useState<LocalInspectionSectionSkip[]>([]);
  const [stepIndex, setStepIndex] = useState(0);
  const [confirmingNotApplicable, setConfirmingNotApplicable] = useState(false);
  const [initials, setInitials] = useState("");
  const [savingApplicability, setSavingApplicability] = useState(false);
  // "This area is not accessible": why, the photo(s) of it, and initials - all required.
  const [confirmingNotAccessible, setConfirmingNotAccessible] = useState(false);
  const [naReason, setNaReason] = useState("");
  const [naPhotos, setNaPhotos] = useState<string[]>([]);
  const [sectionPhotos, setSectionPhotos] = useState<LocalInspectionPhoto[]>([]);

  const refresh = useCallback(() => {
    const detail = getLocalInspectionDetail(inspectionId);
    if (!detail?.inspection.templateId) return;
    const p = getCachedProperty(detail.inspection.propertyId);
    setProperty(p);
    setPropertyId(detail.inspection.propertyId);
    setSectionSkips(detail.sectionSkips);
    setSectionPhotos(detail.photos.filter((p) => p.sectionCategory));
    const sections = getCachedTemplateSections(detail.inspection.templateId);
    const next = getWizardStepStatus(sections, detail.checklistResponses, p ?? undefined, detail.sectionSkips);
    setStatus(next);
    return next;
  }, [inspectionId]);

  useFocusEffect(
    useCallback(() => {
      const next = refresh();
      // Drop the technician at wherever they need to continue each time
      // this screen is (re)focused (the step they are partway through, else
      // the first one not done) - manual Back/chip taps within a single
      // visit aren't affected, only re-entering the wizard fresh.
      if (next) setStepIndex(next.suggestedIndex);
      setConfirmingNotApplicable(false);
      resetNotAccessibleForm();
      setInitials("");
    }, [refresh])
  );

  // Nothing to walk through yet - say so instead of leaving a blank screen
  // (the local copy of the template/inspection hasn't loaded).
  if (!status) {
    return (
      <View style={styles.content}>
        <Text style={styles.naText}>The checklist isn't available on this device yet. Go back and open the inspection again while online.</Text>
      </View>
    );
  }

  const step = status.steps[stepIndex];
  const stepDef = WIZARD_STEPS[stepIndex];
  // The step to head to next: the next one not done after this (wrapping to an
  // earlier one that was left for later), or none once everything is done -
  // then the button reads "Finish" and returns to the inspection.
  const nextOpenIndex = (() => {
    const after = status.steps.findIndex((s, i) => i > stepIndex && !s.resolved);
    return after !== -1 ? after : status.steps.findIndex((s, i) => i < stepIndex && !s.resolved);
  })();
  const isLastStep = nextOpenIndex === -1;
  // "an attic", "a basement", "a 2nd floor" - the sentence reads wrong with a fixed "a".
  const areaName = step.shortLabel.toLowerCase();
  const areaWithArticle = `${/^[aeiou]/.test(areaName) ? "an" : "a"} ${areaName}`;
  // This inspection's own accountability record for this step, if the
  // technician has already confirmed it here - a property flag left over
  // from a PRIOR inspection (step.applicable === false with no skip here
  // yet) isn't the same thing, see getWizardStepStatus in
  // shared/src/constants/checklistWizard.ts.
  const mySkip = sectionSkips.find((s) => s.category === step.category) ?? null;
  const previouslyMarkedElsewhere = step.applicable === false && !mySkip;
  const notAccessible = mySkip?.kind === "NOT_ACCESSIBLE";
  const myAreaPhotos = sectionPhotos.filter((p) => p.sectionCategory === step.category);
  const naMissing = [!naReason.trim() ? "describe why" : null, naPhotos.length === 0 ? "add a photo" : null, !initials.trim() ? "enter your initials" : null].filter(Boolean);

  function resetNotAccessibleForm() {
    setConfirmingNotAccessible(false);
    setNaReason("");
    setNaPhotos([]);
  }

  async function addNaPhoto(source: "camera" | "library") {
    const uris = source === "camera" ? [await capturePhoto()].filter((u): u is string => Boolean(u)) : await pickPhotosFromLibrary();
    if (uris.length > 0) setNaPhotos((prev) => [...prev, ...uris]);
  }

  // The area exists but couldn't be reached (flooded crawl space, locked attic
  // hatch, ...): recorded with the reason, the photo(s) and the technician's
  // initials, and it counts as finished for this inspection. The property still
  // has the area, so its record is left alone.
  function handleConfirmNotAccessible() {
    if (!user || !initials.trim() || !naReason.trim() || naPhotos.length === 0) return;
    createLocalInspectionSectionSkip(inspectionId, step.category, user.id, initials.trim(), { kind: "NOT_ACCESSIBLE", reason: naReason.trim() });
    naPhotos.forEach((uri, i) => addLocalInspectionPhoto(inspectionId, { localUri: uri, caption: naReason.trim(), sortOrder: i, sectionCategory: step.category }));
    refresh();
    resetNotAccessibleForm();
    setInitials("");
  }

  function handleUndoNotAccessible() {
    deleteLocalInspectionSectionSkip(inspectionId, step.category);
    refresh();
  }

  function goToStep(index: number) {
    if (index > status!.furthestUnlockedIndex) return;
    resetNotAccessibleForm();
    setConfirmingNotApplicable(false);
    setInitials("");
    setStepIndex(index);
  }

  function handleNext() {
    if (isLastStep) {
      navigation.goBack();
      return;
    }
    goToStep(nextOpenIndex);
  }

  async function handleConfirmNotApplicable() {
    if (!stepDef.applicabilityField || !user || !initials.trim() || !propertyId) return;
    setSavingApplicability(true);
    updateLocalPropertyApplicability(propertyId!, { [stepDef.applicabilityField]: 0 });
    patchPropertyApplicability(propertyId!, { [stepDef.applicabilityField]: false }).catch(() => {});
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
    if (!stepDef.applicabilityField || !propertyId) return;
    updateLocalPropertyApplicability(propertyId!, { [stepDef.applicabilityField]: null });
    patchPropertyApplicability(propertyId!, { [stepDef.applicabilityField]: null }).catch(() => {});
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

      <Text style={styles.orderHint}>Start with whichever step fits the visit - they can be done in any order. All of them need to be finished to complete the inspection.</Text>

      <Text style={styles.stepTitle}>{step.label}</Text>
      {!step.required ? (
        <Text style={styles.stepHint}>
          {notAccessible
            ? "Marked as not accessible on this inspection."
            : mySkip
            ? `Marked as not applicable to ${property?.addressLine1 ?? "this property"}.`
            : previouslyMarkedElsewhere
              ? "This property was previously marked as not having this area - please confirm that's still accurate for this inspection."
              : "If this property doesn't have this area, you can mark it not applicable. If it has it but you can't get to it, mark it not accessible (with the reason and a photo)."}
        </Text>
      ) : null}

      {!step.required && notAccessible && mySkip ? (
        <Card style={styles.naCard}>
          <Text style={styles.naText}>This area is not accessible.</Text>
          {mySkip.reason ? <Text style={styles.naReasonText}>{mySkip.reason}</Text> : null}
          {myAreaPhotos.length > 0 ? (
            <View style={styles.naPhotoRow}>
              {myAreaPhotos.map((p) => (
                <PhotoThumb key={p.id} uri={p.localUri} style={styles.naThumb} />
              ))}
            </View>
          ) : null}
          <Text style={styles.naMeta}>
            Confirmed by {mySkip.initials} · {new Date(mySkip.confirmedAt).toLocaleString()}
          </Text>
          <Text style={styles.secondaryLink} onPress={handleUndoNotAccessible}>
            Actually, I can get in - let me answer this
          </Text>
        </Card>
      ) : !step.required && mySkip ? (
        <Card style={styles.naCard}>
          <Text style={styles.naText}>This property doesn't have {areaWithArticle}.</Text>
          <Text style={styles.naMeta}>
            Confirmed by {mySkip.initials} · {new Date(mySkip.confirmedAt).toLocaleString()}
          </Text>
          <Text style={styles.secondaryLink} onPress={handleUndoNotApplicable}>
            Actually, it does - let me answer this
          </Text>
        </Card>
      ) : !step.required && previouslyMarkedElsewhere && !confirmingNotApplicable ? (
        <Card style={styles.naCard}>
          <Text style={styles.naText}>This property doesn't have {areaWithArticle}.</Text>
          <PrimaryButton title="Confirm for this inspection" onPress={() => setConfirmingNotApplicable(true)} />
          <Text style={styles.secondaryLink} onPress={handleUndoNotApplicable}>
            Actually, it does - let me answer this
          </Text>
        </Card>
      ) : !step.required && confirmingNotApplicable ? (
        <Card style={styles.naConfirmCard}>
          <Text style={styles.naConfirmText}>
            I confirm this property does not have {areaWithArticle}. This is recorded on this inspection's audit
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
      ) : !step.required && confirmingNotAccessible ? (
        <Card style={styles.naConfirmCard}>
          <Text style={styles.naConfirmTitle}>This area is not accessible</Text>
          <Text style={styles.naConfirmText}>
            Describe why you couldn't inspect {areaName} (for example flooded, blocked, locked or unsafe) and take a photo that shows it. This is recorded
            with your initials and the time, and it goes in the report.
          </Text>
          <Field label="Why isn't it accessible?" value={naReason} onChangeText={setNaReason} placeholder="e.g. Crawl space has about a foot of standing water" multiline numberOfLines={3} />
          <Text style={styles.naLabel}>Photo (required)</Text>
          {naPhotos.length > 0 ? (
            <View style={styles.naPhotoRow}>
              {naPhotos.map((uri, i) => (
                <PhotoThumb key={`${uri}-${i}`} uri={uri} style={styles.naThumb} onDelete={() => setNaPhotos((prev) => prev.filter((_, j) => j !== i))} />
              ))}
            </View>
          ) : null}
          <View style={styles.naActions}>
            <Text style={styles.naAction} onPress={() => addNaPhoto("camera")} accessibilityRole="button">
              📷 Take photo
            </Text>
            <Text style={styles.naAction} onPress={() => addNaPhoto("library")} accessibilityRole="button">
              🖼 From library
            </Text>
          </View>
          <Field label="Technician initials" value={initials} onChangeText={setInitials} placeholder="e.g. JL" autoCapitalize="characters" maxLength={6} />
          {naMissing.length > 0 ? <Text style={styles.naMeta}>To confirm: {naMissing.join(", ")}.</Text> : null}
          <View style={styles.buttonRow}>
            <View style={styles.buttonHalf}>
              <PrimaryButton title="Confirm" onPress={handleConfirmNotAccessible} disabled={naMissing.length > 0} />
            </View>
            <View style={styles.buttonHalf}>
              <PrimaryButton title="Cancel" onPress={resetNotAccessibleForm} />
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
            onEditFinding={(findingId) => navigation.navigate("FindingForm", { inspectionId, editingFindingId: findingId })}
            // Right under "Check all as satisfactory": a technician at a house
            // with no attic shouldn't have to scroll past every item to say so.
            topExtra={
              !step.required ? (
                <Card style={styles.naTriggerCard}>
                  <Checkbox label={`This property doesn't have ${areaWithArticle}`} checked={false} onChange={() => setConfirmingNotApplicable(true)} />
                  <Checkbox label={`This area is not accessible`} checked={false} onChange={() => setConfirmingNotAccessible(true)} />
                </Card>
              ) : null
            }
          />
        </>
      )}

      {!step.resolved ? (
        <Text style={styles.blockedHint}>
          {step.itemsTotal - step.itemsAnswered} of {step.itemsTotal} required item(s) in this step still need an answer.
        </Text>
      ) : null}

      <View style={styles.footerRow}>
        <View style={styles.buttonHalf}>
          <PrimaryButton title="Back" onPress={() => goToStep(stepIndex - 1)} disabled={stepIndex === 0} />
        </View>
        <View style={styles.buttonHalf}>
          <PrimaryButton title={isLastStep ? "Finish" : "Next step"} onPress={handleNext} />
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
  orderHint: { fontSize: 12, color: colors.textMuted, marginBottom: 14 },
  naCard: { gap: 8, marginBottom: 16 },
  naText: { fontSize: 14, color: colors.text },
  naMeta: { fontSize: 12, color: colors.textMuted },
  naConfirmCard: { marginTop: 12, gap: 8 },
  naConfirmTitle: { fontSize: 15, fontWeight: "700", color: colors.text },
  naLabel: { fontSize: 13, fontWeight: "600", color: colors.text },
  naReasonText: { fontSize: 14, color: colors.text },
  naPhotoRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  naThumb: { width: 80, height: 80, borderRadius: 8 },
  naActions: { flexDirection: "row", gap: 20 },
  naAction: { color: colors.primaryText, fontWeight: "600", fontSize: 14, paddingVertical: 6 },
  naTriggerCard: { marginTop: 4, marginBottom: 12, gap: 10 },
  naConfirmText: { fontSize: 13, color: colors.text },
  secondaryLink: { color: colors.textMuted, fontWeight: "500", fontSize: 12, marginTop: 12, textAlign: "center", paddingVertical: 12 },
  blockedHint: { color: colors.textMuted, fontSize: 12, textAlign: "center", marginTop: 16 },
  buttonRow: { flexDirection: "row", gap: 10 },
  buttonHalf: { flex: 1 },
  footerRow: { flexDirection: "row", gap: 10, marginTop: 24 },
});

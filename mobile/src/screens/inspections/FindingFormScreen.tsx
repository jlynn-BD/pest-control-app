import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  ENTRY_POINT_OPTIONS,
  EVIDENCE_TYPE_OPTIONS,
  RISK_FACTOR_OPTIONS,
  Severity,
} from "@pest-app/shared";
import React, { useLayoutEffect, useMemo, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { getCachedPestTypes, getCachedTemplateSections } from "../../db/cache";
import {
  addLocalFinding,
  addLocalFindingPhoto,
  deleteLocalFinding,
  getLocalInspectionDetail,
  updateLocalFinding,
} from "../../db/inspectionStore";
import { deleteFinding } from "../../api/inspections";
import { capturePhoto } from "../../lib/photo";
import { getCurrentCoords } from "../../lib/location";
import { findChecklistResponseSummary } from "../../lib/checklist";
import { InspectionsStackParamList } from "../../navigation/navigationTypes";
import { ChipMultiSelect, SegmentedControl } from "../../components/ChipMultiSelect";
import { Badge, Field, PrimaryButton, colors } from "../../components/ui";

type Props = NativeStackScreenProps<InspectionsStackParamList, "FindingForm">;

const SEVERITY_OPTIONS = [Severity.LOW, Severity.MEDIUM, Severity.HIGH, Severity.CRITICAL];

export default function FindingFormScreen({ route, navigation }: Props) {
  const { inspectionId, arrowStartX, arrowStartY, arrowEndX, arrowEndY, arrowLevel, fromChecklistResponseId, editingFindingId } =
    route.params;
  const hasSiteMapPosition = arrowStartX != null && arrowStartY != null && arrowEndX != null && arrowEndY != null;
  const pestTypes = useMemo(() => getCachedPestTypes(), []);

  // Editing an existing marker/finding (from the site map's detail card, or
  // the workspace Findings list) - Tate's feedback was that markers placed
  // by mistake or needing correction had no way to be fixed. Pre-fills
  // every field from the finding being edited; handleSave below updates it
  // in place instead of inserting a new row.
  const existingFinding = useMemo(() => {
    if (!editingFindingId) return null;
    return getLocalInspectionDetail(inspectionId)?.findings.find((f) => f.id === editingFindingId) ?? null;
  }, [inspectionId, editingFindingId]);
  const existingPhotoUris = useMemo(() => existingFinding?.photos.map((p) => p.localUri) ?? [], [existingFinding]);

  useLayoutEffect(() => {
    if (existingFinding) navigation.setOptions({ title: "Edit Finding" });
  }, [existingFinding, navigation]);

  // Pre-fills from an already-answered checklist item instead of making the
  // technician retype what's already known (Tate's "don't do the same thing
  // twice" workflow ask) - see ChecklistScreen's "Add to Site Map" action
  // and SiteMapScreen, which is what routes here with this param set.
  const checklistSummary = useMemo(() => {
    if (!fromChecklistResponseId || existingFinding) return null;
    const detail = getLocalInspectionDetail(inspectionId);
    if (!detail) return null;
    const sections = detail.inspection.templateId ? getCachedTemplateSections(detail.inspection.templateId) : [];
    return findChecklistResponseSummary(fromChecklistResponseId, detail.checklistResponses, sections);
  }, [inspectionId, fromChecklistResponseId, existingFinding]);

  const [pestTypeId, setPestTypeId] = useState<string | null>(existingFinding?.pestTypeId ?? null);
  const [pestTypeOther, setPestTypeOther] = useState(existingFinding?.pestTypeOther ?? "");
  const [areaLocation, setAreaLocation] = useState(existingFinding?.areaLocation ?? checklistSummary?.prompt ?? "");
  const [locationDetail, setLocationDetail] = useState(existingFinding?.locationDetail ?? "");
  const [evidenceTypes, setEvidenceTypes] = useState<string[]>(existingFinding ? JSON.parse(existingFinding.evidenceTypes) : []);
  const [severity, setSeverity] = useState<string>(existingFinding?.severity ?? Severity.MEDIUM);
  const [riskFactors, setRiskFactors] = useState<string[]>(existingFinding ? JSON.parse(existingFinding.riskFactors) : []);
  const [entryPoints, setEntryPoints] = useState<string[]>(existingFinding ? JSON.parse(existingFinding.entryPoints) : []);
  const [description, setDescription] = useState(existingFinding?.description ?? checklistSummary?.notes ?? "");
  const [photos, setPhotos] = useState<string[]>(existingPhotoUris.length > 0 ? existingPhotoUris : checklistSummary?.photos.map((p) => p.localUri) ?? []);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    existingFinding?.lat != null && existingFinding?.lng != null ? { lat: existingFinding.lat, lng: existingFinding.lng } : null
  );
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  async function handleAddPhoto() {
    const uri = await capturePhoto();
    if (uri) setPhotos((prev) => [...prev, uri]);
  }

  async function handleCaptureLocation() {
    setLocating(true);
    const result = await getCurrentCoords();
    setCoords(result);
    setLocating(false);
  }

  function handleSave() {
    if (!areaLocation.trim()) {
      setError("Area / location is required");
      return;
    }
    const input = {
      pestTypeId,
      pestTypeOther: pestTypeOther.trim() || null,
      areaLocation: areaLocation.trim(),
      locationDetail: locationDetail.trim() || null,
      evidenceTypes,
      severity,
      riskFactors,
      entryPoints,
      description: description.trim() || null,
      lat: coords?.lat ?? null,
      lng: coords?.lng ?? null,
    };
    if (existingFinding) {
      // Map position is left untouched on edit - moving a marker is a
      // redraw action on the site map itself, not something this form does.
      updateLocalFinding(existingFinding.id, input);
      const newUris = photos.filter((uri) => !existingPhotoUris.includes(uri));
      newUris.forEach((uri, index) => {
        addLocalFindingPhoto(existingFinding.id, {
          localUri: uri,
          caption: null,
          lat: coords?.lat ?? null,
          lng: coords?.lng ?? null,
          sortOrder: existingPhotoUris.length + index,
        });
      });
    } else {
      const finding = addLocalFinding(inspectionId, {
        ...input,
        floorPlanX: hasSiteMapPosition ? arrowEndX! : null,
        floorPlanY: hasSiteMapPosition ? arrowEndY! : null,
        siteMapArrowStartX: hasSiteMapPosition ? arrowStartX! : null,
        siteMapArrowStartY: hasSiteMapPosition ? arrowStartY! : null,
        siteMapLevel: hasSiteMapPosition ? arrowLevel ?? null : null,
      });
      photos.forEach((uri, index) => {
        addLocalFindingPhoto(finding.id, { localUri: uri, caption: null, lat: coords?.lat ?? null, lng: coords?.lng ?? null, sortOrder: index });
      });
    }
    navigation.goBack();
  }

  function handleDelete() {
    if (!existingFinding) return;
    deleteLocalFinding(existingFinding.id);
    deleteFinding(existingFinding.id).catch(() => {});
    navigation.goBack();
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {hasSiteMapPosition || checklistSummary ? (
        <View style={styles.siteMapBadgeRow}>
          {hasSiteMapPosition ? <Badge label="📍 Marked on site plan" tone="success" /> : null}
          {checklistSummary ? <Badge label="📋 Pre-filled from checklist" tone="default" /> : null}
        </View>
      ) : null}
      <Text style={styles.label}>Pest type</Text>
      <View style={styles.pestRow}>
        {pestTypes.slice(0, 8).map((pt) => (
          <Pressable
            key={pt.id}
            onPress={() => setPestTypeId(pt.id === pestTypeId ? null : pt.id)}
            style={[styles.pestChip, pestTypeId === pt.id && styles.pestChipActive]}
          >
            <Text style={[styles.pestChipText, pestTypeId === pt.id && styles.pestChipTextActive]}>{pt.name}</Text>
          </Pressable>
        ))}
      </View>
      <Field label="Other / specify pest" value={pestTypeOther} onChangeText={setPestTypeOther} placeholder="If not listed above" />

      <Field label="Area / location" value={areaLocation} onChangeText={setAreaLocation} placeholder="e.g. Kitchen - under sink" />
      <Field label="Location detail" value={locationDetail} onChangeText={setLocationDetail} placeholder="Optional detail" />

      <ChipMultiSelect label="Evidence observed" options={EVIDENCE_TYPE_OPTIONS} selected={evidenceTypes} onChange={setEvidenceTypes} />
      <SegmentedControl label="Severity" options={SEVERITY_OPTIONS} value={severity} onChange={setSeverity} />
      <ChipMultiSelect label="Risk factors" options={RISK_FACTOR_OPTIONS} selected={riskFactors} onChange={setRiskFactors} />
      <ChipMultiSelect label="Entry points" options={ENTRY_POINT_OPTIONS} selected={entryPoints} onChange={setEntryPoints} />

      <Field label="Description" value={description} onChangeText={setDescription} multiline numberOfLines={3} />

      <Text style={styles.label}>Location</Text>
      <Pressable onPress={handleCaptureLocation} style={styles.secondaryButton}>
        <Text style={styles.secondaryButtonText}>{locating ? "Locating…" : coords ? `📍 ${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}` : "Capture GPS location"}</Text>
      </Pressable>

      <Text style={styles.label}>Photos ({photos.length})</Text>
      <View style={styles.photoRow}>
        {photos.map((uri) => (
          <Image key={uri} source={{ uri }} style={styles.photoThumb} />
        ))}
        <Pressable onPress={handleAddPhoto} style={styles.addPhotoButton}>
          <Text style={styles.addPhotoText}>+ Photo</Text>
        </Pressable>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.spacer} />
      <PrimaryButton title={existingFinding ? "Save changes" : "Save finding"} onPress={handleSave} />

      {existingFinding ? (
        confirmingDelete ? (
          <View style={styles.deleteConfirmRow}>
            <Text style={styles.deleteConfirmText}>Delete this finding? This can't be undone.</Text>
            <View style={styles.buttonRow}>
              <Pressable onPress={handleDelete} style={styles.deleteConfirmButton}>
                <Text style={styles.deleteConfirmButtonText}>Delete</Text>
              </Pressable>
              <Pressable onPress={() => setConfirmingDelete(false)} style={styles.cancelConfirmButton}>
                <Text style={styles.cancelConfirmButtonText}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Text style={styles.deleteLink} onPress={() => setConfirmingDelete(true)}>
            🗑 Delete finding
          </Text>
        )
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 40 },
  siteMapBadgeRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "flex-start", marginBottom: 12 },
  label: { fontSize: 13, color: colors.textMuted, marginBottom: 8, fontWeight: "500" },
  pestRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  pestChip: { paddingVertical: 7, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  pestChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  pestChipText: { fontSize: 13, color: colors.text },
  pestChipTextActive: { color: "#fff", fontWeight: "600" },
  secondaryButton: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
    marginBottom: 16,
  },
  secondaryButtonText: { color: colors.text, fontWeight: "500" },
  photoRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 20 },
  photoThumb: { width: 72, height: 72, borderRadius: 8 },
  addPhotoButton: {
    width: 72,
    height: 72,
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  addPhotoText: { fontSize: 12, color: colors.primary, fontWeight: "600", textAlign: "center" },
  error: { color: colors.danger, marginBottom: 12, textAlign: "center" },
  spacer: { height: 8 },
  deleteLink: { color: colors.danger, fontWeight: "600", fontSize: 13, textAlign: "center", marginTop: 16 },
  deleteConfirmRow: { marginTop: 16, gap: 8 },
  deleteConfirmText: { color: colors.text, fontSize: 13, textAlign: "center" },
  buttonRow: { flexDirection: "row", gap: 10 },
  deleteConfirmButton: { flex: 1, backgroundColor: colors.danger, borderRadius: 8, paddingVertical: 12, alignItems: "center" },
  deleteConfirmButtonText: { color: "#fff", fontWeight: "600" },
  cancelConfirmButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
  },
  cancelConfirmButtonText: { color: colors.text, fontWeight: "600" },
});

import { ENTRY_POINT_OPTIONS, EVIDENCE_TYPE_OPTIONS, RISK_FACTOR_OPTIONS, Severity } from "@pest-app/shared";
import React, { useMemo, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { getCachedPestTypes, getCachedTemplateSections } from "../db/cache";
import { addLocalFinding, addLocalFindingPhoto, deleteLocalFinding, getLocalInspectionDetail, updateLocalFinding } from "../db/inspectionStore";
import { deleteFinding } from "../api/inspections";
import { capturePhoto } from "../lib/photo";
import { getCurrentCoords } from "../lib/location";
import { CHECKLIST_CATEGORY_SHORT_LABEL, findChecklistResponseSummary, listChecklistResponseSummaries } from "../lib/checklist";
import { ChipMultiSelect, SegmentedControl } from "./ChipMultiSelect";
import { Badge, Field, PrimaryButton, colors } from "./ui";

const SEVERITY_OPTIONS = [Severity.LOW, Severity.MEDIUM, Severity.HIGH, Severity.CRITICAL];

export interface FindingEditorFormProps {
  inspectionId: string;
  arrowStartX?: number;
  arrowStartY?: number;
  arrowEndX?: number;
  arrowEndY?: number;
  arrowLevel?: string;
  // Pre-fills area/description/photos from an already-answered checklist
  // item instead of making the technician retype what's already known -
  // see SiteMapScreen/ChecklistScreen.
  fromChecklistResponseId?: string;
  // Editing an existing finding instead of creating a new one - loads and
  // pre-fills every field from it, and Save updates it in place.
  editingFindingId?: string;
  onSaved: () => void;
  onCancel: () => void;
}

// The finding/marker form, extracted from FindingFormScreen so it can be
// rendered two ways: as that standalone routed screen (entry points not
// touching the map, e.g. "+ Add finding" from the workspace list) and
// embedded directly inside SiteMapScreen (every map-marker flow) so the
// technician never leaves the map to fill this in - see SiteMapScreen's
// inline editor panel, added per Tate's "keep the map visible" feedback.
export function FindingEditorForm({
  inspectionId,
  arrowStartX,
  arrowStartY,
  arrowEndX,
  arrowEndY,
  arrowLevel,
  fromChecklistResponseId,
  editingFindingId,
  onSaved,
  onCancel,
}: FindingEditorFormProps) {
  const hasSiteMapPosition = arrowStartX != null && arrowStartY != null && arrowEndX != null && arrowEndY != null;
  const pestTypes = useMemo(() => getCachedPestTypes(), []);

  // Editing an existing marker/finding - Tate's feedback was that markers
  // placed by mistake or needing correction had no way to be fixed.
  // Pre-fills every field from the finding being edited; handleSave below
  // updates it in place instead of inserting a new row.
  const existingFinding = useMemo(() => {
    if (!editingFindingId) return null;
    return getLocalInspectionDetail(inspectionId)?.findings.find((f) => f.id === editingFindingId) ?? null;
  }, [inspectionId, editingFindingId]);
  const existingPhotoUris = useMemo(() => existingFinding?.photos.map((p) => p.localUri) ?? [], [existingFinding]);

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

  // Tate's "Copy/Paste from Checklist" ask - the reverse entry point from
  // the pre-fill above: instead of jumping here FROM a checklist item, a
  // technician who started a marker directly on the site map (or via
  // "+ Add finding") can still pull an already-answered checklist item's
  // notes/photos in, mid-form. Not offered while editing an existing
  // finding (nothing to "start" from) or when already pre-filled via the
  // other flow (redundant).
  const availableChecklistItems = useMemo(() => {
    if (existingFinding || fromChecklistResponseId) return [];
    const detail = getLocalInspectionDetail(inspectionId);
    if (!detail) return [];
    const sections = detail.inspection.templateId ? getCachedTemplateSections(detail.inspection.templateId) : [];
    return listChecklistResponseSummaries(detail.checklistResponses, sections);
  }, [inspectionId, existingFinding, fromChecklistResponseId]);
  const [showChecklistPicker, setShowChecklistPicker] = useState(false);
  const [copiedFromChecklistPrompt, setCopiedFromChecklistPrompt] = useState<string | null>(null);

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

  // Pulls a previously-answered checklist item's notes/photos into this
  // form. Overwrites area/location (that's the whole point - identify the
  // marker by the checklist item it came from) but only touches
  // description/photos when the checklist item actually has something to
  // add, so it never silently blanks out text the technician already typed.
  function handleCopyFromChecklist(responseId: string) {
    const detail = getLocalInspectionDetail(inspectionId);
    if (!detail) return;
    const sections = detail.inspection.templateId ? getCachedTemplateSections(detail.inspection.templateId) : [];
    const summary = findChecklistResponseSummary(responseId, detail.checklistResponses, sections);
    if (!summary) return;
    setAreaLocation(summary.prompt);
    if (summary.notes) setDescription(summary.notes);
    const newUris = summary.photos.map((p) => p.localUri).filter((uri) => !photos.includes(uri));
    if (newUris.length > 0) setPhotos((prev) => [...prev, ...newUris]);
    setCopiedFromChecklistPrompt(summary.prompt);
    setShowChecklistPicker(false);
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
    onSaved();
  }

  function handleDelete() {
    if (!existingFinding) return;
    deleteLocalFinding(existingFinding.id);
    deleteFinding(existingFinding.id).catch(() => {});
    onSaved();
  }

  return (
    <View>
      {hasSiteMapPosition || checklistSummary || copiedFromChecklistPrompt ? (
        <View style={styles.siteMapBadgeRow}>
          {hasSiteMapPosition ? <Badge label="📍 Marked on site plan" tone="success" /> : null}
          {checklistSummary ? <Badge label="📋 Pre-filled from checklist" tone="default" /> : null}
          {copiedFromChecklistPrompt ? <Badge label="📋 Copied from checklist" tone="default" /> : null}
        </View>
      ) : null}

      {availableChecklistItems.length > 0 ? (
        <>
          <Text style={styles.dismissLink} onPress={() => setShowChecklistPicker((v) => !v)}>
            {showChecklistPicker ? "Cancel" : "📋 Copy from Checklist"}
          </Text>
          {showChecklistPicker ? (
            <View style={styles.checklistPickerCard}>
              {availableChecklistItems.map((item) => (
                <Pressable key={item.id} onPress={() => handleCopyFromChecklist(item.id)} style={styles.checklistPickerRow}>
                  <Text style={styles.checklistPickerCategory}>{CHECKLIST_CATEGORY_SHORT_LABEL[item.category] ?? item.category}</Text>
                  <Text style={styles.checklistPickerPrompt}>{item.prompt}</Text>
                  <Text style={styles.checklistPickerNotes} numberOfLines={1}>
                    {item.notes || "No notes yet"}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </>
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
      <View style={styles.buttonRow}>
        <View style={styles.buttonHalf}>
          <PrimaryButton title={existingFinding ? "Save changes" : "Save finding"} onPress={handleSave} />
        </View>
        <View style={styles.buttonHalf}>
          <PrimaryButton title="Cancel" onPress={onCancel} />
        </View>
      </View>

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
    </View>
  );
}

const styles = StyleSheet.create({
  siteMapBadgeRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "flex-start", marginBottom: 12 },
  checklistPickerCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    backgroundColor: colors.card,
    marginBottom: 16,
    overflow: "hidden",
  },
  checklistPickerRow: { paddingVertical: 10, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  checklistPickerCategory: { fontSize: 11, color: colors.primary, fontWeight: "700", textTransform: "uppercase" },
  checklistPickerPrompt: { fontSize: 14, fontWeight: "600", color: colors.text, marginTop: 2 },
  checklistPickerNotes: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  dismissLink: { color: colors.primary, fontWeight: "600", fontSize: 13, marginBottom: 12 },
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
  buttonRow: { flexDirection: "row", gap: 10 },
  buttonHalf: { flex: 1 },
  deleteLink: { color: colors.danger, fontWeight: "600", fontSize: 13, textAlign: "center", marginTop: 16 },
  deleteConfirmRow: { marginTop: 16, gap: 8 },
  deleteConfirmText: { color: colors.text, fontSize: 13, textAlign: "center" },
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

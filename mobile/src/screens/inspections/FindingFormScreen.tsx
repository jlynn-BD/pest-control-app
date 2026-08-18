import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  ENTRY_POINT_OPTIONS,
  EVIDENCE_TYPE_OPTIONS,
  RISK_FACTOR_OPTIONS,
  Severity,
} from "@pest-app/shared";
import React, { useMemo, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { getCachedPestTypes } from "../../db/cache";
import { addLocalFinding, addLocalFindingPhoto } from "../../db/inspectionStore";
import { capturePhoto } from "../../lib/photo";
import { getCurrentCoords } from "../../lib/location";
import { InspectionsStackParamList } from "../../navigation/navigationTypes";
import { ChipMultiSelect, SegmentedControl } from "../../components/ChipMultiSelect";
import { Badge, Field, PrimaryButton, colors } from "../../components/ui";

type Props = NativeStackScreenProps<InspectionsStackParamList, "FindingForm">;

const SEVERITY_OPTIONS = [Severity.LOW, Severity.MEDIUM, Severity.HIGH, Severity.CRITICAL];

export default function FindingFormScreen({ route, navigation }: Props) {
  const { inspectionId, arrowStartX, arrowStartY, arrowEndX, arrowEndY } = route.params;
  const hasSiteMapPosition = arrowStartX != null && arrowStartY != null && arrowEndX != null && arrowEndY != null;
  const pestTypes = useMemo(() => getCachedPestTypes(), []);

  const [pestTypeId, setPestTypeId] = useState<string | null>(null);
  const [pestTypeOther, setPestTypeOther] = useState("");
  const [areaLocation, setAreaLocation] = useState("");
  const [locationDetail, setLocationDetail] = useState("");
  const [evidenceTypes, setEvidenceTypes] = useState<string[]>([]);
  const [severity, setSeverity] = useState<string>(Severity.MEDIUM);
  const [riskFactors, setRiskFactors] = useState<string[]>([]);
  const [entryPoints, setEntryPoints] = useState<string[]>([]);
  const [description, setDescription] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    const finding = addLocalFinding(inspectionId, {
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
      floorPlanX: hasSiteMapPosition ? arrowEndX! : null,
      floorPlanY: hasSiteMapPosition ? arrowEndY! : null,
      siteMapArrowStartX: hasSiteMapPosition ? arrowStartX! : null,
      siteMapArrowStartY: hasSiteMapPosition ? arrowStartY! : null,
    });
    photos.forEach((uri, index) => {
      addLocalFindingPhoto(finding.id, { localUri: uri, caption: null, lat: coords?.lat ?? null, lng: coords?.lng ?? null, sortOrder: index });
    });
    navigation.goBack();
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {hasSiteMapPosition ? (
        <View style={styles.siteMapBadgeRow}>
          <Badge label="📍 Marked on site plan" tone="success" />
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
      <PrimaryButton title="Save finding" onPress={handleSave} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 40 },
  siteMapBadgeRow: { alignItems: "flex-start", marginBottom: 12 },
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
});

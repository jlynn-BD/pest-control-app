import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { SITE_MAP_LEVEL_SUGGESTIONS, SiteMapLevel, SiteMapSketchLabel, SiteMapSketchLine } from "@pest-app/shared";
import React, { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { getCachedProperty, updateLocalPropertySiteMapSketch } from "../../db/cache";
import { generateId } from "../../lib/uuid";
import { getLocalInspectionDetail, LocalInspectionDetail } from "../../db/inspectionStore";
import { saveSiteMapSketch, uploadSiteMap } from "../../api/properties";
import { parseSiteMapSketch } from "../../lib/siteMapSketch";
import { capturePhoto } from "../../lib/photo";
import { ApiError } from "../../api/client";
import { InspectionsStackParamList } from "../../navigation/navigationTypes";
import { SiteMapArrow, SiteMapCanvas, SiteMapMode } from "../../components/ArrowCanvas";
import { Badge, Card, Field, PrimaryButton, colors } from "../../components/ui";
import type { LocalProperty } from "../../db/types";

type Props = NativeStackScreenProps<InspectionsStackParamList, "SiteMap">;

export default function SiteMapScreen({ route, navigation }: Props) {
  const { inspectionId } = route.params;
  const [detail, setDetail] = useState<LocalInspectionDetail | null>(null);
  const [property, setProperty] = useState<LocalProperty | null>(null);
  const [selectedLevelId, setSelectedLevelId] = useState<string | null>(null);
  const [addingLevel, setAddingLevel] = useState(false);
  const [newLevelName, setNewLevelName] = useState("");
  const [mode, setMode] = useState<SiteMapMode>("view");
  const [pendingLines, setPendingLines] = useState<SiteMapSketchLine[]>([]);
  const [pendingLabels, setPendingLabels] = useState<SiteMapSketchLabel[]>([]);
  const [pendingLabelPoint, setPendingLabelPoint] = useState<{ x: number; y: number } | null>(null);
  const [labelText, setLabelText] = useState("");
  const [selectedArrowId, setSelectedArrowId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [addingLevelSaving, setAddingLevelSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    const d = getLocalInspectionDetail(inspectionId);
    setDetail(d);
    if (d) {
      const p = getCachedProperty(d.inspection.propertyId);
      setProperty(p);
      const sketch = parseSiteMapSketch(p?.siteMapSketchJson);
      setSelectedLevelId((current) => {
        if (current && sketch.levels.some((l) => l.id === current)) return current;
        return sketch.levels[0]?.id ?? null;
      });
    }
  }, [inspectionId]);

  useFocusEffect(
    useCallback(() => {
      refresh();
      setMode("view");
      setPendingLines([]);
      setPendingLabels([]);
      setPendingLabelPoint(null);
      setAddingLevel(false);
    }, [refresh])
  );

  if (!detail) return null;

  const imageUri = property?.siteMapLocalUri || property?.siteMapImageUrl || null;
  const isPhotoMode = Boolean(imageUri);
  const savedSketch = parseSiteMapSketch(property?.siteMapSketchJson);
  const levels = [...savedSketch.levels].sort((a, b) => a.sortOrder - b.sortOrder);
  const selectedLevel = levels.find((l) => l.id === selectedLevelId) ?? null;
  const hasPendingChanges = pendingLines.length > 0 || pendingLabels.length > 0;
  // Photo mode is one flat canvas (no levels); sketch mode needs a level
  // selected before anything can be drawn on it.
  const canDraw = isPhotoMode || Boolean(selectedLevel);

  const allArrows: SiteMapArrow[] = detail.findings
    .filter((f) => f.floorPlanX != null && f.floorPlanY != null && f.siteMapArrowStartX != null && f.siteMapArrowStartY != null)
    .map((f) => ({
      id: f.id,
      startX: f.siteMapArrowStartX!,
      startY: f.siteMapArrowStartY!,
      endX: f.floorPlanX!,
      endY: f.floorPlanY!,
      label: f.areaLocation,
      severity: f.severity,
    }));
  // In sketch mode an arrow only belongs on the level it was drawn on;
  // in photo mode every arrow shares the one flat canvas.
  const visibleArrows = isPhotoMode ? allArrows : allArrows.filter((a) => detail.findings.find((f) => f.id === a.id)?.siteMapLevel === selectedLevelId);

  const selectedFinding = selectedArrowId ? detail.findings.find((f) => f.id === selectedArrowId) ?? null : null;

  function toggleMode(next: SiteMapMode) {
    setMode((current) => (current === next ? "view" : next));
    setPendingLabelPoint(null);
  }

  async function handleUpload() {
    if (!property) return;
    const uri = await capturePhoto();
    if (!uri) return;
    setUploading(true);
    setError(null);
    try {
      await uploadSiteMap(property.id, uri);
      setError(null);
      navigation.goBack();
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : "Failed to upload site plan");
    } finally {
      setUploading(false);
    }
  }

  async function handleAddLevel(name: string) {
    if (!property || !name.trim()) return;
    setAddingLevelSaving(true);
    setError(null);
    try {
      const newLevel: SiteMapLevel = { id: generateId(), name: name.trim(), sortOrder: levels.length, lines: [], labels: [] };
      const nextSketch = { levels: [...levels, newLevel] };
      await saveSiteMapSketch(property.id, nextSketch);
      updateLocalPropertySiteMapSketch(property.id, JSON.stringify(nextSketch));
      setAddingLevel(false);
      setNewLevelName("");
      refresh();
      setSelectedLevelId(newLevel.id);
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : "Failed to add level");
    } finally {
      setAddingLevelSaving(false);
    }
  }

  async function handleSaveStructure() {
    if (!property || !selectedLevel) return;
    setSaving(true);
    setError(null);
    try {
      const nextLevels = levels.map((l) =>
        l.id === selectedLevel.id ? { ...l, lines: [...l.lines, ...pendingLines], labels: [...l.labels, ...pendingLabels] } : l
      );
      const nextSketch = { levels: nextLevels };
      await saveSiteMapSketch(property.id, nextSketch);
      updateLocalPropertySiteMapSketch(property.id, JSON.stringify(nextSketch));
      setPendingLines([]);
      setPendingLabels([]);
      setMode("view");
      refresh();
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : "Failed to save site plan structure");
    } finally {
      setSaving(false);
    }
  }

  function handleDiscardStructure() {
    setPendingLines([]);
    setPendingLabels([]);
    setPendingLabelPoint(null);
    setMode("view");
  }

  function handleConfirmLabel() {
    if (!pendingLabelPoint || !labelText.trim()) return;
    setPendingLabels((prev) => [...prev, { x: pendingLabelPoint.x, y: pendingLabelPoint.y, text: labelText.trim() }]);
    setPendingLabelPoint(null);
    setLabelText("");
  }

  function handleSelectLevel(levelId: string) {
    if (hasPendingChanges) return; // avoid silently dropping unsaved wall/label edits on level switch
    setSelectedLevelId(levelId);
    setMode("view");
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {!isPhotoMode ? (
        <>
          <Text style={styles.label}>Level</Text>
          <View style={styles.levelRow}>
            {levels.map((level) => (
              <Pressable
                key={level.id}
                onPress={() => handleSelectLevel(level.id)}
                style={[styles.levelChip, level.id === selectedLevelId && styles.levelChipActive]}
              >
                <Text style={[styles.levelChipText, level.id === selectedLevelId && styles.levelChipTextActive]}>{level.name}</Text>
              </Pressable>
            ))}
            <Pressable onPress={() => setAddingLevel((v) => !v)} style={styles.levelChipAdd}>
              <Text style={styles.levelChipAddText}>+ Add level</Text>
            </Pressable>
          </View>

          {addingLevel ? (
            <Card style={styles.addLevelCard}>
              <Text style={styles.label}>Common levels</Text>
              <View style={styles.levelRow}>
                {SITE_MAP_LEVEL_SUGGESTIONS.filter((s) => !levels.some((l) => l.name === s)).map((suggestion) => (
                  <Pressable key={suggestion} onPress={() => handleAddLevel(suggestion)} style={styles.levelChip}>
                    <Text style={styles.levelChipText}>{suggestion}</Text>
                  </Pressable>
                ))}
              </View>
              <Field label="Or a custom name" value={newLevelName} onChangeText={setNewLevelName} placeholder="e.g. Basement" />
              <PrimaryButton title="Add level" onPress={() => handleAddLevel(newLevelName)} disabled={!newLevelName.trim()} loading={addingLevelSaving} />
            </Card>
          ) : null}

          {levels.length === 0 && !addingLevel ? (
            <Text style={styles.hint}>Add a level (Exterior, 1st Floor, Attic, ...) to start sketching this property's layout.</Text>
          ) : null}
        </>
      ) : null}

      <SiteMapCanvas
        imageUri={imageUri}
        arrows={visibleArrows}
        savedLines={selectedLevel?.lines ?? []}
        pendingLines={pendingLines}
        labels={[...(selectedLevel?.labels ?? []), ...pendingLabels]}
        mode={canDraw ? mode : "view"}
        onArrowPress={(id) => setSelectedArrowId(id)}
        onArrowDrawn={(start, end) => {
          setMode("view");
          navigation.navigate("FindingForm", {
            inspectionId,
            arrowStartX: start.x,
            arrowStartY: start.y,
            arrowEndX: end.x,
            arrowEndY: end.y,
            arrowLevel: isPhotoMode ? undefined : selectedLevelId ?? undefined,
          });
        }}
        onWallDrawn={(start, end) => setPendingLines((prev) => [...prev, { x1: start.x, y1: start.y, x2: end.x, y2: end.y }])}
        onLabelTap={(point) => {
          setPendingLabelPoint(point);
          setLabelText("");
        }}
      />

      {pendingLabelPoint ? (
        <Card style={styles.labelPromptCard}>
          <Field
            label="Label text"
            value={labelText}
            onChangeText={setLabelText}
            placeholder="e.g. Garage, Porch"
            autoFocus
          />
          <View style={styles.buttonRow}>
            <View style={styles.buttonHalf}>
              <PrimaryButton title="Add label" onPress={handleConfirmLabel} disabled={!labelText.trim()} />
            </View>
            <View style={styles.buttonHalf}>
              <PrimaryButton title="Cancel" onPress={() => setPendingLabelPoint(null)} />
            </View>
          </View>
        </Card>
      ) : null}

      {canDraw ? (
        <View style={styles.toggleRow}>
          <View style={styles.buttonThird}>
            <PrimaryButton title={mode === "arrow" ? "Cancel" : "+ Marker"} onPress={() => toggleMode("arrow")} />
          </View>
          <View style={styles.buttonThird}>
            <PrimaryButton title={mode === "wall" ? "Cancel" : "+ Wall"} onPress={() => toggleMode("wall")} />
          </View>
          <View style={styles.buttonThird}>
            <PrimaryButton title={mode === "label" ? "Cancel" : "+ Label"} onPress={() => toggleMode("label")} />
          </View>
        </View>
      ) : null}

      {hasPendingChanges ? (
        <View style={styles.toggleRow}>
          <View style={styles.buttonHalf}>
            <PrimaryButton title="Save structure" onPress={handleSaveStructure} loading={saving} />
          </View>
          <View style={styles.buttonHalf}>
            <PrimaryButton title="Discard" onPress={handleDiscardStructure} />
          </View>
        </View>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Text style={styles.hint}>
        {visibleArrows.length} marker(s) · {(selectedLevel?.lines.length ?? 0) + pendingLines.length} wall segment(s)
        {isPhotoMode ? "" : selectedLevel ? ` on ${selectedLevel.name}` : ""}
      </Text>

      {!imageUri ? (
        <View style={styles.uploadRow}>
          <PrimaryButton title="Upload a site plan photo instead" onPress={handleUpload} loading={uploading} />
        </View>
      ) : null}

      {selectedFinding ? (
        <Card style={styles.detailCard}>
          <View style={styles.detailHeaderRow}>
            <Text style={styles.detailTitle}>{selectedFinding.areaLocation}</Text>
            <Badge
              label={selectedFinding.severity}
              tone={selectedFinding.severity === "CRITICAL" || selectedFinding.severity === "HIGH" ? "danger" : "warning"}
            />
          </View>
          {selectedFinding.description ? <Text style={styles.detailBody}>{selectedFinding.description}</Text> : null}
          <Text style={styles.dismissLink} onPress={() => setSelectedArrowId(null)}>
            Close
          </Text>
        </Card>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 40 },
  label: { fontSize: 13, color: colors.textMuted, marginBottom: 8, fontWeight: "500" },
  levelRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  levelChip: { paddingVertical: 7, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  levelChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  levelChipText: { fontSize: 13, color: colors.text },
  levelChipTextActive: { color: "#fff", fontWeight: "600" },
  levelChipAdd: { paddingVertical: 7, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: colors.primary, borderStyle: "dashed" },
  levelChipAddText: { fontSize: 13, color: colors.primary, fontWeight: "600" },
  addLevelCard: { marginBottom: 14, gap: 8 },
  toggleRow: { flexDirection: "row", gap: 10, marginTop: 14 },
  buttonThird: { flex: 1 },
  buttonHalf: { flex: 1 },
  buttonRow: { flexDirection: "row", gap: 10, marginTop: 10 },
  hint: { fontSize: 12, color: colors.textMuted, textAlign: "center", marginTop: 10 },
  uploadRow: { marginTop: 14 },
  labelPromptCard: { marginTop: 12, gap: 4 },
  detailCard: { marginTop: 16, gap: 6 },
  detailHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  detailTitle: { fontSize: 15, fontWeight: "700", color: colors.text },
  detailBody: { fontSize: 14, color: colors.text },
  dismissLink: { color: colors.primary, fontWeight: "600", fontSize: 13, marginTop: 4 },
  error: { color: colors.danger, textAlign: "center", marginTop: 10 },
});

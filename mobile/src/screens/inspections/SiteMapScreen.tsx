import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { SITE_MAP_LEVEL_SUGGESTIONS, SiteMapLevel, SiteMapSketchLabel, SiteMapSketchLine } from "@pest-app/shared";
import React, { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { getCachedProperty, getCachedTemplateSections, updateLocalPropertySiteMapSketch } from "../../db/cache";
import { generateId } from "../../lib/uuid";
import { deleteFinding } from "../../api/inspections";
import { deleteLocalFinding, getLocalInspectionDetail, LocalInspectionDetail } from "../../db/inspectionStore";
import { saveSiteMapSketch, uploadSiteMap } from "../../api/properties";
import { parseSiteMapSketch } from "../../lib/siteMapSketch";
import { findChecklistResponseSummary } from "../../lib/checklist";
import { capturePhoto } from "../../lib/photo";
import { ApiError } from "../../api/client";
import { InspectionsStackParamList } from "../../navigation/navigationTypes";
import { SiteMapArrow, SiteMapCanvas, SiteMapMode } from "../../components/ArrowCanvas";
import { Badge, Card, Field, PrimaryButton, colors } from "../../components/ui";
import type { LocalProperty } from "../../db/types";

type Props = NativeStackScreenProps<InspectionsStackParamList, "SiteMap">;

// A pending (unsaved) wall or label, in the order the technician drew/placed
// it - a single ordered stack (rather than two separate arrays) is what lets
// "Undo" pop whichever one actually came last, regardless of type.
type PendingEntry = { kind: "line"; line: SiteMapSketchLine } | { kind: "label"; label: SiteMapSketchLabel };

export default function SiteMapScreen({ route, navigation }: Props) {
  const { inspectionId, fromChecklistResponseId } = route.params;
  const [detail, setDetail] = useState<LocalInspectionDetail | null>(null);
  const [property, setProperty] = useState<LocalProperty | null>(null);
  const [selectedLevelId, setSelectedLevelId] = useState<string | null>(null);
  const [addingLevel, setAddingLevel] = useState(false);
  const [newLevelName, setNewLevelName] = useState("");
  const [mode, setMode] = useState<SiteMapMode>("view");
  const [pendingHistory, setPendingHistory] = useState<PendingEntry[]>([]);
  const [pendingLabelPoint, setPendingLabelPoint] = useState<{ x: number; y: number } | null>(null);
  const [labelText, setLabelText] = useState("");
  const [selectedArrowId, setSelectedArrowId] = useState<string | null>(null);
  const [confirmingDeleteFinding, setConfirmingDeleteFinding] = useState(false);
  const [editingLabel, setEditingLabel] = useState<{ id: string; text: string; isPending: boolean } | null>(null);
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
      // Arriving here to place a marker for an already-answered checklist
      // item (see ChecklistScreen's "Add to Site Map") skips the separate
      // "+Marker" tap and drops straight into drawing mode.
      setMode(fromChecklistResponseId ? "arrow" : "view");
      setPendingHistory([]);
      setPendingLabelPoint(null);
      setAddingLevel(false);
      setEditingLabel(null);
    }, [refresh, fromChecklistResponseId])
  );

  if (!detail) return null;

  const imageUri = property?.siteMapLocalUri || property?.siteMapImageUrl || null;
  const isPhotoMode = Boolean(imageUri);
  const savedSketch = parseSiteMapSketch(property?.siteMapSketchJson);
  const levels = [...savedSketch.levels].sort((a, b) => a.sortOrder - b.sortOrder);
  const selectedLevel = levels.find((l) => l.id === selectedLevelId) ?? null;
  const pendingLines = pendingHistory.filter((h): h is { kind: "line"; line: SiteMapSketchLine } => h.kind === "line").map((h) => h.line);
  const pendingLabels = pendingHistory
    .filter((h): h is { kind: "label"; label: SiteMapSketchLabel } => h.kind === "label")
    .map((h) => h.label);
  const hasPendingChanges = pendingHistory.length > 0;
  // Photo mode is one flat canvas (no levels); sketch mode needs a level
  // selected before anything can be drawn on it.
  const canDraw = isPhotoMode || Boolean(selectedLevel);
  const checklistSummary = fromChecklistResponseId
    ? findChecklistResponseSummary(
        fromChecklistResponseId,
        detail.checklistResponses,
        detail.inspection.templateId ? getCachedTemplateSections(detail.inspection.templateId) : []
      )
    : null;

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

  // Saved walls come from the persisted level; pending ones are still local
  // to this editing session - combined into one list (each row tagged with
  // where it lives) so Delete can be offered for either kind in one place.
  const wallRows = [
    ...(selectedLevel?.lines ?? []).map((line) => ({ line, isPending: false })),
    ...pendingLines.map((line) => ({ line, isPending: true })),
  ];

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

  // Shared by every action that edits an already-saved wall/label (delete,
  // rename) - replaces just the current level within the full sketch and
  // persists it the same way handleSaveStructure does. Returns whether it
  // succeeded so callers (e.g. the label-edit card) can decide whether to
  // dismiss themselves or stay open/retryable on failure.
  async function persistSelectedLevel(mutate: (level: SiteMapLevel) => SiteMapLevel): Promise<boolean> {
    if (!property || !selectedLevel) return false;
    setSaving(true);
    setError(null);
    try {
      const nextLevels = levels.map((l) => (l.id === selectedLevel.id ? mutate(l) : l));
      const nextSketch = { levels: nextLevels };
      await saveSiteMapSketch(property.id, nextSketch);
      updateLocalPropertySiteMapSketch(property.id, JSON.stringify(nextSketch));
      refresh();
      return true;
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : "Failed to update site plan");
      return false;
    } finally {
      setSaving(false);
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
      setPendingHistory([]);
      setMode("view");
      refresh();
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : "Failed to save site plan structure");
    } finally {
      setSaving(false);
    }
  }

  function handleDiscardStructure() {
    setPendingHistory([]);
    setPendingLabelPoint(null);
    setMode("view");
  }

  // Pops whichever wall or label was added most recently in this editing
  // session, regardless of which of the two it was - the fix for Tate's
  // complaint that a mis-drawn wall or mis-placed label had no quick way
  // back out short of discarding the whole session.
  function handleUndo() {
    setPendingHistory((prev) => prev.slice(0, -1));
  }

  function handleDeletePendingItem(id: string) {
    setPendingHistory((prev) => prev.filter((h) => (h.kind === "line" ? h.line.id : h.label.id) !== id));
  }

  function handleDeleteSavedWall(id: string) {
    persistSelectedLevel((l) => ({ ...l, lines: l.lines.filter((line) => line.id !== id) }));
  }

  function handleConfirmLabel() {
    if (!pendingLabelPoint || !labelText.trim()) return;
    setPendingHistory((prev) => [
      ...prev,
      { kind: "label", label: { id: generateId(), x: pendingLabelPoint.x, y: pendingLabelPoint.y, text: labelText.trim() } },
    ]);
    setPendingLabelPoint(null);
    setLabelText("");
  }

  // Tapping a label (saved or still-pending) reopens its text for editing -
  // Tate suggested double-clicking on desktop, but a tap is the equivalent
  // touch gesture and matches how markers are already selected on this map.
  function handleLabelPress(id: string) {
    const pending = pendingLabels.find((l) => l.id === id);
    if (pending) {
      setEditingLabel({ id, text: pending.text, isPending: true });
      return;
    }
    const saved = selectedLevel?.labels.find((l) => l.id === id);
    if (saved) setEditingLabel({ id, text: saved.text, isPending: false });
  }

  async function handleSaveLabelEdit() {
    if (!editingLabel || !editingLabel.text.trim()) return;
    const text = editingLabel.text.trim();
    if (editingLabel.isPending) {
      setPendingHistory((prev) =>
        prev.map((h) => (h.kind === "label" && h.label.id === editingLabel.id ? { ...h, label: { ...h.label, text } } : h))
      );
      setEditingLabel(null);
      return;
    }
    // Kept open (retryable) on failure rather than dismissed, same as
    // handleAddLevel - otherwise a network error would silently discard the
    // correction the technician just typed.
    const ok = await persistSelectedLevel((l) => ({
      ...l,
      labels: l.labels.map((label) => (label.id === editingLabel.id ? { ...label, text } : label)),
    }));
    if (ok) setEditingLabel(null);
  }

  async function handleDeleteLabelEdit() {
    if (!editingLabel) return;
    if (editingLabel.isPending) {
      handleDeletePendingItem(editingLabel.id);
      setEditingLabel(null);
      return;
    }
    const ok = await persistSelectedLevel((l) => ({ ...l, labels: l.labels.filter((label) => label.id !== editingLabel.id) }));
    if (ok) setEditingLabel(null);
  }

  function handleSelectLevel(levelId: string) {
    if (hasPendingChanges) return; // avoid silently dropping unsaved wall/label edits on level switch
    setSelectedLevelId(levelId);
    setMode("view");
    setEditingLabel(null);
  }

  function handleEditFinding() {
    if (!selectedFinding) return;
    navigation.navigate("FindingForm", { inspectionId, editingFindingId: selectedFinding.id });
  }

  function handleDeleteFinding() {
    if (!selectedFinding) return;
    deleteLocalFinding(selectedFinding.id);
    deleteFinding(selectedFinding.id).catch(() => {});
    setSelectedArrowId(null);
    setConfirmingDeleteFinding(false);
    refresh();
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {checklistSummary ? (
        <Card style={styles.checklistBannerCard}>
          <Text style={styles.checklistBannerLabel}>📋 Placing marker for checklist item:</Text>
          <Text style={styles.checklistBannerPrompt}>{checklistSummary.prompt}</Text>
          <Text style={styles.hint}>Draw an arrow on the map below to mark where this is.</Text>
          <Text style={styles.dismissLink} onPress={() => navigation.goBack()}>
            Cancel
          </Text>
        </Card>
      ) : null}
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
        onLabelPress={handleLabelPress}
        selectedLabelId={editingLabel?.id ?? null}
        onArrowDrawn={(start, end) => {
          setMode("view");
          navigation.navigate("FindingForm", {
            inspectionId,
            arrowStartX: start.x,
            arrowStartY: start.y,
            arrowEndX: end.x,
            arrowEndY: end.y,
            arrowLevel: isPhotoMode ? undefined : selectedLevelId ?? undefined,
            fromChecklistResponseId: fromChecklistResponseId,
          });
        }}
        onWallDrawn={(start, end) =>
          setPendingHistory((prev) => [
            ...prev,
            { kind: "line", line: { id: generateId(), x1: start.x, y1: start.y, x2: end.x, y2: end.y } },
          ])
        }
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

      {editingLabel ? (
        <Card style={styles.labelPromptCard}>
          <Field
            label="Label text"
            value={editingLabel.text}
            onChangeText={(text) => setEditingLabel((prev) => (prev ? { ...prev, text } : prev))}
            autoFocus
          />
          <View style={styles.buttonRow}>
            <View style={styles.buttonHalf}>
              <PrimaryButton title="Save changes" onPress={handleSaveLabelEdit} disabled={!editingLabel.text.trim()} loading={saving} />
            </View>
            <View style={styles.buttonHalf}>
              <PrimaryButton title="Delete label" onPress={handleDeleteLabelEdit} />
            </View>
          </View>
          <Text style={styles.dismissLink} onPress={() => setEditingLabel(null)}>
            Cancel
          </Text>
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
          <View style={styles.buttonThird}>
            <PrimaryButton title="Save structure" onPress={handleSaveStructure} loading={saving} />
          </View>
          <View style={styles.buttonThird}>
            <PrimaryButton title="Undo" onPress={handleUndo} />
          </View>
          <View style={styles.buttonThird}>
            <PrimaryButton title="Discard" onPress={handleDiscardStructure} />
          </View>
        </View>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Text style={styles.hint}>
        {visibleArrows.length} marker(s) · {wallRows.length} wall segment(s)
        {isPhotoMode ? "" : selectedLevel ? ` on ${selectedLevel.name}` : ""}
      </Text>

      {wallRows.length > 0 ? (
        <Card style={styles.wallListCard}>
          <Text style={styles.label}>Walls</Text>
          {wallRows.map(({ line, isPending }, index) => (
            <View key={line.id} style={styles.wallRow}>
              <Text style={styles.wallRowText}>
                Wall {index + 1}
                {isPending ? " (unsaved)" : ""}
              </Text>
              <Text
                style={styles.deleteLink}
                onPress={() => (isPending ? handleDeletePendingItem(line.id) : handleDeleteSavedWall(line.id))}
              >
                🗑 Delete
              </Text>
            </View>
          ))}
        </Card>
      ) : null}

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
          {confirmingDeleteFinding ? (
            <View style={styles.deleteConfirmRow}>
              <Text style={styles.deleteConfirmText}>Delete this marker/finding? This can't be undone.</Text>
              <View style={styles.buttonRow}>
                <View style={styles.buttonHalf}>
                  <PrimaryButton title="Delete" onPress={handleDeleteFinding} />
                </View>
                <View style={styles.buttonHalf}>
                  <PrimaryButton title="Cancel" onPress={() => setConfirmingDeleteFinding(false)} />
                </View>
              </View>
            </View>
          ) : (
            <View style={styles.detailActionsRow}>
              <Text style={styles.dismissLink} onPress={handleEditFinding}>
                ✎ Edit
              </Text>
              <Text style={styles.deleteLink} onPress={() => setConfirmingDeleteFinding(true)}>
                🗑 Delete
              </Text>
              <Text style={styles.dismissLink} onPress={() => setSelectedArrowId(null)}>
                Close
              </Text>
            </View>
          )}
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
  checklistBannerCard: { marginBottom: 14, gap: 4, borderColor: colors.primary, borderWidth: 2 },
  checklistBannerLabel: { fontSize: 12, color: colors.textMuted, fontWeight: "600" },
  checklistBannerPrompt: { fontSize: 15, fontWeight: "700", color: colors.text },
  toggleRow: { flexDirection: "row", gap: 10, marginTop: 14 },
  buttonThird: { flex: 1 },
  buttonHalf: { flex: 1 },
  buttonRow: { flexDirection: "row", gap: 10, marginTop: 10 },
  hint: { fontSize: 12, color: colors.textMuted, textAlign: "center", marginTop: 10 },
  uploadRow: { marginTop: 14 },
  labelPromptCard: { marginTop: 12, gap: 4 },
  wallListCard: { marginTop: 14, gap: 4 },
  wallRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6 },
  wallRowText: { fontSize: 13, color: colors.text },
  detailCard: { marginTop: 16, gap: 6 },
  detailHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  detailTitle: { fontSize: 15, fontWeight: "700", color: colors.text },
  detailBody: { fontSize: 14, color: colors.text },
  detailActionsRow: { flexDirection: "row", gap: 16, marginTop: 4 },
  dismissLink: { color: colors.primary, fontWeight: "600", fontSize: 13, marginTop: 4 },
  deleteLink: { color: colors.danger, fontWeight: "600", fontSize: 13, marginTop: 4 },
  deleteConfirmRow: { marginTop: 8, gap: 8 },
  deleteConfirmText: { color: colors.text, fontSize: 13 },
  error: { color: colors.danger, textAlign: "center", marginTop: 10 },
});

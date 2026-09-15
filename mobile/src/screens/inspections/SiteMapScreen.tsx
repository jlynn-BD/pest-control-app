import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { SITE_MAP_LEVEL_SUGGESTIONS, SiteMapLevel } from "@pest-app/shared";
import React, { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { getCachedProperty, getCachedTemplateSections, updateLocalPropertySiteMapSketch } from "../../db/cache";
import { generateId } from "../../lib/uuid";
import { getLocalInspectionDetail, LocalInspectionDetail } from "../../db/inspectionStore";
import { saveSiteMapSketch, uploadSiteMap } from "../../api/properties";
import { parseSiteMapSketch } from "../../lib/siteMapSketch";
import { findChecklistResponseSummary } from "../../lib/checklist";
import { capturePhoto } from "../../lib/photo";
import { ApiError } from "../../api/client";
import { InspectionsStackParamList } from "../../navigation/navigationTypes";
import { SiteMapArrow, SiteMapCanvas, SiteMapMode } from "../../components/ArrowCanvas";
import { FindingEditorForm } from "../../components/FindingEditorForm";
import { Badge, Card, Field, PrimaryButton, colors } from "../../components/ui";
import type { LocalProperty } from "../../db/types";
import type { Point } from "../../lib/arrowGeometry";

type Props = NativeStackScreenProps<InspectionsStackParamList, "SiteMap">;

// Whichever wall or label was just auto-saved, so a one-tap "Undo" can
// remove it - see the auto-save note below.
type LastAction = { type: "wall"; id: string } | { type: "label"; id: string; text: string };

export default function SiteMapScreen({ route, navigation }: Props) {
  const { inspectionId, fromChecklistResponseId } = route.params;
  const [detail, setDetail] = useState<LocalInspectionDetail | null>(null);
  const [property, setProperty] = useState<LocalProperty | null>(null);
  const [selectedLevelId, setSelectedLevelId] = useState<string | null>(null);
  const [addingLevel, setAddingLevel] = useState(false);
  const [newLevelName, setNewLevelName] = useState("");
  const [mode, setMode] = useState<SiteMapMode>("view");
  const [pendingLabelPoint, setPendingLabelPoint] = useState<{ x: number; y: number } | null>(null);
  const [labelText, setLabelText] = useState("");
  const [lastAction, setLastAction] = useState<LastAction | null>(null);
  // A just-drawn, not-yet-saved marker position - opens the inline finding
  // editor below the canvas instead of navigating away (Tate: "keep the map
  // visible while entering/editing findings"). Editing an existing marker
  // works the same way, via editingFindingId.
  const [draftArrow, setDraftArrow] = useState<{ start: Point; end: Point } | null>(null);
  const [editingFindingId, setEditingFindingId] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState<{ id: string; text: string } | null>(null);
  const [selectedWallId, setSelectedWallId] = useState<string | null>(null);
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
      setPendingLabelPoint(null);
      setAddingLevel(false);
      setEditingLabel(null);
      setSelectedWallId(null);
      setDraftArrow(null);
      setEditingFindingId(null);
      setLastAction(null);
    }, [refresh, fromChecklistResponseId])
  );

  if (!detail) return null;

  const imageUri = property?.siteMapLocalUri || property?.siteMapImageUrl || null;
  const isPhotoMode = Boolean(imageUri);
  const savedSketch = parseSiteMapSketch(property?.siteMapSketchJson);
  const levels = [...savedSketch.levels].sort((a, b) => a.sortOrder - b.sortOrder);
  const selectedLevel = levels.find((l) => l.id === selectedLevelId) ?? null;
  // Photo mode is one flat canvas (no levels); sketch mode needs a level
  // selected before anything can be drawn on it.
  const canDraw = isPhotoMode || Boolean(selectedLevel);
  // The finding editor is open (drafting a new marker or editing an
  // existing one) - every other map-editing affordance (drawing walls,
  // placing labels, switching levels) is hidden while it's open, so the
  // technician's attention and the map's state stay on the one thing
  // they're doing, and so a stray tap elsewhere can't swap out the form
  // mid-edit and lose what they've typed.
  const editorOpen = Boolean(draftArrow) || Boolean(editingFindingId);
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

  const wallCount = selectedLevel?.lines.length ?? 0;

  function toggleMode(next: SiteMapMode) {
    setMode((current) => (current === next ? "view" : next));
    setPendingLabelPoint(null);
    setSelectedWallId(null);
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

  // Shared by every action that adds/edits/deletes a wall or label -
  // replaces just the current level within the full sketch and saves it to
  // the server immediately. Everything on this screen goes through this one
  // function, which is what makes the whole thing auto-save: a technician
  // testing this found a drawn structure disappear because nothing persists
  // until a manual "Save" tap is remembered, so there is no longer a manual
  // save step to forget - every wall/label write is already durable the
  // moment it happens. Returns whether it succeeded so callers (e.g. the
  // label-edit card) can decide whether to dismiss themselves or stay
  // open/retryable on failure.
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

  // Undoes whichever wall or label was auto-saved most recently - the
  // safety net Jaida asked for once saving stopped being a manual step:
  // one tap removes exactly the thing that was just added, without having
  // to hunt for it on the canvas.
  async function handleUndoLastAction() {
    if (!lastAction) return;
    const ok =
      lastAction.type === "wall"
        ? await persistSelectedLevel((l) => ({ ...l, lines: l.lines.filter((line) => line.id !== lastAction.id) }))
        : await persistSelectedLevel((l) => ({ ...l, labels: l.labels.filter((label) => label.id !== lastAction.id) }));
    if (ok) setLastAction(null);
  }

  async function handleWallDrawn(start: Point, end: Point) {
    const id = generateId();
    const ok = await persistSelectedLevel((l) => ({ ...l, lines: [...l.lines, { id, x1: start.x, y1: start.y, x2: end.x, y2: end.y }] }));
    if (ok) setLastAction({ type: "wall", id });
  }

  function handleDeleteSavedWall(id: string) {
    persistSelectedLevel((l) => ({ ...l, lines: l.lines.filter((line) => line.id !== id) }));
  }

  // Tapping a wall directly on the canvas (view mode only) selects it and
  // shows a small Delete action right there, instead of a separate list of
  // every wall segment sitting permanently below the map.
  function handleWallPress(id: string) {
    if (editorOpen) return;
    setSelectedWallId(id);
  }

  function handleDeleteSelectedWall() {
    if (!selectedWallId) return;
    handleDeleteSavedWall(selectedWallId);
    setSelectedWallId(null);
  }

  async function handleConfirmLabel() {
    if (!pendingLabelPoint || !labelText.trim()) return;
    const id = generateId();
    const text = labelText.trim();
    const ok = await persistSelectedLevel((l) => ({ ...l, labels: [...l.labels, { id, x: pendingLabelPoint.x, y: pendingLabelPoint.y, text }] }));
    if (ok) {
      setLastAction({ type: "label", id, text });
      setPendingLabelPoint(null);
      setLabelText("");
    }
    // Left open (retryable) on failure, same reasoning as handleAddLevel -
    // the error banner already explains what went wrong.
  }

  // Tapping a label reopens its text for editing - Tate suggested
  // double-clicking on desktop, but a tap is the equivalent touch gesture
  // and matches how markers are already selected on this map.
  function handleLabelPress(id: string) {
    if (editorOpen) return;
    const saved = selectedLevel?.labels.find((l) => l.id === id);
    if (saved) setEditingLabel({ id, text: saved.text });
  }

  async function handleSaveLabelEdit() {
    if (!editingLabel || !editingLabel.text.trim()) return;
    const text = editingLabel.text.trim();
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
    const ok = await persistSelectedLevel((l) => ({ ...l, labels: l.labels.filter((label) => label.id !== editingLabel.id) }));
    if (ok) setEditingLabel(null);
  }

  function handleSelectLevel(levelId: string) {
    if (editorOpen) return; // avoid silently dropping an in-progress finding edit
    setSelectedLevelId(levelId);
    setMode("view");
    setEditingLabel(null);
    setSelectedWallId(null);
    // A stale Undo would otherwise target the level it was drawn on, not
    // whichever level is selected when the tap actually happens.
    setLastAction(null);
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {checklistSummary && !draftArrow ? (
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
            {!editorOpen ? (
              <Pressable onPress={() => setAddingLevel((v) => !v)} style={styles.levelChipAdd}>
                <Text style={styles.levelChipAddText}>+ Add level</Text>
              </Pressable>
            ) : null}
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
        labels={selectedLevel?.labels ?? []}
        mode={canDraw && !editorOpen ? mode : "view"}
        onArrowPress={(id) => {
          if (editorOpen) return;
          setEditingFindingId(id);
        }}
        onLabelPress={handleLabelPress}
        onWallPress={handleWallPress}
        selectedLabelId={editingLabel?.id ?? null}
        selectedWallId={selectedWallId}
        onArrowDrawn={(start, end) => {
          setMode("view");
          setDraftArrow({ start, end });
        }}
        onWallDrawn={handleWallDrawn}
        onLabelTap={(point) => {
          setPendingLabelPoint(point);
          setLabelText("");
        }}
      />

      {/* Drawing a marker or tapping an existing one opens this editor right
          here, below the still-visible map, instead of navigating to a
          separate screen - Tate's "keep the map visible" feedback. */}
      {draftArrow ? (
        <Card style={styles.editorCard}>
          <Text style={styles.editorTitle}>New marker</Text>
          <FindingEditorForm
            inspectionId={inspectionId}
            arrowStartX={draftArrow.start.x}
            arrowStartY={draftArrow.start.y}
            arrowEndX={draftArrow.end.x}
            arrowEndY={draftArrow.end.y}
            arrowLevel={isPhotoMode ? undefined : selectedLevelId ?? undefined}
            fromChecklistResponseId={fromChecklistResponseId}
            onSaved={() => {
              setDraftArrow(null);
              refresh();
              // Clears the checklist-linked route param once it's been used,
              // so the "placing marker for..." banner and auto-arrow-mode
              // don't come right back for a checklist item that already has
              // its marker (they'd otherwise reappear on every refocus,
              // since useFocusEffect re-derives mode from this param).
              if (fromChecklistResponseId) navigation.setParams({ fromChecklistResponseId: undefined });
            }}
            onCancel={() => setDraftArrow(null)}
          />
        </Card>
      ) : null}

      {editingFindingId ? (
        <Card style={styles.editorCard}>
          <Text style={styles.editorTitle}>Edit marker</Text>
          <FindingEditorForm
            inspectionId={inspectionId}
            editingFindingId={editingFindingId}
            onSaved={() => {
              setEditingFindingId(null);
              refresh();
            }}
            onCancel={() => setEditingFindingId(null)}
          />
        </Card>
      ) : null}

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
              <PrimaryButton title="Add label" onPress={handleConfirmLabel} disabled={!labelText.trim()} loading={saving} />
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

      {selectedWallId ? (
        <Card style={styles.labelPromptCard}>
          <Text style={styles.editorTitle}>Wall segment</Text>
          <View style={styles.buttonRow}>
            <View style={styles.buttonHalf}>
              <PrimaryButton title="Delete" onPress={handleDeleteSelectedWall} loading={saving} />
            </View>
            <View style={styles.buttonHalf}>
              <PrimaryButton title="Cancel" onPress={() => setSelectedWallId(null)} />
            </View>
          </View>
        </Card>
      ) : null}

      {/* Every wall/label write above already saved itself the instant it
          happened - this is just a one-tap way to undo that specific write
          if it was a mistake, not a "did you remember to save" prompt. */}
      {lastAction ? (
        <Card style={styles.lastActionCard}>
          <Text style={styles.editorTitle}>
            {lastAction.type === "wall" ? "✓ Wall saved" : `✓ Label saved: "${lastAction.text}"`}
          </Text>
          <View style={styles.buttonRow}>
            <View style={styles.buttonHalf}>
              <PrimaryButton title="Undo" onPress={handleUndoLastAction} loading={saving} />
            </View>
            <View style={styles.buttonHalf}>
              <PrimaryButton title="Keep" onPress={() => setLastAction(null)} />
            </View>
          </View>
        </Card>
      ) : null}

      {canDraw && !editorOpen ? (
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

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Text style={styles.hint}>
        {visibleArrows.length} marker(s) · {wallCount} wall segment(s)
        {isPhotoMode ? "" : selectedLevel ? ` on ${selectedLevel.name}` : ""}
        {wallCount > 0 && mode === "view" && !editorOpen ? " · tap a wall to delete it" : ""}
      </Text>

      {!imageUri && !editorOpen ? (
        <View style={styles.uploadRow}>
          <PrimaryButton title="Upload a site plan photo instead" onPress={handleUpload} loading={uploading} />
        </View>
      ) : null}

      {/* Existing findings placed on this level/map, listed alongside the
          canvas so a technician can jump straight into editing one without
          having to precisely tap its small arrow label - Tate's "Site Map +
          Existing Findings + Finding Editor, all in one workspace" ask. */}
      {visibleArrows.length > 0 && !editorOpen ? (
        <Card style={styles.findingsListCard}>
          <Text style={styles.label}>
            Findings {isPhotoMode ? "on this map" : selectedLevel ? `on ${selectedLevel.name}` : ""} ({visibleArrows.length})
          </Text>
          {visibleArrows.map((a) => (
            <Pressable key={a.id} onPress={() => setEditingFindingId(a.id)} style={styles.findingsListRow}>
              <Text style={styles.findingsListRowTitle} numberOfLines={1}>
                {a.label}
              </Text>
              <Badge label={a.severity} tone={a.severity === "CRITICAL" || a.severity === "HIGH" ? "danger" : "warning"} />
            </Pressable>
          ))}
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
  editorCard: { marginTop: 14, gap: 4, borderColor: colors.primary, borderWidth: 2 },
  editorTitle: { fontSize: 15, fontWeight: "700", color: colors.text, marginBottom: 4 },
  lastActionCard: { marginTop: 12, gap: 4, borderColor: colors.primary, borderWidth: 1 },
  dismissLink: { color: colors.primary, fontWeight: "600", fontSize: 13, marginTop: 4 },
  error: { color: colors.danger, textAlign: "center", marginTop: 10 },
  findingsListCard: { marginTop: 16, gap: 4 },
  findingsListRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: 8,
  },
  findingsListRowTitle: { fontSize: 14, fontWeight: "600", color: colors.text, flex: 1 },
});

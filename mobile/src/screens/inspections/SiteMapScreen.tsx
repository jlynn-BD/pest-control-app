import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { getSiteMapLevelRank, getWizardStepStatus, SITE_MAP_LEVEL_SUGGESTIONS, SiteMapAnnotationType, SiteMapLevel } from "@pest-app/shared";
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
import { Geometry, siteMapHintText, SiteMapArrow, SiteMapCanvas, SiteMapMode } from "../../components/ArrowCanvas";
import { ChecklistPanel } from "../../components/ChecklistPanel";
import { FindingEditorForm } from "../../components/FindingEditorForm";
import { Badge, Card, Field, PrimaryButton, colors } from "../../components/ui";
import type { LocalProperty } from "../../db/types";
import type { Point } from "../../lib/arrowGeometry";

type Props = NativeStackScreenProps<InspectionsStackParamList, "SiteMap">;

// Lightweight X-mark/arrow/shape annotation tools, offered alongside the
// full Finding marker flow - "not every annotation needs to become a full
// detailed finding, sometimes the technician simply needs to visually
// identify an area" (Tate). A small fixed palette rather than a full color
// picker, since the point is speed, not precision.
const ANNOTATION_TYPES: { type: SiteMapAnnotationType; label: string }[] = [
  { type: "x", label: "✕ X mark" },
  { type: "arrow", label: "↗ Arrow" },
  { type: "rect", label: "▭ Shape" },
];
const ANNOTATION_COLORS = [
  { label: "Red", value: "#C0392B" },
  { label: "Orange", value: "#E07B18" },
  { label: "Yellow", value: "#D4AC0D" },
  { label: "Green", value: "#1F7A5C" },
  { label: "Blue", value: "#2E6DA4" },
];

// Whichever wall/label/annotation was just auto-saved, so a one-tap "Undo"
// can remove it - see the auto-save note below.
type LastAction =
  | { kind: "wall"; id: string }
  | { kind: "label"; id: string; text: string }
  | { kind: "annotation"; id: string };

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
  const [annotationType, setAnnotationType] = useState<SiteMapAnnotationType>("x");
  const [annotationColor, setAnnotationColor] = useState(ANNOTATION_COLORS[0].value);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [addingLevelSaving, setAddingLevelSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Collapsed by default (a long checklist is a lot to push the map down by)
  // - Tate: "Site Map + Checklist + Finding Editor, all in one workspace",
  // so this is embedded here rather than behind a separate screen a
  // technician would have to navigate to and back from.
  const [checklistExpanded, setChecklistExpanded] = useState(false);

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
      // Only ever auto-*expand* - never collapse a section the technician
      // may have opened themselves, e.g. after switching tabs and back.
      if (fromChecklistResponseId) setChecklistExpanded(true);
      setPendingLabelPoint(null);
      setAddingLevel(false);
      setEditingLabel(null);
      setSelectedWallId(null);
      setSelectedAnnotationId(null);
      setDraftArrow(null);
      setEditingFindingId(null);
      setLastAction(null);
    }, [refresh, fromChecklistResponseId])
  );

  if (!detail) return null;

  const imageUri = property?.siteMapLocalUri || property?.siteMapImageUrl || null;
  const isPhotoMode = Boolean(imageUri);
  const savedSketch = parseSiteMapSketch(property?.siteMapSketchJson);
  // Exterior -> 1st Floor -> ... -> Attic, same fixed sequence as the
  // checklist wizard (Matt: the house should be walked in one consistent
  // order) - not whatever order a technician happened to draw/add levels
  // in, which is all `sortOrder` reflects.
  const levels = [...savedSketch.levels].sort((a, b) => {
    const rankDiff = getSiteMapLevelRank(a.name) - getSiteMapLevelRank(b.name);
    return rankDiff !== 0 ? rankDiff : a.sortOrder - b.sortOrder;
  });
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
  const annotationCount = selectedLevel?.annotations.length ?? 0;

  // Only categories the wizard has unlocked so far are shown here - lets a
  // technician review/edit anything already reached without being able to
  // jump ahead out of sequence from the map (see ChecklistPanel's
  // allowedCategories prop / ChecklistScreen for the same restriction).
  const wizardStatus = detail.inspection.templateId
    ? getWizardStepStatus(getCachedTemplateSections(detail.inspection.templateId), detail.checklistResponses, property ?? undefined, detail.sectionSkips)
    : null;
  const unlockedCategories = wizardStatus ? wizardStatus.steps.slice(0, wizardStatus.furthestUnlockedIndex + 1).map((s) => s.category) : [];
  const checklistItemCount = wizardStatus ? wizardStatus.steps.reduce((sum, s) => sum + s.itemsTotal, 0) : 0;
  const checklistAnsweredCount = wizardStatus ? wizardStatus.steps.reduce((sum, s) => sum + s.itemsAnswered, 0) : 0;

  function toggleMode(next: SiteMapMode) {
    setMode((current) => (current === next ? "view" : next));
    setPendingLabelPoint(null);
    setEditingLabel(null);
    setSelectedWallId(null);
    setSelectedAnnotationId(null);
  }

  // Each annotation type gets its own one-tap button (mirroring +Marker/
  // +Wall/+Label) rather than a nested "pick a type, then start drawing"
  // step - tapping "✕ X mark" both switches into annotate mode and picks
  // that type in one go; the color row alongside it can still be changed
  // between draws without leaving the mode.
  function toggleAnnotationType(type: SiteMapAnnotationType) {
    setMode((current) => (current === "annotate" && annotationType === type ? "view" : "annotate"));
    setAnnotationType(type);
    setPendingLabelPoint(null);
    setEditingLabel(null);
    setSelectedWallId(null);
    setSelectedAnnotationId(null);
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
      const newLevel: SiteMapLevel = { id: generateId(), name: name.trim(), sortOrder: levels.length, lines: [], labels: [], annotations: [] };
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

  // Undoes whichever wall, label, or annotation was auto-saved most
  // recently - the safety net Jaida asked for once saving stopped being a
  // manual step: one tap removes exactly the thing that was just added,
  // without having to hunt for it on the canvas.
  async function handleUndoLastAction() {
    if (!lastAction) return;
    const ok = await persistSelectedLevel((l) => {
      if (lastAction.kind === "wall") return { ...l, lines: l.lines.filter((line) => line.id !== lastAction.id) };
      if (lastAction.kind === "label") return { ...l, labels: l.labels.filter((label) => label.id !== lastAction.id) };
      return { ...l, annotations: l.annotations.filter((a) => a.id !== lastAction.id) };
    });
    if (ok) setLastAction(null);
  }

  async function handleWallDrawn(start: Point, end: Point) {
    const id = generateId();
    const ok = await persistSelectedLevel((l) => ({ ...l, lines: [...l.lines, { id, x1: start.x, y1: start.y, x2: end.x, y2: end.y }] }));
    if (ok) setLastAction({ kind: "wall", id });
  }

  async function handleAnnotationDrawn(type: SiteMapAnnotationType, color: string, start: Point, end: Point) {
    const id = generateId();
    const annotation = type === "x" ? { id, type, color, x1: start.x, y1: start.y } : { id, type, color, x1: start.x, y1: start.y, x2: end.x, y2: end.y };
    const ok = await persistSelectedLevel((l) => ({ ...l, annotations: [...l.annotations, annotation] }));
    if (ok) setLastAction({ kind: "annotation", id });
  }

  function handleDeleteSavedAnnotation(id: string) {
    persistSelectedLevel((l) => ({ ...l, annotations: l.annotations.filter((a) => a.id !== id) }));
  }

  // Tapping an annotation directly on the canvas (view mode only) selects
  // it and shows a small Delete action, mirroring how walls are selected -
  // there's no text to edit on an annotation, only geometry/color, so
  // Delete (draw a fresh one to replace it) is the whole affordance.
  function handleAnnotationPress(id: string) {
    if (editorOpen) return;
    setSelectedAnnotationId(id);
  }

  function handleDeleteSelectedAnnotation() {
    if (!selectedAnnotationId) return;
    handleDeleteSavedAnnotation(selectedAnnotationId);
    setSelectedAnnotationId(null);
  }

  // Moving or resizing a selected shape: called once when the finger lifts,
  // and saved like every other edit on this screen.
  function handleUpdateAnnotation(id: string, g: Geometry) {
    return persistSelectedLevel((l) => ({
      ...l,
      annotations: l.annotations.map((a) =>
        a.id === id ? (a.type === "x" ? { ...a, x1: g.x1, y1: g.y1 } : { ...a, x1: g.x1, y1: g.y1, x2: g.x2, y2: g.y2 }) : a
      ),
    }));
  }

  function handleUpdateWall(id: string, g: Required<Geometry>) {
    return persistSelectedLevel((l) => ({
      ...l,
      lines: l.lines.map((line) => (line.id === id ? { ...line, x1: g.x1, y1: g.y1, x2: g.x2, y2: g.y2 } : line)),
    }));
  }

  function handleRecolorSelectedAnnotation(color: string) {
    const id = selectedAnnotationId;
    if (!id) return;
    persistSelectedLevel((l) => ({ ...l, annotations: l.annotations.map((a) => (a.id === id ? { ...a, color } : a)) }));
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
      setLastAction({ kind: "label", id, text });
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
    setSelectedAnnotationId(null);
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
          <Text style={styles.hint}>
            {mode === "arrow"
              ? "Draw an arrow on the map below to mark where this is."
              : "Add or edit walls, labels and shapes below - tap Place marker when you're ready to mark this item."}
          </Text>
          {mode === "arrow" ? (
            <Text style={styles.dismissLink} onPress={() => toggleMode("arrow")}>
              Add or edit shapes first
            </Text>
          ) : (
            <Text style={styles.dismissLink} onPress={() => { setMode("arrow"); setSelectedWallId(null); setSelectedAnnotationId(null); }}>
              Place marker
            </Text>
          )}
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

      {/* Rendered above the canvas, in normal document flow, rather than as
          an overlay on top of it - a technician found that an in-canvas
          instructional banner sitting over the drawing surface could
          swallow the touch used to draw through that spot. */}
      {/* Always rendered (with a calm idle message) so the map keeps the same
          spot on screen - it used to appear only while a drawing tool was
          active, which shoved the whole map down and back up each time. */}
      {canDraw && !editorOpen ? (
        <Text style={[styles.drawHint, !siteMapHintText(mode, annotationType) && styles.drawHintIdle]}>
          {siteMapHintText(mode, annotationType) ?? "Tap a shape or wall to move, resize or recolor it"}
        </Text>
      ) : null}

      <SiteMapCanvas
        imageUri={imageUri}
        arrows={visibleArrows}
        savedLines={selectedLevel?.lines ?? []}
        labels={selectedLevel?.labels ?? []}
        annotations={selectedLevel?.annotations ?? []}
        mode={canDraw && !editorOpen ? mode : "view"}
        annotationType={annotationType}
        annotationColor={annotationColor}
        onArrowPress={(id) => {
          if (editorOpen) return;
          setEditingFindingId(id);
        }}
        onLabelPress={handleLabelPress}
        onWallPress={handleWallPress}
        onAnnotationPress={handleAnnotationPress}
        onAnnotationChange={handleUpdateAnnotation}
        onWallChange={handleUpdateWall}
        selectedLabelId={editingLabel?.id ?? null}
        selectedWallId={selectedWallId}
        selectedAnnotationId={selectedAnnotationId}
        onArrowDrawn={(start, end) => {
          setMode("view");
          setDraftArrow({ start, end });
        }}
        onWallDrawn={handleWallDrawn}
        onAnnotationDrawn={handleAnnotationDrawn}
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
          <Text style={styles.editHint}>Drag the wall to move it, or drag a dot to change its length or angle.</Text>
          <View style={styles.buttonRow}>
            <View style={styles.buttonHalf}>
              <PrimaryButton title="Delete" onPress={handleDeleteSelectedWall} loading={saving} />
            </View>
            <View style={styles.buttonHalf}>
              <PrimaryButton title="Done" onPress={() => setSelectedWallId(null)} />
            </View>
          </View>
        </Card>
      ) : null}

      {selectedAnnotationId ? (
        <Card style={styles.labelPromptCard}>
          <Text style={styles.editorTitle}>Shape</Text>
          <Text style={styles.editHint}>
            {selectedLevel?.annotations.find((a) => a.id === selectedAnnotationId)?.type === "x"
              ? "Drag the mark to move it."
              : "Drag the shape to move it, or drag a dot to resize it."}
          </Text>
          <View style={styles.colorRow}>
            {ANNOTATION_COLORS.map((c) => (
              <Pressable
                key={c.value}
                onPress={() => handleRecolorSelectedAnnotation(c.value)}
                accessibilityLabel={c.label}
                style={[
                  styles.colorSwatch,
                  { backgroundColor: c.value },
                  c.value === selectedLevel?.annotations.find((a) => a.id === selectedAnnotationId)?.color && styles.colorSwatchSelected,
                ]}
              />
            ))}
          </View>
          <View style={styles.buttonRow}>
            <View style={styles.buttonHalf}>
              <PrimaryButton title="Delete" onPress={handleDeleteSelectedAnnotation} loading={saving} />
            </View>
            <View style={styles.buttonHalf}>
              <PrimaryButton title="Done" onPress={() => setSelectedAnnotationId(null)} />
            </View>
          </View>
        </Card>
      ) : null}

      {/* Every wall/label/annotation write above already saved itself the
          instant it happened - this is just a one-tap way to undo that
          specific write if it was a mistake, not a "did you remember to
          save" prompt. */}
      {lastAction ? (
        <Card style={styles.lastActionCard}>
          <Text style={styles.editorTitle}>
            {lastAction.kind === "wall" ? "✓ Wall saved" : lastAction.kind === "annotation" ? "✓ Annotation saved" : `✓ Label saved: "${lastAction.text}"`}
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

      {/* Lightweight annotation tools, separate from the +Marker/+Wall/
          +Label row above since these don't open any form at all - tap a
          type, tap/drag on the map, done. Tate: "not every annotation needs
          to become a full detailed finding". */}
      {canDraw && !editorOpen ? (
        <View style={styles.toggleRow}>
          {ANNOTATION_TYPES.map(({ type, label }) => (
            <View key={type} style={styles.buttonThird}>
              <PrimaryButton
                title={mode === "annotate" && annotationType === type ? "Cancel" : label}
                onPress={() => toggleAnnotationType(type)}
              />
            </View>
          ))}
        </View>
      ) : null}

      {mode === "annotate" && !editorOpen ? (
        <View style={styles.colorRow}>
          {ANNOTATION_COLORS.map((c) => (
            <Pressable
              key={c.value}
              onPress={() => setAnnotationColor(c.value)}
              accessibilityLabel={c.label}
              style={[styles.colorSwatch, { backgroundColor: c.value }, c.value === annotationColor && styles.colorSwatchSelected]}
            />
          ))}
        </View>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Text style={styles.hint}>
        {visibleArrows.length} marker(s) · {wallCount} wall segment(s) · {annotationCount} annotation(s)
        {isPhotoMode ? "" : selectedLevel ? ` on ${selectedLevel.name}` : ""}
        {(wallCount > 0 || annotationCount > 0) && mode === "view" && !editorOpen ? " · tap one to edit it" : ""}
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

      {/* Embedded here rather than behind a separate "Checklist" screen -
          Tate's eventual ask was "Site Map + Checklist + Finding Editor, all
          visible within the same workspace" so a technician can check what a
          checklist item says (or add a marker for it) without losing the
          map. Sits below the map, the editor cards and the drawing tools so
          whatever is being worked on stays right under the map. */}
      {detail.inspection.templateId ? (
        <View style={styles.section}>
          <Pressable style={styles.checklistHeaderRow} onPress={() => setChecklistExpanded((v) => !v)}>
            <Text style={styles.checklistHeaderTitle}>{checklistExpanded ? "▾" : "▸"} Checklist</Text>
            <Badge
              label={`${checklistAnsweredCount}/${checklistItemCount}`}
              tone={checklistAnsweredCount >= checklistItemCount && checklistItemCount > 0 ? "success" : "default"}
            />
          </Pressable>
          {checklistExpanded ? (
            <ChecklistPanel
              inspectionId={inspectionId}
              allowedCategories={unlockedCategories}
              onAddToSiteMap={(responseId) => navigation.setParams({ fromChecklistResponseId: responseId })}
            />
          ) : null}
        </View>
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
  section: { marginTop: 14 },
  checklistHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 8,
  },
  checklistHeaderTitle: { fontSize: 15, fontWeight: "700", color: colors.text },
  toggleRow: { flexDirection: "row", gap: 10, marginTop: 14 },
  colorRow: { flexDirection: "row", gap: 10, marginTop: 12, justifyContent: "center" },
  colorSwatch: { width: 32, height: 32, borderRadius: 16, borderWidth: 2, borderColor: "transparent" },
  colorSwatchSelected: { borderColor: colors.text },
  buttonThird: { flex: 1 },
  buttonHalf: { flex: 1 },
  buttonRow: { flexDirection: "row", gap: 10, marginTop: 10 },
  hint: { fontSize: 12, color: colors.textMuted, textAlign: "center", marginTop: 10 },
  drawHint: {
    fontSize: 12,
    fontWeight: "600",
    color: "#fff",
    backgroundColor: "rgba(26,36,33,0.75)",
    textAlign: "center",
    paddingVertical: 6,
    borderRadius: 6,
    marginBottom: 8,
  },
  drawHintIdle: { backgroundColor: "transparent", color: colors.textMuted, fontWeight: "500" },
  editHint: { fontSize: 12, color: colors.textMuted, marginBottom: 8 },
  uploadRow: { marginTop: 14 },
  labelPromptCard: { marginTop: 12, gap: 4 },
  editorCard: { marginTop: 14, gap: 4, borderColor: colors.primary, borderWidth: 2 },
  editorTitle: { fontSize: 15, fontWeight: "700", color: colors.text, marginBottom: 4 },
  lastActionCard: { marginTop: 12, gap: 4, borderColor: colors.primary, borderWidth: 1 },
  dismissLink: { color: colors.primary, fontWeight: "600", fontSize: 13, marginTop: 4, paddingVertical: 12 },
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

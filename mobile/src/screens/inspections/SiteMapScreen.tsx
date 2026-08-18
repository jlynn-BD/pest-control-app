import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { SiteMapSketchLabel, SiteMapSketchLine } from "@pest-app/shared";
import React, { useCallback, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { getCachedProperty, updateLocalPropertySiteMapSketch } from "../../db/cache";
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
  const [mode, setMode] = useState<SiteMapMode>("view");
  const [pendingLines, setPendingLines] = useState<SiteMapSketchLine[]>([]);
  const [pendingLabels, setPendingLabels] = useState<SiteMapSketchLabel[]>([]);
  const [pendingLabelPoint, setPendingLabelPoint] = useState<{ x: number; y: number } | null>(null);
  const [labelText, setLabelText] = useState("");
  const [selectedArrowId, setSelectedArrowId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    const d = getLocalInspectionDetail(inspectionId);
    setDetail(d);
    if (d) setProperty(getCachedProperty(d.inspection.propertyId));
  }, [inspectionId]);

  useFocusEffect(
    useCallback(() => {
      refresh();
      setMode("view");
      setPendingLines([]);
      setPendingLabels([]);
      setPendingLabelPoint(null);
    }, [refresh])
  );

  if (!detail) return null;

  const imageUri = property?.siteMapLocalUri || property?.siteMapImageUrl || null;
  const savedSketch = parseSiteMapSketch(property?.siteMapSketchJson);
  const hasPendingChanges = pendingLines.length > 0 || pendingLabels.length > 0;

  const arrows: SiteMapArrow[] = detail.findings
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

  async function handleSaveStructure() {
    if (!property) return;
    setSaving(true);
    setError(null);
    try {
      const sketch = {
        lines: [...savedSketch.lines, ...pendingLines],
        labels: [...savedSketch.labels, ...pendingLabels],
      };
      await saveSiteMapSketch(property.id, sketch);
      updateLocalPropertySiteMapSketch(property.id, JSON.stringify(sketch));
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

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <SiteMapCanvas
        imageUri={imageUri}
        arrows={arrows}
        savedLines={savedSketch.lines}
        pendingLines={pendingLines}
        labels={[...savedSketch.labels, ...pendingLabels]}
        mode={mode}
        onArrowPress={(id) => setSelectedArrowId(id)}
        onArrowDrawn={(start, end) => {
          setMode("view");
          navigation.navigate("FindingForm", {
            inspectionId,
            arrowStartX: start.x,
            arrowStartY: start.y,
            arrowEndX: end.x,
            arrowEndY: end.y,
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
        {arrows.length} marker(s) this inspection · {savedSketch.lines.length + pendingLines.length} wall segment(s)
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

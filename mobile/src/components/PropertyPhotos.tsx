import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { addLocalInspectionPhoto, deleteLocalInspectionPhoto } from "../db/inspectionStore";
import type { LocalInspectionPhoto } from "../db/types";
import { capturePhoto, pickPhotosFromLibrary } from "../lib/photo";
import { PhotoThumb } from "./PhotoThumb";
import { Badge, Card, colors, fonts } from "./ui";

// Pictures of the property taken before (or apart from) the checklist - the
// house on arrival, the yard, anything worth having on file. Works the same as
// the checklist and issue photos: saved on the device straight away, uploaded
// at the next sync (so it works with no signal), tap one to see it full size,
// and one photo can be removed without touching the others.
export function PropertyPhotos({
  inspectionId,
  photos,
  onChange,
}: {
  inspectionId: string;
  photos: LocalInspectionPhoto[];
  // Called with the updated list after every add or delete.
  onChange: (photos: LocalInspectionPhoto[]) => void;
}) {
  async function add(source: "camera" | "library") {
    const uris = source === "camera" ? [await capturePhoto()].filter((u): u is string => Boolean(u)) : await pickPhotosFromLibrary();
    if (uris.length === 0) return;
    const added = uris.map((uri, i) => addLocalInspectionPhoto(inspectionId, { localUri: uri, sortOrder: photos.length + i }));
    onChange([...photos, ...added]);
  }

  function remove(photoId: string) {
    deleteLocalInspectionPhoto(photoId);
    onChange(photos.filter((p) => p.id !== photoId));
  }

  return (
    <View style={styles.section}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Photos</Text>
        {photos.length > 0 ? <Badge label={`${photos.length} photo${photos.length === 1 ? "" : "s"}`} tone="success" /> : null}
      </View>
      <Card>
        <Text style={styles.hint}>Take pictures of the property before you start. They go in the report.</Text>
        {photos.length > 0 ? (
          <View style={styles.photoRow}>
            {photos.map((p) => (
              <PhotoThumb key={p.id} uri={p.localUri} style={styles.thumb} onDelete={() => remove(p.id)} />
            ))}
          </View>
        ) : null}
        <View style={styles.actions}>
          <Text style={styles.action} onPress={() => add("camera")} accessibilityRole="button">
            📷 Take photo
          </Text>
          <Text style={styles.action} onPress={() => add("library")} accessibilityRole="button">
            🖼 From library
          </Text>
        </View>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 16 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  title: { fontFamily: fonts.display, fontSize: 15, fontWeight: "700", color: colors.text },
  hint: { fontSize: 13, color: colors.textMuted },
  photoRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 10, paddingTop: 4 },
  thumb: { width: 72, height: 72, borderRadius: 8 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 18, marginTop: 4 },
  action: { color: colors.primaryText, fontWeight: "600", fontSize: 13, paddingVertical: 12 },
});

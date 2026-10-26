import React, { useEffect, useState } from "react";
import { Modal, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { AuthImage } from "./AuthImage";

// A small photo that opens full screen when tapped - no pinching in to see
// what's in it. Tap anywhere (or Close) to go back.
//
// With `onDelete`, that one photo can be removed: a small x on the thumbnail
// (tap it, then tap "Delete?" to confirm), or "Delete this photo" in the full
// screen view. Only the photo chosen goes; the others stay.
export function PhotoThumb({ uri, style, onDelete }: { uri: string; style?: object; onDelete?: () => void }) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmingFull, setConfirmingFull] = useState(false);
  const { width, height } = useWindowDimensions();

  // The inline "Delete?" asks again, then gives up by itself.
  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 4000);
    return () => clearTimeout(t);
  }, [confirming]);

  function close() {
    setOpen(false);
    setConfirmingFull(false);
  }

  return (
    <View style={styles.wrap}>
      <Pressable onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel="Open photo full size">
        <AuthImage uri={uri} style={style} />
      </Pressable>
      {onDelete ? (
        confirming ? (
          <Pressable
            onPress={() => {
              setConfirming(false);
              onDelete();
            }}
            style={styles.confirmBadge}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel="Confirm delete this photo"
          >
            <Text style={styles.confirmText}>Delete?</Text>
          </Pressable>
        ) : (
          <Pressable onPress={() => setConfirming(true)} style={styles.badge} hitSlop={8} accessibilityRole="button" accessibilityLabel="Delete this photo">
            <Text style={styles.badgeText}>✕</Text>
          </Pressable>
        )
      ) : null}
      {open ? (
        <Modal visible transparent animationType="fade" onRequestClose={close} statusBarTranslucent>
          <Pressable style={styles.backdrop} onPress={close} accessibilityLabel="Close photo">
            <View style={{ width, height }} pointerEvents="none">
              <AuthImage uri={uri} style={{ width, height }} resizeMode="contain" />
            </View>
            <View style={styles.closeWrap} pointerEvents="box-none">
              <Pressable onPress={close} style={styles.close} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
                <Text style={styles.closeText}>✕  Close</Text>
              </Pressable>
            </View>
            {onDelete ? (
              <View style={styles.deleteWrap} pointerEvents="box-none">
                {confirmingFull ? (
                  <View style={styles.deleteRow}>
                    <Pressable
                      onPress={() => {
                        close();
                        onDelete();
                      }}
                      style={[styles.close, styles.deleteYes]}
                      accessibilityRole="button"
                    >
                      <Text style={styles.closeText}>Yes, delete this photo</Text>
                    </Pressable>
                    <Pressable onPress={() => setConfirmingFull(false)} style={styles.close} accessibilityRole="button">
                      <Text style={styles.closeText}>Keep it</Text>
                    </Pressable>
                  </View>
                ) : (
                  <Pressable onPress={() => setConfirmingFull(true)} style={styles.close} accessibilityRole="button" accessibilityLabel="Delete this photo">
                    <Text style={styles.closeText}>🗑  Delete this photo</Text>
                  </Pressable>
                )}
              </View>
            ) : null}
          </Pressable>
        </Modal>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "relative" },
  badge: { position: "absolute", top: -7, right: -7, width: 22, height: 22, borderRadius: 11, backgroundColor: "#002255", alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#fff" },
  badgeText: { color: "#fff", fontSize: 11, fontWeight: "800", lineHeight: 13 },
  confirmBadge: { position: "absolute", top: -9, right: -9, paddingHorizontal: 8, height: 24, borderRadius: 12, backgroundColor: "#C0392B", alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#fff" },
  confirmText: { color: "#fff", fontSize: 11, fontWeight: "800" },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.94)", ...(Platform.OS === "web" ? ({ cursor: "zoom-out" } as object) : null) },
  closeWrap: { position: "absolute", top: 0, left: 0, right: 0, paddingTop: Platform.OS === "web" ? 16 : 48, paddingHorizontal: 16, alignItems: "flex-end" },
  deleteWrap: { position: "absolute", bottom: 0, left: 0, right: 0, paddingBottom: Platform.OS === "web" ? 24 : 40, paddingHorizontal: 16, alignItems: "center" },
  deleteRow: { flexDirection: "row", gap: 10 },
  close: { backgroundColor: "rgba(255,255,255,0.18)", paddingVertical: 10, paddingHorizontal: 16, borderRadius: 999 },
  deleteYes: { backgroundColor: "#C0392B" },
  closeText: { color: "#fff", fontSize: 15, fontWeight: "700" },
});

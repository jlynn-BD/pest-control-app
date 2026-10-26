import React, { useState } from "react";
import { Modal, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { AuthImage } from "./AuthImage";

// A small photo that opens full screen when tapped - no pinching in to see
// what's in it. Tap anywhere (or Close) to go back.
export function PhotoThumb({ uri, style }: { uri: string; style?: object }) {
  const [open, setOpen] = useState(false);
  const { width, height } = useWindowDimensions();
  return (
    <>
      <Pressable onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel="Open photo full size">
        <AuthImage uri={uri} style={style} />
      </Pressable>
      {open ? (
        <Modal visible transparent animationType="fade" onRequestClose={() => setOpen(false)} statusBarTranslucent>
          <Pressable style={styles.backdrop} onPress={() => setOpen(false)} accessibilityLabel="Close photo">
            <View style={{ width, height }} pointerEvents="none">
              <AuthImage uri={uri} style={{ width, height }} resizeMode="contain" />
            </View>
            <View style={styles.closeWrap} pointerEvents="box-none">
              <Pressable onPress={() => setOpen(false)} style={styles.close} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
                <Text style={styles.closeText}>✕  Close</Text>
              </Pressable>
            </View>
          </Pressable>
        </Modal>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.94)", ...(Platform.OS === "web" ? ({ cursor: "zoom-out" } as object) : null) },
  closeWrap: { position: "absolute", top: 0, left: 0, right: 0, paddingTop: Platform.OS === "web" ? 16 : 48, paddingHorizontal: 16, alignItems: "flex-end" },
  close: { backgroundColor: "rgba(255,255,255,0.18)", paddingVertical: 10, paddingHorizontal: 16, borderRadius: 999 },
  closeText: { color: "#fff", fontSize: 15, fontWeight: "700" },
});

import React, { useMemo, useRef, useState } from "react";
import { LayoutChangeEvent, PanResponder, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "./ui";

// A spreadsheet-style scrollbar for the endless map: a track with a draggable
// thumb and an arrow at each end. The map has no edge, so the track covers the
// drawing, the original square and the current view, plus a screenful of
// empty sheet on each side - drag the thumb to the end and the sheet simply
// keeps going.

export const SCROLLBAR_THICKNESS = 22;

export function MapScrollbar({
  vertical = false,
  viewMin,
  viewSize,
  contentMin,
  contentMax,
  onScroll,
}: {
  vertical?: boolean;
  viewMin: number; // where the visible window starts (sheet units)
  viewSize: number; // how much of the sheet is visible (sheet units)
  contentMin: number; // the drawing (and original square) extent
  contentMax: number;
  onScroll: (newViewMin: number) => void;
}) {
  const [track, setTrack] = useState(0);
  const extentMin = Math.min(contentMin, 0, viewMin) - viewSize;
  const extentMax = Math.max(contentMax, 1, viewMin + viewSize) + viewSize;
  const extent = extentMax - extentMin;

  const thumbLen = Math.max(28, track * (viewSize / extent));
  const free = Math.max(1, track - thumbLen);
  const thumbPos = Math.min(free, Math.max(0, ((viewMin - extentMin) / extent) * track));

  // While a thumb is being dragged the track is frozen, otherwise it would
  // stretch under the finger as the sheet grows.
  const drag = useRef({ start: 0, extent: 1, track: 1, viewMin: 0 });
  const live = useRef({ extent, track, viewMin, onScroll });
  live.current = { extent, track, viewMin, onScroll };
  const [active, setActive] = useState(false);

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          const l = live.current;
          drag.current = { start: l.viewMin, extent: l.extent, track: l.track, viewMin: l.viewMin };
          setActive(true);
        },
        onPanResponderMove: (_e, g) => {
          const d = drag.current;
          const delta = vertical ? g.dy : g.dx;
          live.current.onScroll(d.start + (delta / d.track) * d.extent);
        },
        onPanResponderRelease: () => setActive(false),
        onPanResponderTerminate: () => setActive(false),
      }),
    [vertical]
  );

  // Tapping the empty track jumps a screenful towards the tap, like a spreadsheet.
  function onTrackPress(e: { nativeEvent: { locationX: number; locationY: number } }) {
    const at = vertical ? e.nativeEvent.locationY : e.nativeEvent.locationX;
    live.current.onScroll(viewMin + (at < thumbPos ? -viewSize : at > thumbPos + thumbLen ? viewSize : 0) * 0.9);
  }

  const step = (dir: 1 | -1) => onScroll(viewMin + dir * viewSize * 0.25);
  const arrows = vertical ? ["▲", "▼"] : ["◀", "▶"];

  return (
    <View style={vertical ? styles.vWrap : styles.hWrap}>
      <Pressable onPress={() => step(-1)} style={styles.arrow} accessibilityLabel={vertical ? "Scroll up" : "Scroll left"}>
        <Text style={styles.arrowText}>{arrows[0]}</Text>
      </Pressable>
      <Pressable
        style={vertical ? styles.vTrack : styles.hTrack}
        onPress={onTrackPress}
        onLayout={(e: LayoutChangeEvent) => setTrack(vertical ? e.nativeEvent.layout.height : e.nativeEvent.layout.width)}
        accessibilityLabel={vertical ? "Vertical scroll bar" : "Horizontal scroll bar"}
      >
        {track > 0 ? (
          <View
            {...responder.panHandlers}
            style={[
              styles.thumb,
              vertical ? { top: thumbPos, height: thumbLen, left: 3, right: 3 } : { left: thumbPos, width: thumbLen, top: 3, bottom: 3 },
              active && styles.thumbActive,
              Platform.OS === "web" ? ({ touchAction: "none", cursor: "grab" } as object) : null,
            ]}
          />
        ) : null}
      </Pressable>
      <Pressable onPress={() => step(1)} style={styles.arrow} accessibilityLabel={vertical ? "Scroll down" : "Scroll right"}>
        <Text style={styles.arrowText}>{arrows[1]}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  hWrap: { flexDirection: "row", alignItems: "stretch", height: SCROLLBAR_THICKNESS, marginTop: 6 },
  vWrap: { flexDirection: "column", alignItems: "stretch", width: SCROLLBAR_THICKNESS, marginLeft: 6 },
  hTrack: { flex: 1, backgroundColor: "#EAF0F8", borderRadius: 4, marginHorizontal: 2 },
  vTrack: { flex: 1, backgroundColor: "#EAF0F8", borderRadius: 4, marginVertical: 2 },
  thumb: { position: "absolute", backgroundColor: "#B6C4D8", borderRadius: 8 },
  thumbActive: { backgroundColor: "#8497B3" },
  arrow: { width: SCROLLBAR_THICKNESS, height: SCROLLBAR_THICKNESS, alignItems: "center", justifyContent: "center", borderRadius: 4, backgroundColor: "#F6F9FD" },
  arrowText: { fontSize: 9, color: colors.textMuted },
});

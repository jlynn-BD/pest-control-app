import React, { useMemo, useRef, useState } from "react";
import { Image, LayoutChangeEvent, PanResponder, Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Line as SvgLine, Polygon } from "react-native-svg";
import { arrowHeadPoints, gridLines, Line, Point } from "../lib/arrowGeometry";
import { colors } from "./ui";

export type SiteMapMode = "view" | "arrow" | "wall" | "label";

// Mirrors useSignaturePad's approach (custom SVG + PanResponder, no extra
// native dependency, works on `expo start --web` too). A drag in "arrow" or
// "wall" mode completes a line (arrow: becomes a Finding; wall: becomes a
// structure segment); a tap (near-zero movement) in "label" mode places a
// nameplate instead. One gesture responder handles all three so they never
// fight each other for the touch.
function useSiteMapGesture(
  mode: SiteMapMode,
  onLineComplete: (start: Point, end: Point) => void,
  onTap: (point: Point) => void,
  minLineLength = 12
) {
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const onLineCompleteRef = useRef(onLineComplete);
  onLineCompleteRef.current = onLineComplete;
  const onTapRef = useRef(onTap);
  onTapRef.current = onTap;
  const startRef = useRef<Point | null>(null);
  const [live, setLive] = useState<{ start: Point; end: Point } | null>(null);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => modeRef.current !== "view",
        onMoveShouldSetPanResponder: () => modeRef.current !== "view",
        onPanResponderGrant: (evt) => {
          const p = { x: evt.nativeEvent.locationX, y: evt.nativeEvent.locationY };
          startRef.current = p;
          if (modeRef.current !== "label") setLive({ start: p, end: p });
        },
        onPanResponderMove: (evt) => {
          if (!startRef.current || modeRef.current === "label") return;
          setLive({ start: startRef.current, end: { x: evt.nativeEvent.locationX, y: evt.nativeEvent.locationY } });
        },
        onPanResponderRelease: (evt) => {
          const start = startRef.current;
          startRef.current = null;
          setLive(null);
          if (!start) return;
          const end = { x: evt.nativeEvent.locationX, y: evt.nativeEvent.locationY };
          const dist = Math.hypot(end.x - start.x, end.y - start.y);
          if (modeRef.current === "label") {
            if (dist < minLineLength) onTapRef.current(start);
          } else if (dist >= minLineLength) {
            onLineCompleteRef.current(start, end);
          }
        },
      }),
    []
  );

  return { panHandlers: panResponder.panHandlers, live };
}

export interface SiteMapArrow {
  id: string;
  startX: number; // normalized 0-1
  startY: number;
  endX: number;
  endY: number;
  label: string;
  severity: string;
}

export interface SiteMapLabel {
  x: number;
  y: number;
  text: string;
}

const SEVERITY_COLOR: Record<string, string> = {
  LOW: colors.primary,
  MEDIUM: colors.warning,
  HIGH: colors.danger,
  CRITICAL: colors.danger,
};

export function SiteMapCanvas({
  imageUri,
  arrows,
  savedLines = [],
  pendingLines = [],
  labels = [],
  mode = "view",
  onArrowDrawn,
  onWallDrawn,
  onLabelTap,
  onArrowPress,
  height = 320,
}: {
  imageUri: string | null;
  arrows: SiteMapArrow[];
  savedLines?: Line[];
  pendingLines?: Line[];
  labels?: SiteMapLabel[];
  mode?: SiteMapMode;
  onArrowDrawn?: (start: Point, end: Point) => void;
  onWallDrawn?: (start: Point, end: Point) => void;
  onLabelTap?: (point: Point) => void;
  onArrowPress?: (arrowId: string) => void;
  height?: number;
}) {
  const [size, setSize] = useState({ width: 0, height: 0 });

  function handleLayout(e: LayoutChangeEvent) {
    const { width, height: h } = e.nativeEvent.layout;
    setSize({ width, height: h });
  }

  const { panHandlers, live } = useSiteMapGesture(
    mode,
    (start, end) => {
      if (size.width === 0 || size.height === 0) return;
      const norm = { start: { x: start.x / size.width, y: start.y / size.height }, end: { x: end.x / size.width, y: end.y / size.height } };
      if (mode === "arrow") onArrowDrawn?.(norm.start, norm.end);
      else if (mode === "wall") onWallDrawn?.(norm.start, norm.end);
    },
    (point) => {
      if (size.width === 0 || size.height === 0) return;
      onLabelTap?.({ x: point.x / size.width, y: point.y / size.height });
    }
  );

  const HINT_TEXT: Record<SiteMapMode, string | null> = {
    view: null,
    arrow: "Drag on the image to draw an arrow to the issue",
    wall: "Drag to draw a wall segment",
    label: "Tap to place a label",
  };

  return (
    <View style={[styles.container, { height }]} onLayout={handleLayout} {...panHandlers}>
      {imageUri ? <Image source={{ uri: imageUri }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
      {size.width > 0 ? (
        <Svg width={size.width} height={size.height} style={StyleSheet.absoluteFill} pointerEvents="none">
          {!imageUri
            ? gridLines(size.width, size.height).map((g, i) => (
                <SvgLine key={`grid-${i}`} x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2} stroke="#D5DBD8" strokeWidth={1} />
              ))
            : null}
          {savedLines.map((l, i) => (
            <SvgLine
              key={`wall-${i}`}
              x1={l.x1 * size.width}
              y1={l.y1 * size.height}
              x2={l.x2 * size.width}
              y2={l.y2 * size.height}
              stroke={colors.text}
              strokeWidth={3}
            />
          ))}
          {pendingLines.map((l, i) => (
            <SvgLine
              key={`pending-wall-${i}`}
              x1={l.x1 * size.width}
              y1={l.y1 * size.height}
              x2={l.x2 * size.width}
              y2={l.y2 * size.height}
              stroke={colors.primary}
              strokeWidth={3}
            />
          ))}
          {arrows.map((a) => {
            const start = { x: a.startX * size.width, y: a.startY * size.height };
            const end = { x: a.endX * size.width, y: a.endY * size.height };
            const color = SEVERITY_COLOR[a.severity] ?? colors.text;
            return (
              <React.Fragment key={a.id}>
                <SvgLine x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke={color} strokeWidth={2.5} />
                <Polygon points={arrowHeadPoints(start, end)} fill={color} />
              </React.Fragment>
            );
          })}
          {live ? (
            <>
              <SvgLine
                x1={live.start.x}
                y1={live.start.y}
                x2={live.end.x}
                y2={live.end.y}
                stroke={mode === "wall" ? colors.primary : colors.text}
                strokeWidth={2.5}
                strokeDasharray={mode === "wall" ? undefined : "4,3"}
              />
              {mode === "arrow" ? <Polygon points={arrowHeadPoints(live.start, live.end)} fill={colors.text} /> : null}
            </>
          ) : null}
        </Svg>
      ) : null}
      {size.width > 0
        ? labels.map((l, i) => (
            <View
              key={`label-${i}`}
              style={[
                styles.structureLabel,
                { left: Math.min(Math.max(l.x * size.width - 6, 4), size.width - 100), top: Math.min(Math.max(l.y * size.height - 10, 4), size.height - 22) },
              ]}
            >
              <Text style={styles.structureLabelText} numberOfLines={1}>
                {l.text}
              </Text>
            </View>
          ))
        : null}
      {size.width > 0
        ? arrows.map((a) => (
            <Pressable
              key={a.id}
              onPress={() => onArrowPress?.(a.id)}
              style={[
                styles.labelBubble,
                {
                  left: Math.min(Math.max(a.startX * size.width - 60, 4), size.width - 124),
                  top: Math.min(Math.max(a.startY * size.height - 14, 4), size.height - 28),
                  borderColor: SEVERITY_COLOR[a.severity] ?? colors.text,
                },
              ]}
            >
              <Text style={styles.labelText} numberOfLines={1}>
                {a.label}
              </Text>
            </Pressable>
          ))
        : null}
      {HINT_TEXT[mode] ? (
        <View style={styles.hintBanner} pointerEvents="none">
          <Text style={styles.hintText}>{HINT_TEXT[mode]}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#ffffff",
    overflow: "hidden",
  },
  labelBubble: {
    position: "absolute",
    width: 120,
    paddingHorizontal: 6,
    paddingVertical: 3,
    backgroundColor: "rgba(255,255,255,0.92)",
    borderRadius: 6,
    borderWidth: 1.5,
  },
  labelText: { fontSize: 11, fontWeight: "600", color: colors.text },
  structureLabel: {
    position: "absolute",
    paddingHorizontal: 6,
    paddingVertical: 2,
    backgroundColor: colors.chip,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  structureLabelText: { fontSize: 11, fontWeight: "700", color: colors.primary },
  hintBanner: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(26,36,33,0.75)",
    paddingVertical: 6,
    alignItems: "center",
  },
  hintText: { color: "#fff", fontSize: 12, fontWeight: "600" },
});

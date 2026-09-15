import type { SiteMapAnnotation, SiteMapAnnotationType } from "@pest-app/shared";
import React, { useMemo, useRef, useState } from "react";
import { Image, LayoutChangeEvent, PanResponder, Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Line as SvgLine, Polygon, Rect } from "react-native-svg";
import { arrowHeadPoints, gridLines, Line, Point } from "../lib/arrowGeometry";
import { colors } from "./ui";

export type SiteMapMode = "view" | "arrow" | "wall" | "label" | "annotate";

// Was previously rendered as an absolutely-positioned overlay INSIDE the
// canvas (bottom edge, full width) - a technician found that box sitting
// over the drawing surface itself would swallow the drag gesture starting
// under it, so drawing through that area silently did nothing. Now a plain
// function SiteMapScreen calls to render a normal line of text above the
// canvas, entirely outside its bounds, so there is no overlay left to
// intercept a touch at all.
export function siteMapHintText(mode: SiteMapMode, annotationType?: SiteMapAnnotationType): string | null {
  switch (mode) {
    case "arrow":
      return "Drag on the image to draw an arrow to the issue";
    case "wall":
      return "Drag to draw a wall segment";
    case "label":
      return "Tap to place a label";
    case "annotate":
      if (annotationType === "x") return "Tap to place an X mark";
      if (annotationType === "rect") return "Drag to draw a shape";
      return "Drag to draw an arrow";
    default:
      return null;
  }
}

// Mirrors useSignaturePad's approach (custom SVG + PanResponder, no extra
// native dependency, works on `expo start --web` too). A drag completes a
// line (arrow: becomes a Finding; wall: becomes a structure segment;
// annotate+arrow/rect: becomes a lightweight annotation); a tap in "label"
// mode or "annotate"+X placement completes at a single point instead.
// `completesOnTap` tells the gesture which behavior the current mode/
// sub-type wants, so one responder handles all of them without fighting
// over the touch.
function useSiteMapGesture(
  mode: SiteMapMode,
  completesOnTap: boolean,
  onLineComplete: (start: Point, end: Point) => void,
  onTap: (point: Point) => void,
  minLineLength = 12
) {
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const completesOnTapRef = useRef(completesOnTap);
  completesOnTapRef.current = completesOnTap;
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
          if (!completesOnTapRef.current) setLive({ start: p, end: p });
        },
        onPanResponderMove: (evt) => {
          if (!startRef.current || completesOnTapRef.current) return;
          setLive({ start: startRef.current, end: { x: evt.nativeEvent.locationX, y: evt.nativeEvent.locationY } });
        },
        onPanResponderRelease: (evt) => {
          const start = startRef.current;
          startRef.current = null;
          setLive(null);
          if (!start) return;
          const end = { x: evt.nativeEvent.locationX, y: evt.nativeEvent.locationY };
          const dist = Math.hypot(end.x - start.x, end.y - start.y);
          if (completesOnTapRef.current) {
            if (dist < minLineLength) onTapRef.current(start);
          } else if (dist >= minLineLength) {
            onLineCompleteRef.current(start, end);
          }
        },
        // Without this, a mostly-vertical drag (e.g. a wall drawn straight
        // down) reads to the parent ScrollView as a scroll gesture partway
        // through, which steals the responder - a technician hit exactly
        // this, a drawn line "cutting off in the middle". Refusing every
        // termination request keeps the whole drag with this canvas once it
        // starts. onPanResponderTerminate is a fallback for termination that
        // can't be refused (e.g. an incoming call) so a stolen gesture at
        // least clears its frozen preview line instead of leaving it stuck.
        onPanResponderTerminationRequest: () => false,
        onPanResponderTerminate: () => {
          startRef.current = null;
          setLive(null);
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
  id: string;
  x: number;
  y: number;
  text: string;
}

type WallLine = Line & { id: string };

// A wall is a thin line, too small a target to tap accurately on a touch
// screen - this expands it to a padded rectangle around its bounding box for
// the invisible hit-area Pressable rendered alongside it.
function wallHitRect(l: WallLine, width: number, height: number, pad = 14) {
  const x1 = l.x1 * width;
  const y1 = l.y1 * height;
  const x2 = l.x2 * width;
  const y2 = l.y2 * height;
  return {
    left: Math.min(x1, x2) - pad,
    top: Math.min(y1, y2) - pad,
    width: Math.abs(x2 - x1) + pad * 2,
    height: Math.abs(y2 - y1) + pad * 2,
  };
}

// Same idea as wallHitRect but for an annotation, whose geometry is either a
// single point ("x", x2/y2 unset), a line ("arrow"), or a bounding box
// ("rect") - defaulting the missing corner to the start point makes a
// single formula work for all three.
function annotationHitRect(a: SiteMapAnnotation, width: number, height: number, pad = 14) {
  const x1 = a.x1 * width;
  const y1 = a.y1 * height;
  const x2 = (a.x2 ?? a.x1) * width;
  const y2 = (a.y2 ?? a.y1) * height;
  return {
    left: Math.min(x1, x2) - pad,
    top: Math.min(y1, y2) - pad,
    width: Math.abs(x2 - x1) + pad * 2,
    height: Math.abs(y2 - y1) + pad * 2,
  };
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
  annotations = [],
  mode = "view",
  annotationType,
  annotationColor,
  onArrowDrawn,
  onWallDrawn,
  onLabelTap,
  onAnnotationDrawn,
  onArrowPress,
  onLabelPress,
  onWallPress,
  onAnnotationPress,
  selectedLabelId = null,
  selectedWallId = null,
  selectedAnnotationId = null,
  height = 320,
}: {
  imageUri: string | null;
  arrows: SiteMapArrow[];
  savedLines?: WallLine[];
  pendingLines?: WallLine[];
  labels?: SiteMapLabel[];
  annotations?: SiteMapAnnotation[];
  mode?: SiteMapMode;
  annotationType?: SiteMapAnnotationType;
  annotationColor?: string;
  onArrowDrawn?: (start: Point, end: Point) => void;
  onWallDrawn?: (start: Point, end: Point) => void;
  onLabelTap?: (point: Point) => void;
  onAnnotationDrawn?: (type: SiteMapAnnotationType, color: string, start: Point, end: Point) => void;
  onArrowPress?: (arrowId: string) => void;
  onLabelPress?: (labelId: string) => void;
  onWallPress?: (wallId: string) => void;
  onAnnotationPress?: (annotationId: string) => void;
  selectedLabelId?: string | null;
  selectedWallId?: string | null;
  selectedAnnotationId?: string | null;
  height?: number;
}) {
  const [size, setSize] = useState({ width: 0, height: 0 });

  function handleLayout(e: LayoutChangeEvent) {
    const { width, height: h } = e.nativeEvent.layout;
    setSize({ width, height: h });
  }

  const completesOnTap = mode === "label" || (mode === "annotate" && annotationType === "x");

  const { panHandlers, live } = useSiteMapGesture(
    mode,
    completesOnTap,
    (start, end) => {
      if (size.width === 0 || size.height === 0) return;
      const norm = { start: { x: start.x / size.width, y: start.y / size.height }, end: { x: end.x / size.width, y: end.y / size.height } };
      if (mode === "arrow") onArrowDrawn?.(norm.start, norm.end);
      else if (mode === "wall") onWallDrawn?.(norm.start, norm.end);
      else if (mode === "annotate" && annotationType && annotationType !== "x" && annotationColor) {
        onAnnotationDrawn?.(annotationType, annotationColor, norm.start, norm.end);
      }
    },
    (point) => {
      if (size.width === 0 || size.height === 0) return;
      const norm = { x: point.x / size.width, y: point.y / size.height };
      if (mode === "label") onLabelTap?.(norm);
      else if (mode === "annotate" && annotationType === "x" && annotationColor) onAnnotationDrawn?.("x", annotationColor, norm, norm);
    }
  );

  return (
    <View style={[styles.container, { height }]} onLayout={handleLayout} {...panHandlers}>
      {imageUri ? <Image source={{ uri: imageUri }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
      {size.width > 0 ? (
        <Svg width={size.width} height={size.height} style={StyleSheet.absoluteFill} pointerEvents="none">
          {!imageUri
            ? (() => {
                const grid = gridLines(size.width, size.height);
                return (
                  <>
                    {grid.minor.map((g, i) => (
                      <SvgLine key={`grid-minor-${i}`} x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2} stroke="#E1E6E3" strokeWidth={0.75} />
                    ))}
                    {grid.major.map((g, i) => (
                      <SvgLine key={`grid-major-${i}`} x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2} stroke="#B9C2BD" strokeWidth={1.25} />
                    ))}
                  </>
                );
              })()
            : null}
          {savedLines.map((l) => (
            <SvgLine
              key={`wall-${l.id}`}
              x1={l.x1 * size.width}
              y1={l.y1 * size.height}
              x2={l.x2 * size.width}
              y2={l.y2 * size.height}
              stroke={l.id === selectedWallId ? colors.danger : colors.text}
              strokeWidth={l.id === selectedWallId ? 5 : 3}
            />
          ))}
          {pendingLines.map((l) => (
            <SvgLine
              key={`pending-wall-${l.id}`}
              x1={l.x1 * size.width}
              y1={l.y1 * size.height}
              x2={l.x2 * size.width}
              y2={l.y2 * size.height}
              stroke={l.id === selectedWallId ? colors.danger : colors.primary}
              strokeWidth={l.id === selectedWallId ? 5 : 3}
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
          {/* Lightweight X-mark/arrow/shape annotations, not tied to a
              Finding - Tate's "sometimes the technician simply needs to
              visually identify an area" ask. */}
          {annotations.map((a) => {
            const selected = a.id === selectedAnnotationId;
            if (a.type === "x") {
              const cx = a.x1 * size.width;
              const cy = a.y1 * size.height;
              const r = selected ? 10 : 8;
              return (
                <React.Fragment key={`ann-${a.id}`}>
                  <SvgLine x1={cx - r} y1={cy - r} x2={cx + r} y2={cy + r} stroke={a.color} strokeWidth={selected ? 4 : 3} strokeLinecap="round" />
                  <SvgLine x1={cx - r} y1={cy + r} x2={cx + r} y2={cy - r} stroke={a.color} strokeWidth={selected ? 4 : 3} strokeLinecap="round" />
                </React.Fragment>
              );
            }
            if (a.type === "arrow") {
              const start = { x: a.x1 * size.width, y: a.y1 * size.height };
              const end = { x: (a.x2 ?? a.x1) * size.width, y: (a.y2 ?? a.y1) * size.height };
              return (
                <React.Fragment key={`ann-${a.id}`}>
                  <SvgLine x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke={a.color} strokeWidth={selected ? 4 : 2.5} />
                  <Polygon points={arrowHeadPoints(start, end)} fill={a.color} />
                </React.Fragment>
              );
            }
            const rx1 = Math.min(a.x1, a.x2 ?? a.x1) * size.width;
            const ry1 = Math.min(a.y1, a.y2 ?? a.y1) * size.height;
            const rw = Math.abs((a.x2 ?? a.x1) - a.x1) * size.width;
            const rh = Math.abs((a.y2 ?? a.y1) - a.y1) * size.height;
            return (
              <Rect
                key={`ann-${a.id}`}
                x={rx1}
                y={ry1}
                width={rw}
                height={rh}
                stroke={a.color}
                strokeWidth={selected ? 3 : 2}
                fill={a.color}
                fillOpacity={0.15}
                rx={4}
              />
            );
          })}
          {live ? (
            mode === "annotate" && annotationType === "rect" ? (
              <Rect
                x={Math.min(live.start.x, live.end.x)}
                y={Math.min(live.start.y, live.end.y)}
                width={Math.abs(live.end.x - live.start.x)}
                height={Math.abs(live.end.y - live.start.y)}
                stroke={annotationColor ?? colors.text}
                strokeWidth={2}
                strokeDasharray="4,3"
                fill={annotationColor ?? colors.text}
                fillOpacity={0.12}
                rx={4}
              />
            ) : (
              <>
                <SvgLine
                  x1={live.start.x}
                  y1={live.start.y}
                  x2={live.end.x}
                  y2={live.end.y}
                  stroke={mode === "wall" ? colors.primary : mode === "annotate" ? annotationColor ?? colors.text : colors.text}
                  strokeWidth={2.5}
                  strokeDasharray={mode === "wall" ? undefined : "4,3"}
                />
                {mode === "arrow" || (mode === "annotate" && annotationType === "arrow") ? (
                  <Polygon points={arrowHeadPoints(live.start, live.end)} fill={mode === "annotate" ? annotationColor ?? colors.text : colors.text} />
                ) : null}
              </>
            )
          ) : null}
        </Svg>
      ) : null}
      {size.width > 0 && mode === "view"
        ? [...savedLines, ...pendingLines].map((l) => (
            <Pressable
              key={`wall-hit-${l.id}`}
              onPress={() => onWallPress?.(l.id)}
              style={[styles.wallHitArea, wallHitRect(l, size.width, size.height)]}
            />
          ))
        : null}
      {/* Also active while placing a new X mark (not arrow/rect - those
          complete on a drag, and letting an existing annotation's hit-area
          claim the touch-start would swallow that drag the same way labels
          used to swallow wall-drawing gestures). X placement is a tap, same
          gesture shape as selecting an existing one, so a tap landing on
          top of an already-placed annotation is far more likely to mean
          "that one" than "a new one exactly here" - lets a technician
          clean up a duplicate/misplaced X immediately without first
          backing out of X-mark mode. */}
      {size.width > 0 && (mode === "view" || (mode === "annotate" && annotationType === "x"))
        ? annotations.map((a) => (
            <Pressable
              key={`ann-hit-${a.id}`}
              onPress={() => onAnnotationPress?.(a.id)}
              style={[styles.wallHitArea, annotationHitRect(a, size.width, size.height)]}
            />
          ))
        : null}
      {/* pointerEvents is forced to "none" while actively drawing (any mode
          but "view") - otherwise an existing label or marker sitting under
          where a technician is trying to draw a new wall/arrow/label
          silently claims that touch before the canvas's own PanResponder
          ever sees it, since a child Pressable wins the touch-responder
          negotiation by default. A technician hit exactly this: dragging
          through a label near the middle of the map did nothing, and
          placing a new marker in that same spot was just as stuck. */}
      {size.width > 0
        ? labels.map((l) => (
            <Pressable
              key={`label-${l.id}`}
              onPress={() => onLabelPress?.(l.id)}
              pointerEvents={mode === "view" ? "auto" : "none"}
              style={[
                styles.structureLabel,
                l.id === selectedLabelId && styles.structureLabelSelected,
                { left: Math.min(Math.max(l.x * size.width - 6, 4), size.width - 100), top: Math.min(Math.max(l.y * size.height - 10, 4), size.height - 22) },
              ]}
            >
              <Text style={styles.structureLabelText} numberOfLines={1}>
                {l.text}
              </Text>
            </Pressable>
          ))
        : null}
      {size.width > 0
        ? arrows.map((a) => (
            <Pressable
              key={a.id}
              onPress={() => onArrowPress?.(a.id)}
              pointerEvents={mode === "view" ? "auto" : "none"}
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
  structureLabelSelected: { borderWidth: 2, borderColor: colors.danger },
  wallHitArea: { position: "absolute" },
});

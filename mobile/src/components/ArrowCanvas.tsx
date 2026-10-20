import { formatFeet, gridFeet, resolveGrid } from "@pest-app/shared";
import type { SiteMapAnnotation, SiteMapAnnotationType, SiteMapGrid } from "@pest-app/shared";
import React, { useMemo, useRef, useState } from "react";
import { LayoutChangeEvent, PanResponder, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Line as SvgLine, Polygon, Rect, Text as SvgText } from "react-native-svg";
import { arrowHeadPoints, gridLines, Line, Point } from "../lib/arrowGeometry";
import { API_BASE_URL } from "../api/config";
import { AuthImage } from "./AuthImage";
import { colors } from "./ui";

export type SiteMapMode = "view" | "arrow" | "wall" | "label" | "annotate" | "measure" | "grid";

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
      return "Tap to place a label (tap inside a shape to name it)";
    case "measure":
      return "Drag from one point to another to measure it - the distance stays on the map";
    case "grid":
      return "Drag the map to move the grid, and use the size buttons to scale it";
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
  // Pulls a point (pixels) onto the grid / a nearby wall end while drawing
  // walls and shapes; `from` is the already-placed start of the line.
  snapPoint?: (p: Point, from?: Point) => Point,
  minLineLength = 12
) {
  const snapRef = useRef(snapPoint);
  snapRef.current = snapPoint;
  const snap = (p: Point, from?: Point) => (snapRef.current ? snapRef.current(p, from) : p);
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
  // Exactly where the pointer is right now (finger or mouse), so the canvas
  // can draw a crosshair there - a fingertip hides the spot it is pointing at.
  const [pointer, setPointer] = useState<Point | null>(null);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => modeRef.current !== "view",
        onMoveShouldSetPanResponder: () => modeRef.current !== "view",
        onPanResponderGrant: (evt) => {
          const p = snap({ x: evt.nativeEvent.locationX, y: evt.nativeEvent.locationY });
          startRef.current = p;
          setPointer(p);
          if (!completesOnTapRef.current) setLive({ start: p, end: p });
        },
        onPanResponderMove: (evt) => {
          const raw = { x: evt.nativeEvent.locationX, y: evt.nativeEvent.locationY };
          const here = startRef.current && !completesOnTapRef.current ? snap(raw, startRef.current) : raw;
          setPointer(here);
          if (!startRef.current || completesOnTapRef.current) return;
          setLive({ start: startRef.current, end: here });
        },
        onPanResponderRelease: (evt) => {
          const start = startRef.current;
          startRef.current = null;
          setLive(null);
          setPointer(null);
          if (!start) return;
          const rawEnd = { x: evt.nativeEvent.locationX, y: evt.nativeEvent.locationY };
          const end = completesOnTapRef.current ? rawEnd : snap(rawEnd, start);
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
          setPointer(null);
        },
      }),
    []
  );

  // Mouse hover (desktop/iPad with a trackpad): follow the cursor before any
  // press so the aim point is visible while choosing where to start.
  const hoverProps =
    Platform.OS === "web"
      ? ({
          onMouseMove: (e: { clientX: number; clientY: number; currentTarget: { getBoundingClientRect: () => DOMRect } }) => {
            if (modeRef.current === "view" || startRef.current) return;
            const r = e.currentTarget.getBoundingClientRect();
            setPointer(snap({ x: e.clientX - r.left, y: e.clientY - r.top }));
          },
          onMouseLeave: () => {
            if (!startRef.current) setPointer(null);
          },
        } as object)
      : {};

  return { panHandlers: panResponder.panHandlers, live, pointer, hoverProps };
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

// A label is just a point + text, not a box - this gives it a generously
// sized, fixed-size drag target around wherever its chip renders (see the
// labels overlay below), clamped to stay on-screen the same way the chip
// itself is.
function labelHitRect(l: { x: number; y: number }, width: number, height: number) {
  const w = 110;
  const h = 40;
  return {
    left: Math.min(Math.max(l.x * width - 20, 0), Math.max(width - w, 0)),
    top: Math.min(Math.max(l.y * height - 24, 0), Math.max(height - h, 0)),
    width: w,
    height: h,
  };
}

const SEVERITY_COLOR: Record<string, string> = {
  LOW: colors.primary,
  MEDIUM: colors.warning,
  HIGH: colors.danger,
  CRITICAL: colors.danger,
};

// On a phone the browser treats a finger drag as "scroll the page" unless the
// element says otherwise - which made the whole screen slide around while
// drawing or dragging a shape. touch-action: none on the drawing surface (and
// the drag handles) keeps those touches for the app. Web only; the phone app
// has no such default.
// Keeps iOS from selecting text / showing the Copy-Look Up callout when a
// finger rests or drags on the map (seen on a technician's iPad).
const NO_SELECT = Platform.OS === "web" ? ({ userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none" } as object) : null;
const NO_PAGE_SCROLL = Platform.OS === "web" ? ({ touchAction: "none" } as object) : null;

export type Geometry = { x1: number; y1: number; x2?: number; y2?: number };
type HandleKind = "move" | "p1" | "p2" | "tl" | "tr" | "bl" | "br";

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

// ---- Snapping & picking -----------------------------------------------
// Grid cells match the faint background grid (40 minor divisions).
// Pixel distance within which a point is pulled onto a nearby wall end / the
// grid, and the angle (radians) within which a wall is locked level/plumb.
const MAGNET_PX = 14;
const AXIS_LOCK_RAD = (6 * Math.PI) / 180;
// Two wall ends this close (fraction of the map) count as one connected corner.
const CORNER_EPS = 0.006;

type Pt = { x: number; y: number };

// Pulls a point (normalized) onto a nearby wall end if one is within reach,
// otherwise onto the grid. `from` is the fixed other end of the line being
// drawn/edited: when the result is within a few degrees of level or plumb it
// is locked exactly level/plumb.
function snapNormalized(p: Pt, ends: Pt[], width: number, height: number, from?: Pt, grid?: SiteMapGrid): Pt {
  const cell = grid?.cell ?? 1 / 40;
  const ox = grid?.ox ?? 0;
  const oy = grid?.oy ?? 0;
  let best: Pt | null = null;
  let bestD = MAGNET_PX;
  for (const e of ends) {
    const d = Math.hypot((e.x - p.x) * width, (e.y - p.y) * height);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  if (best) return { x: best.x, y: best.y };
  let out = { x: Math.round((p.x - ox) / cell) * cell + ox, y: Math.round((p.y - oy) / cell) * cell + oy };
  if (from) {
    const dx = (p.x - from.x) * width;
    const dy = (p.y - from.y) * height;
    const len = Math.hypot(dx, dy);
    if (len > 8) {
      const ang = Math.atan2(Math.abs(dy), Math.abs(dx));
      if (ang < AXIS_LOCK_RAD) out = { x: out.x, y: from.y };
      else if (Math.PI / 2 - ang < AXIS_LOCK_RAD) out = { x: from.x, y: out.y };
    }
  }
  return { x: clamp01(out.x), y: clamp01(out.y) };
}

function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

// How far (px) a tap is from a wall / annotation - the real shape, not its
// padded bounding box, so the nearest thing to the finger wins.
// How an annotation counts when working out what a tap is nearest to: a saved
// measurement is a line, like an arrow.
function elementKind(a: { type: SiteMapAnnotationType }): "x" | "arrow" | "rect" {
  return a.type === "measure" ? "arrow" : a.type;
}

function distToElement(
  tapX: number,
  tapY: number,
  g: { x1: number; y1: number; x2?: number; y2?: number },
  type: "wall" | "x" | "arrow" | "rect",
  width: number,
  height: number
): number {
  const x1 = g.x1 * width;
  const y1 = g.y1 * height;
  if (type === "x") return Math.hypot(tapX - x1, tapY - y1);
  const x2 = (g.x2 ?? g.x1) * width;
  const y2 = (g.y2 ?? g.y1) * height;
  if (type !== "rect") return distToSegment(tapX, tapY, x1, y1, x2, y2);
  const minX = Math.min(x1, x2);
  const maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2);
  const maxY = Math.max(y1, y2);
  const inside = tapX >= minX && tapX <= maxX && tapY >= minY && tapY <= maxY;
  const edge = Math.min(
    distToSegment(tapX, tapY, minX, minY, maxX, minY),
    distToSegment(tapX, tapY, maxX, minY, maxX, maxY),
    distToSegment(tapX, tapY, maxX, maxY, minX, maxY),
    distToSegment(tapX, tapY, minX, maxY, minX, minY)
  );
  // Inside a box counts as a modest distance, so a wall or a small shape
  // drawn over a big room is still the one picked when tapped near it.
  return inside ? Math.min(edge, 12) : edge;
}

// New shape geometry after dragging a handle by (dxn, dyn), both as fractions
// of the map size. "move" slides the whole shape but stops at the map edge;
// p1/p2 move one end of a line or arrow; the tl/tr/bl/br corners resize a
// rectangle with the opposite corner held still.
function applyDrag(base: Geometry, kind: HandleKind, dxn: number, dyn: number): Geometry {
  const bx2 = base.x2 ?? base.x1;
  const by2 = base.y2 ?? base.y1;
  const minX = Math.min(base.x1, bx2);
  const maxX = Math.max(base.x1, bx2);
  const minY = Math.min(base.y1, by2);
  const maxY = Math.max(base.y1, by2);
  if (kind === "move") {
    const sx = Math.min(1 - maxX, Math.max(-minX, dxn));
    const sy = Math.min(1 - maxY, Math.max(-minY, dyn));
    return base.x2 === undefined
      ? { x1: base.x1 + sx, y1: base.y1 + sy }
      : { x1: base.x1 + sx, y1: base.y1 + sy, x2: base.x2 + sx, y2: (base.y2 ?? base.y1) + sy };
  }
  if (kind === "p1") return { ...base, x1: clamp01(base.x1 + dxn), y1: clamp01(base.y1 + dyn) };
  if (kind === "p2") return { ...base, x2: clamp01(bx2 + dxn), y2: clamp01(by2 + dyn) };
  // A corner had no lower bound on the resulting size - dragging it past the
  // opposite corner collapsed the box to a sliver (or flipped it inside out),
  // and a small shape's corners sit close enough together that this was easy
  // to trigger by accident while trying to resize one (seen on a
  // technician's iPad: a shape shrank to nothing while being resized).
  // MIN_SIZE keeps a resized rect at least this big (normalized 0-1, so 3%
  // of the map's width/height - small enough to still shrink a shape
  // substantially, big enough to stay visible and grabbable).
  const MIN_SIZE = 0.03;
  const left = kind === "tl" || kind === "bl";
  const top = kind === "tl" || kind === "tr";
  const rawX = (left ? minX : maxX) + dxn;
  const rawY = (top ? minY : maxY) + dyn;
  return {
    x1: clamp01(left ? Math.min(rawX, maxX - MIN_SIZE) : Math.max(rawX, minX + MIN_SIZE)),
    y1: clamp01(top ? Math.min(rawY, maxY - MIN_SIZE) : Math.max(rawY, minY + MIN_SIZE)),
    x2: left ? maxX : minX,
    y2: top ? maxY : minY,
  };
}

// A touch target that reports how far the finger has travelled since it went
// down (dx/dy in pixels) - used for both the resize handles and the "drag the
// shape itself to move it" surface. It refuses to give the gesture up, so a
// drag that drifts vertically can't be stolen by the page scroll.
const AIM_COLOR = "#1F7A5C";
// Distance lines and their readouts.
export const MEASURE_COLOR = "#2E6DA4";

// Mouse users see an open hand over anything draggable.
// Crosshair cursor over the map while a drawing tool is active.
function drawCursor(mode: SiteMapMode): object | null {
  return Platform.OS === "web" ? ({ cursor: mode === "view" ? "default" : mode === "grid" ? "move" : "crosshair" } as object) : null;
}

const GRAB_CURSOR = Platform.OS === "web" ? ({ cursor: "grab" } as object) : null;

function DragSurface({
  style,
  onDrag,
  onDrop,
  onCancel,
  onTap,
  children,
  pointerEvents,
}: {
  pointerEvents?: "auto" | "none";
  // A touch that ended without moving: where it landed, inside this surface.
  onTap?: (x: number, y: number) => void;
  style: object;
  onDrag: (dx: number, dy: number) => void;
  onDrop: (dx: number, dy: number) => void;
  onCancel: () => void;
  children?: React.ReactNode;
}) {
  const dragRef = useRef(onDrag);
  dragRef.current = onDrag;
  const dropRef = useRef(onDrop);
  dropRef.current = onDrop;
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;
  const tapRef = useRef(onTap);
  tapRef.current = onTap;
  const downAt = useRef({ x: 0, y: 0 });
  // Distance travelled is worked out from the finger's position at each
  // event rather than the responder's running totals, which only update on
  // move events - so a quick flick that jumps straight to its end point still
  // reports the right distance.
  const startRef = useRef({ x: 0, y: 0 });
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e) => {
          startRef.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY };
          downAt.current = { x: e.nativeEvent.locationX, y: e.nativeEvent.locationY };
        },
        onPanResponderMove: (e) => dragRef.current(e.nativeEvent.pageX - startRef.current.x, e.nativeEvent.pageY - startRef.current.y),
        onPanResponderRelease: (e) => {
          const dx = e.nativeEvent.pageX - startRef.current.x;
          const dy = e.nativeEvent.pageY - startRef.current.y;
          dropRef.current(dx, dy);
          if (Math.abs(dx) < 3 && Math.abs(dy) < 3) tapRef.current?.(downAt.current.x, downAt.current.y);
        },
        onPanResponderTerminationRequest: () => false,
        onPanResponderTerminate: () => cancelRef.current(),
      }),
    []
  );
  return (
    <View {...responder.panHandlers} pointerEvents={pointerEvents} style={[style, NO_PAGE_SCROLL, GRAB_CURSOR]}>
      {children}
    </View>
  );
}

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
  onAnnotationChange,
  onWallChange,
  onWallsChange,
  onLabelChange,
  onCaptionChange,
  onMeasureDrawn,
  onGridChange,
  grid: gridProp,
  snap = true,
  selectedLabelId = null,
  selectedWallId = null,
  selectedAnnotationId = null,
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
  // Called once, when a finger lifts after moving/resizing the selected
  // shape; resolves once the change is saved.
  onAnnotationChange?: (annotationId: string, geometry: Geometry) => Promise<unknown> | void;
  onWallChange?: (wallId: string, geometry: Required<Geometry>) => Promise<unknown> | void;
  // Several walls changed by one drag (a wall end dragged together with the
  // other walls joined to it) - saved as a single edit so Undo reverses it all.
  onWallsChange?: (changes: { id: string; geometry: Required<Geometry> }[]) => Promise<unknown> | void;
  // Pull drawn/dragged points onto the grid and onto nearby wall ends, and
  // lock near-level/plumb walls exactly level/plumb.
  snap?: boolean;
  // The level's layout grid / ruler (see SiteMapGrid). Unset = the default grid.
  grid?: SiteMapGrid;
  // "measure" mode: a distance was dragged out between two points.
  onMeasureDrawn?: (start: Point, end: Point) => void;
  // "grid" mode: the grid was dragged to a new position.
  onGridChange?: (grid: SiteMapGrid) => void;
  // Called once, when a finger lifts after dragging the selected label to a
  // new spot - same "commit on drop" shape as onAnnotationChange/onWallChange.
  onLabelChange?: (labelId: string, point: Point) => Promise<unknown> | void;
  // A shape's name dragged to a new spot on it (offset from the shape's top-left).
  onCaptionChange?: (annotationId: string, offset: { dx: number; dy: number }) => Promise<unknown> | void;
  selectedLabelId?: string | null;
  selectedWallId?: string | null;
  selectedAnnotationId?: string | null;
}) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const grid = resolveGrid(gridProp);
  // Shape being dragged right now: shown at its in-progress position, and
  // only saved when the finger lifts.
  const [draft, setDraft] = useState<{
    kind: "annotation" | "wall";
    id: string;
    g: Geometry;
    // Walls joined to the one being dragged, moving with it.
    also?: { id: string; g: Required<Geometry> }[];
  } | null>(null);
  // Kept separate from `draft` above - a label's geometry is a bare point
  // (SiteMapLabel has x/y, not the x1/y1/x2/y2 shape walls/annotations use),
  // and dragging one is never happening at the same time as dragging a
  // wall/shape (only one thing is ever selected at once), so there is no
  // need to unify them into one state slot.
  const [draftLabel, setDraftLabel] = useState<{ id: string; x: number; y: number } | null>(null);
  // A shape name being dragged right now (offset from the shape's corner).
  const [draftCaption, setDraftCaption] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const shownAnnotations = annotations.map((a) => (draft?.kind === "annotation" && draft.id === a.id ? { ...a, ...draft.g } : a));
  const shownWalls = savedLines.map((l) => {
    if (draft?.kind !== "wall") return l;
    if (draft.id === l.id) return { ...l, ...(draft.g as Required<Geometry>) };
    const joined = draft.also?.find((o) => o.id === l.id);
    return joined ? { ...l, ...joined.g } : l;
  });

  // A length on the map, as feet and inches.
  const lengthText = (x1: number, y1: number, x2: number, y2: number) =>
    size.width === 0 ? "" : formatFeet(gridFeet(grid, x2 - x1, ((y2 - y1) * size.height) / size.width));

  // Every wall end on the map (other than the given wall): what a dragged end
  // can snap to.
  function wallEnds(excludeId?: string): Pt[] {
    const out: Pt[] = [];
    for (const l of [...savedLines, ...pendingLines]) {
      if (l.id === excludeId) continue;
      out.push({ x: l.x1, y: l.y1 }, { x: l.x2, y: l.y2 });
    }
    return out;
  }
  const snapsNow = snap && (mode === "wall" || mode === "measure" || (mode === "annotate" && annotationType === "rect"));
  // Pixel-space wrapper for the drawing gesture.
  function snapPixels(p: Point, from?: Point): Point {
    if (!snapsNow || size.width === 0 || size.height === 0) return p;
    const n = snapNormalized(
      { x: p.x / size.width, y: p.y / size.height },
      mode === "wall" || mode === "measure" ? wallEnds() : [],
      size.width,
      size.height,
      from && (mode === "wall" || mode === "measure") ? { x: from.x / size.width, y: from.y / size.height } : undefined,
      grid
    );
    return { x: n.x * size.width, y: n.y * size.height };
  }
  const shownLabels = labels.map((l) => (draftLabel && draftLabel.id === l.id ? { ...l, x: draftLabel.x, y: draftLabel.y } : l));

  // The wall/shape actually nearest a tap (true distance to the line or
  // outline, not its padded bounding box). Overlapping boxes - a short wall
  // inside a room, two walls meeting at a corner - used to hand the tap to
  // whichever box was on top, so the wall you touched often wasn't the one
  // selected. `fallback` is what the touched hit area stood for; it wins when
  // nothing is within reach of the finger.
  function pickAt(
    tapX: number,
    tapY: number,
    fallback: { kind: "wall" | "annotation"; id: string },
    includeWalls: boolean
  ): { kind: "wall" | "annotation"; id: string } {
    const W = size.width;
    const H = size.height;
    let best = fallback;
    let bestD = 44;
    if (includeWalls) {
      for (const l of [...shownWalls, ...pendingLines]) {
        if (l.id === selectedWallId) continue;
        const d = distToElement(tapX, tapY, l, "wall", W, H);
        if (d < bestD) {
          bestD = d;
          best = { kind: "wall", id: l.id };
        }
      }
    }
    for (const a of shownAnnotations) {
      if (mode === "view" && a.id === selectedAnnotationId) continue;
      const d = distToElement(tapX, tapY, a, elementKind(a), W, H);
      if (d < bestD) {
        bestD = d;
        best = { kind: "annotation", id: a.id };
      }
    }
    return best;
  }
  function selectPicked(pick: { kind: "wall" | "annotation"; id: string }) {
    if (pick.kind === "wall") onWallPress?.(pick.id);
    else onAnnotationPress?.(pick.id);
  }

  function handleLayout(e: LayoutChangeEvent) {
    const { width, height: h } = e.nativeEvent.layout;
    setSize({ width, height: h });
  }

  const completesOnTap = mode === "label" || (mode === "annotate" && annotationType === "x");

  const { panHandlers, live, pointer, hoverProps } = useSiteMapGesture(
    mode,
    completesOnTap,
    (start, end) => {
      if (size.width === 0 || size.height === 0) return;
      const norm = { start: { x: start.x / size.width, y: start.y / size.height }, end: { x: end.x / size.width, y: end.y / size.height } };
      if (mode === "arrow") onArrowDrawn?.(norm.start, norm.end);
      else if (mode === "wall") onWallDrawn?.(norm.start, norm.end);
      else if (mode === "measure") onMeasureDrawn?.(norm.start, norm.end);
      else if (mode === "grid") {
        // Dragging the map slides the grid by the same distance.
        const wrap = (v: number) => ((v % grid.cell) + grid.cell) % grid.cell;
        onGridChange?.({ ...grid, ox: wrap(grid.ox + norm.end.x - norm.start.x), oy: wrap(grid.oy + norm.end.y - norm.start.y) });
      }
      else if (mode === "annotate" && annotationType && annotationType !== "x" && annotationColor) {
        onAnnotationDrawn?.(annotationType, annotationColor, norm.start, norm.end);
      }
    },
    (point) => {
      if (size.width === 0 || size.height === 0) return;
      const norm = { x: point.x / size.width, y: point.y / size.height };
      if (mode === "label") onLabelTap?.(norm);
      else if (mode === "annotate" && annotationType === "x" && annotationColor) onAnnotationDrawn?.("x", annotationColor, norm, norm);
    },
    snapPixels
  );

  // While the grid is being dragged it follows the finger; the new position
  // is only saved on release.
  const shownGrid = (() => {
    if (mode !== "grid" || !live || size.width === 0) return grid;
    const wrap = (v: number) => ((v % grid.cell) + grid.cell) % grid.cell;
    return { ...grid, ox: wrap(grid.ox + (live.end.x - live.start.x) / size.width), oy: wrap(grid.oy + (live.end.y - live.start.y) / size.height) };
  })();

  // Handles + a move surface for whichever wall/annotation is selected, so a
  // shape can be dragged to a new spot, or an end/corner dragged to resize it,
  // instead of deleting and redrawing it.
  function renderShapeEditor() {
    const W = size.width;
    const H = size.height;
    const selAnn = selectedAnnotationId ? annotations.find((a) => a.id === selectedAnnotationId) : undefined;
    const selWall = !selAnn && selectedWallId ? savedLines.find((l) => l.id === selectedWallId) : undefined;
    const target = selAnn ?? selWall;
    if (!target) return null;
    const kind: "annotation" | "wall" = selAnn ? "annotation" : "wall";
    const base: Geometry = { x1: target.x1, y1: target.y1, x2: (target as Geometry).x2, y2: (target as Geometry).y2 };
    const shown = draft && draft.kind === kind && draft.id === target.id ? draft.g : base;
    const sx2 = shown.x2 ?? shown.x1;
    const sy2 = shown.y2 ?? shown.y1;

    // Where the shape ends up for a drag of this handle: the raw finger
    // movement, pulled onto the grid / a nearby wall end (when snapping is
    // on). A wall end dragged also takes along every wall joined to it.
    const compute = (handle: HandleKind, dx: number, dy: number) => {
      const raw = applyDrag(base, handle, dx / W, dy / H);
      const isLine = selAnn ? selAnn.type === "arrow" || selAnn.type === "measure" : true;
      const isWall = !selAnn;
      const origEnd = handle === "p1" ? { x: base.x1, y: base.y1 } : handle === "p2" ? { x: base.x2 ?? base.x1, y: base.y2 ?? base.y1 } : null;
      // Wall ends other than the one being dragged (and anything joined to it).
      const ends = !isWall
        ? []
        : wallEnds(target.id).filter((e) => !origEnd || Math.hypot(e.x - origEnd.x, e.y - origEnd.y) > CORNER_EPS);
      let g = raw;
      if (snap && (handle === "p1" || handle === "p2") && isLine) {
        const moved = handle === "p1" ? { x: raw.x1, y: raw.y1 } : { x: raw.x2 ?? raw.x1, y: raw.y2 ?? raw.y1 };
        const fixed = handle === "p1" ? { x: base.x2 ?? base.x1, y: base.y2 ?? base.y1 } : { x: base.x1, y: base.y1 };
        const p = snapNormalized(moved, ends, W, H, fixed, grid);
        g = handle === "p1" ? { ...raw, x1: p.x, y1: p.y } : { ...raw, x2: p.x, y2: p.y };
      } else if (snap && (handle === "tl" || handle === "tr" || handle === "bl" || handle === "br")) {
        const p = snapNormalized({ x: raw.x1, y: raw.y1 }, [], W, H, undefined, grid);
        const x2 = raw.x2 ?? raw.x1;
        const y2 = raw.y2 ?? raw.y1;
        // Skip the snap if it would squash the shape below its minimum size.
        if (Math.abs(p.x - x2) >= 0.03 && Math.abs(p.y - y2) >= 0.03) g = { ...raw, x1: p.x, y1: p.y };
      } else if (snap && handle === "move") {
        // Slide so the shape's first corner / wall end lands on the grid or a wall end.
        const first = { x: raw.x1, y: raw.y1 };
        const p = snapNormalized(first, isWall ? wallEnds(target.id) : [], W, H, undefined, grid);
        g = applyDrag(base, "move", dx / W + (p.x - first.x), dy / H + (p.y - first.y));
      }
      let also: { id: string; g: Required<Geometry> }[] = [];
      if (isWall && origEnd && (handle === "p1" || handle === "p2")) {
        const np = handle === "p1" ? { x: g.x1, y: g.y1 } : { x: g.x2 ?? g.x1, y: g.y2 ?? g.y1 };
        for (const l of savedLines) {
          if (l.id === target.id) continue;
          const j1 = Math.hypot(l.x1 - origEnd.x, l.y1 - origEnd.y) <= CORNER_EPS;
          const j2 = Math.hypot(l.x2 - origEnd.x, l.y2 - origEnd.y) <= CORNER_EPS;
          if (!j1 && !j2) continue;
          also.push({ id: l.id, g: { x1: j1 ? np.x : l.x1, y1: j1 ? np.y : l.y1, x2: j2 ? np.x : l.x2, y2: j2 ? np.y : l.y2 } });
        }
      }
      return { g, also };
    };
    const drag = (handle: HandleKind) => (dx: number, dy: number) => {
      const { g, also } = compute(handle, dx, dy);
      setDraft({ kind, id: target.id, g, also });
    };
    const drop = (handle: HandleKind) => async (dx: number, dy: number) => {
      if (Math.abs(dx) < 3 && Math.abs(dy) < 3) {
        setDraft(null); // a tap, not a drag
        return;
      }
      const { g, also } = compute(handle, dx, dy);
      setDraft({ kind, id: target.id, g, also });
      try {
        if (kind === "annotation") await onAnnotationChange?.(target.id, g);
        else if (also.length > 0 && onWallsChange) {
          await onWallsChange([{ id: target.id, geometry: g as Required<Geometry> }, ...also.map((o) => ({ id: o.id, geometry: o.g }))]);
        } else await onWallChange?.(target.id, g as Required<Geometry>);
      } finally {
        setDraft(null);
      }
    };
    const cancel = () => setDraft(null);

    const isRect = selAnn?.type === "rect";
    const isPoint = selAnn?.type === "x";
    const minX = Math.min(shown.x1, sx2) * W;
    const maxX = Math.max(shown.x1, sx2) * W;
    const minY = Math.min(shown.y1, sy2) * H;
    const maxY = Math.max(shown.y1, sy2) * H;
    const handles: { key: HandleKind; x: number; y: number }[] = isPoint
      ? []
      : isRect
        ? [
            { key: "tl", x: minX, y: minY },
            { key: "tr", x: maxX, y: minY },
            { key: "bl", x: minX, y: maxY },
            { key: "br", x: maxX, y: maxY },
          ]
        : [
            { key: "p1", x: shown.x1 * W, y: shown.y1 * H },
            { key: "p2", x: sx2 * W, y: sy2 * H },
          ];
    const moveRect = selAnn
      ? annotationHitRect({ ...selAnn, ...shown } as SiteMapAnnotation, W, H)
      : wallHitRect({ ...(target as WallLine), ...(shown as Required<Geometry>) }, W, H, 22);

    return (
      <>
        <DragSurface
          style={[styles.wallHitArea, moveRect]}
          onDrag={drag("move")}
          onDrop={drop("move")}
          onCancel={cancel}
          // A tap on the selected item's box that is really nearer a
          // different wall/shape selects that one instead.
          onTap={(x, y) => {
            const tapX = moveRect.left + x;
            const tapY = moveRect.top + y;
            const own = distToElement(tapX, tapY, shown, selAnn ? elementKind(selAnn) : "wall", W, H);
            const pick = pickAt(tapX, tapY, { kind: kind === "annotation" ? "annotation" : "wall", id: target.id }, true);
            if (pick.id === target.id) return;
            const other = pick.kind === "wall" ? shownWalls.find((l) => l.id === pick.id) : shownAnnotations.find((a) => a.id === pick.id);
            if (!other) return;
            const od = distToElement(tapX, tapY, other, pick.kind === "wall" ? "wall" : elementKind(other as SiteMapAnnotation), W, H);
            if (od < own) selectPicked(pick);
          }}
        />
        {handles.map((h) => (
          <DragSurface
            key={h.key}
            style={[styles.handleTouch, { left: h.x - 28, top: h.y - 28 }]}
            onDrag={drag(h.key)}
            onDrop={drop(h.key)}
            onCancel={cancel}
          >
            <View style={styles.handleDot} />
          </DragSurface>
        ))}
      </>
    );
  }

  // A single drag handle over the selected label, so it can be slid to a
  // new spot instead of the old delete-and-recreate-it-elsewhere workaround.
  // Never rendered at the same time as renderShapeEditor's handles - a wall
  // or shape selection always takes priority (matches SiteMapScreen, which
  // only ever keeps one of the three selection ids set at a time).
  function renderLabelDragHandle() {
    if (selectedAnnotationId || selectedWallId || !selectedLabelId) return null;
    const target = labels.find((l) => l.id === selectedLabelId);
    if (!target) return null;
    const shown = draftLabel && draftLabel.id === target.id ? draftLabel : target;

    const drag = (dx: number, dy: number) => {
      const g = applyDrag({ x1: target.x, y1: target.y }, "move", dx / size.width, dy / size.height);
      setDraftLabel({ id: target.id, x: g.x1, y: g.y1 });
    };
    const drop = async (dx: number, dy: number) => {
      if (Math.abs(dx) < 3 && Math.abs(dy) < 3) {
        setDraftLabel(null); // a tap, not a drag
        return;
      }
      const g = applyDrag({ x1: target.x, y1: target.y }, "move", dx / size.width, dy / size.height);
      setDraftLabel({ id: target.id, x: g.x1, y: g.y1 });
      try {
        await onLabelChange?.(target.id, { x: g.x1, y: g.y1 });
      } finally {
        setDraftLabel(null);
      }
    };
    const cancel = () => setDraftLabel(null);

    // Renders the chip itself (not just an invisible hit-area) so the
    // selected label doesn't disappear now that its own plain Pressable is
    // filtered out of the list below to avoid the two fighting over the
    // touch - same z-order fix as the wall/annotation hit-areas above.
    return (
      <DragSurface style={[styles.structureLabel, styles.structureLabelSelected, labelHitRect(shown, size.width, size.height)]} onDrag={drag} onDrop={drop} onCancel={cancel}>
        <Text style={styles.structureLabelText} numberOfLines={1}>
          {target.text}
        </Text>
      </DragSurface>
    );
  }

  // A small length tag sitting beside a line, nudged to the side of it and
  // kept inside the map.
  const lengthTag = (key: string, x1: number, y1: number, x2: number, y2: number, color: string, text = lengthText(x1, y1, x2, y2)) => {
    const W = size.width;
    const H = size.height;
    const px1 = x1 * W;
    const py1 = y1 * H;
    const px2 = x2 * W;
    const py2 = y2 * H;
    const len = Math.hypot(px2 - px1, py2 - py1);
    if (len < 24) return null; // too short to label legibly
    const w = text.length * 6.6 + 12;
    // Perpendicular, always towards the top of the screen.
    let nx = -(py2 - py1) / len;
    let ny = (px2 - px1) / len;
    if (ny > 0 || (ny === 0 && nx < 0)) {
      nx = -nx;
      ny = -ny;
    }
    // Far enough to the side that the tag clears the line, whichever way it runs.
    const d = 6 + (w / 2) * Math.abs(nx) + 9 * Math.abs(ny);
    const cx = Math.min(Math.max((px1 + px2) / 2 + nx * d, w / 2 + 2), W - w / 2 - 2);
    const cy = Math.min(Math.max((py1 + py2) / 2 + ny * d, 11), H - 11);
    return (
      <React.Fragment key={key}>
        <Rect x={cx - w / 2} y={cy - 9} width={w} height={18} rx={9} fill="#ffffff" fillOpacity={0.93} stroke={color} strokeWidth={1} />
        <SvgText x={cx} y={cy + 4} fontSize={11} fontWeight="700" fontFamily={Platform.OS === "web" ? "-apple-system, system-ui, Helvetica, Arial, sans-serif" : undefined} fill={color} textAnchor="middle">
          {text}
        </SvgText>
      </React.Fragment>
    );
  };

  return (
    <View
      style={[styles.container, NO_SELECT, mode !== "view" ? NO_PAGE_SCROLL : null, drawCursor(mode)]}
      onLayout={handleLayout}
      {...panHandlers}
      {...hoverProps}
    >
      {imageUri ? (
        // A photo stored on the server comes back as a path ("/api/media/...")
        // and sits behind login: give it the server's address and load it with
        // the person's access token (AuthImage), or it renders blank on the web.
        <AuthImage uri={imageUri.startsWith("/api/") ? `${API_BASE_URL}${imageUri}` : imageUri} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : null}
      {size.width > 0 ? (
        <Svg width={size.width} height={size.height} style={StyleSheet.absoluteFill} pointerEvents="none">
          {!imageUri
            ? (() => {
                const lines = gridLines(size.width, size.height, shownGrid.cell, shownGrid.ox, shownGrid.oy);
                return (
                  <>
                    {lines.minor.map((g, i) => (
                      <SvgLine key={`grid-minor-${i}`} x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2} stroke="#E1E6E3" strokeWidth={0.75} />
                    ))}
                    {lines.major.map((g, i) => (
                      <SvgLine key={`grid-major-${i}`} x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2} stroke="#B9C2BD" strokeWidth={1.25} />
                    ))}
                  </>
                );
              })()
            : null}
          {shownWalls.map((l) => (
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
          {[...shownWalls, ...pendingLines]
            .filter((l) => grid.showLengths || (draft?.kind === "wall" && (draft.id === l.id || draft.also?.some((o) => o.id === l.id))))
            .map((l) => lengthTag(`wall-len-${l.id}`, l.x1, l.y1, l.x2, l.y2, colors.text))}
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
          {shownAnnotations.map((a) => {
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
            if (a.type === "measure") {
              const x1 = a.x1 * size.width;
              const y1 = a.y1 * size.height;
              const x2 = (a.x2 ?? a.x1) * size.width;
              const y2 = (a.y2 ?? a.y1) * size.height;
              const len = Math.hypot(x2 - x1, y2 - y1) || 1;
              // End ticks, square to the line, like a dimension line.
              const tx = (-(y2 - y1) / len) * 6;
              const ty = ((x2 - x1) / len) * 6;
              const sw = selected ? 3 : 2;
              return (
                <React.Fragment key={`ann-${a.id}`}>
                  <SvgLine x1={x1} y1={y1} x2={x2} y2={y2} stroke={a.color} strokeWidth={sw} />
                  <SvgLine x1={x1 - tx} y1={y1 - ty} x2={x1 + tx} y2={y1 + ty} stroke={a.color} strokeWidth={sw} />
                  <SvgLine x1={x2 - tx} y1={y2 - ty} x2={x2 + tx} y2={y2 + ty} stroke={a.color} strokeWidth={sw} />
                  {lengthTag(`ann-len-${a.id}`, a.x1, a.y1, a.x2 ?? a.x1, a.y2 ?? a.y1, a.color)}
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
                  stroke={mode === "wall" ? colors.primary : mode === "measure" ? MEASURE_COLOR : mode === "annotate" ? annotationColor ?? colors.text : colors.text}
                  strokeWidth={2.5}
                  strokeDasharray={mode === "wall" ? undefined : "4,3"}
                />
                {mode === "wall" || mode === "measure"
                  ? lengthTag("live-len", live.start.x / size.width, live.start.y / size.height, live.end.x / size.width, live.end.y / size.height, mode === "measure" ? MEASURE_COLOR : colors.primary)
                  : null}
                {mode === "arrow" || (mode === "annotate" && annotationType === "arrow") ? (
                  <Polygon points={arrowHeadPoints(live.start, live.end)} fill={mode === "annotate" ? annotationColor ?? colors.text : colors.text} />
                ) : null}
              </>
            )
          ) : null}
          {/* Where you are pointing, while a drawing tool is active: a ring at
              the exact spot with guide lines running the full width and height
              of the map. A fingertip hides the spot it touches, but the guide
              lines stick out on every side so the aim point stays readable. */}
          {mode !== "view" && mode !== "grid" && pointer ? (
            <>
              <SvgLine x1={0} y1={pointer.y} x2={size.width} y2={pointer.y} stroke={AIM_COLOR} strokeWidth={1} strokeDasharray="5,4" opacity={0.7} />
              <SvgLine x1={pointer.x} y1={0} x2={pointer.x} y2={size.height} stroke={AIM_COLOR} strokeWidth={1} strokeDasharray="5,4" opacity={0.7} />
              <Circle cx={pointer.x} cy={pointer.y} r={10} stroke={AIM_COLOR} strokeWidth={2} fill="none" />
              <Circle cx={pointer.x} cy={pointer.y} r={2.5} fill={AIM_COLOR} />
            </>
          ) : null}
          {/* Where the line/shape/arrow started. */}
          {mode !== "view" && mode !== "grid" && live && (Math.abs(live.end.x - live.start.x) > 1 || Math.abs(live.end.y - live.start.y) > 1) ? (
            <>
              <Circle cx={live.start.x} cy={live.start.y} r={7} stroke={AIM_COLOR} strokeWidth={2} fill="#ffffff" fillOpacity={0.9} />
              <Circle cx={live.start.x} cy={live.start.y} r={2} fill={AIM_COLOR} />
            </>
          ) : null}
        </Svg>
      ) : null}
      {/* Rendered before (so it loses ties to) every other tappable thing
          below - a Finding's touch target is a fixed 120px-wide box
          centered on its arrow's start point, well past what the small
          colored bubble visually shows, so it can fully cover a wall/
          annotation/label placed nearby. A technician hit exactly this:
          an X mark dropped right next to a finding kept opening the
          finding's edit form instead of the X's own "Shape" panel. Placing
          this block first means anything more precisely-targeted underneath
          (a wall, a shape, a label) claims the touch when they overlap; the
          finding bubble still catches everything that isn't. */}
      {size.width > 0
        ? arrows.map((a) => {
            const left = Math.min(Math.max(a.startX * size.width - 60, 4), size.width - 124);
            const top = Math.min(Math.max(a.startY * size.height - 14, 4), size.height - 28);
            return (
              <Pressable
                key={a.id}
                // Two findings marked close together have overlapping 120px-
                // wide bubbles, and whichever one happens to be on top (the
                // most recently created, in DOM order) caught every tap in
                // the overlap - a technician hit exactly this with two
                // findings on the same wall, one becoming untappable behind
                // the other. Reconstructing the actual tap point (this
                // Pressable's own left/top, which are canvas-relative,
                // plus the native event's location within it) and picking
                // whichever finding's arrow start is genuinely nearest to
                // it fixes this regardless of which Pressable's DOM node
                // physically received the touch.
                onPress={(e) => {
                  const tapX = left + e.nativeEvent.locationX;
                  const tapY = top + e.nativeEvent.locationY;
                  let best = a;
                  let bestDist = Infinity;
                  for (const candidate of arrows) {
                    const dx = candidate.startX * size.width - tapX;
                    const dy = candidate.startY * size.height - tapY;
                    const dist = dx * dx + dy * dy;
                    if (dist < bestDist) {
                      bestDist = dist;
                      best = candidate;
                    }
                  }
                  onArrowPress?.(best.id);
                }}
                pointerEvents={mode === "view" ? "auto" : "none"}
                style={[styles.labelBubble, { left, top, borderColor: SEVERITY_COLOR[a.severity] ?? colors.text }]}
              >
                <Text style={styles.labelText} numberOfLines={1}>
                  {a.label}
                </Text>
              </Pressable>
            );
          })
        : null}
      {size.width > 0 && mode === "view"
        ? [...shownWalls, ...pendingLines].filter((l) => l.id !== selectedWallId).map((l) => (
            <Pressable
              key={`wall-hit-${l.id}`}
              onPress={(e) => {
                const r = wallHitRect(l, size.width, size.height);
                selectPicked(pickAt(r.left + e.nativeEvent.locationX, r.top + e.nativeEvent.locationY, { kind: "wall", id: l.id }, true));
              }}
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
        ? shownAnnotations.filter((a) => !(mode === "view" && a.id === selectedAnnotationId)).map((a) => (
            <Pressable
              key={`ann-hit-${a.id}`}
              onPress={(e) => {
                const r = annotationHitRect(a, size.width, size.height);
                selectPicked(
                  pickAt(r.left + e.nativeEvent.locationX, r.top + e.nativeEvent.locationY, { kind: "annotation", id: a.id }, mode === "view")
                );
              }}
              style={[styles.wallHitArea, annotationHitRect(a, size.width, size.height)]}
            />
          ))
        : null}
      {size.width > 0 && mode === "view" ? renderShapeEditor() : null}
      {size.width > 0 && mode === "view" ? renderLabelDragHandle() : null}
      {/* A shape's own name, if it has one - rendered inside its box so a
          technician doesn't need a separate floating label just to name it
          (see the "Shape" selection panel in SiteMapScreen for editing it).
          Non-interactive: the shape's own hit-area/drag-surface underneath
          already handles taps and drags. */}
      {size.width > 0
        ? shownAnnotations
            .filter((a) => a.type === "rect" && a.label)
            .map((a) => {
              const own = annotations.find((x) => x.id === a.id) ?? a;
              const live = draftCaption && draftCaption.id === a.id ? draftCaption : null;
              const dx = live ? live.dx : own.labelDx ?? 0;
              const dy = live ? live.dy : own.labelDy ?? 0;
              const left = Math.min(Math.max((Math.min(a.x1, a.x2 ?? a.x1) + dx) * size.width + 6, 2), size.width - 40);
              const top = Math.min(Math.max((Math.min(a.y1, a.y2 ?? a.y1) + dy) * size.height + 4, 2), size.height - 22);
              // Drag a shape's name to wherever it reads best; it keeps its
              // place on the shape if the shape is later moved or resized.
              return (
                <DragSurface
                  key={`ann-caption-${a.id}`}
                  pointerEvents={mode === "view" ? "auto" : "none"}
                  style={[styles.shapeCaption, { left, top }]}
                  onDrag={(ddx, ddy) => setDraftCaption({ id: a.id, dx: (own.labelDx ?? 0) + ddx / size.width, dy: (own.labelDy ?? 0) + ddy / size.height })}
                  onDrop={async (ddx, ddy) => {
                    if (Math.abs(ddx) < 4 && Math.abs(ddy) < 4) {
                      setDraftCaption(null);
                      onAnnotationPress?.(a.id); // a tap selects the shape
                      return;
                    }
                    const next = { dx: (own.labelDx ?? 0) + ddx / size.width, dy: (own.labelDy ?? 0) + ddy / size.height };
                    setDraftCaption({ id: a.id, ...next });
                    try {
                      await onCaptionChange?.(a.id, next);
                    } finally {
                      setDraftCaption(null);
                    }
                  }}
                  onCancel={() => setDraftCaption(null)}
                >
                  <Text style={styles.shapeCaptionText} numberOfLines={1}>
                    {a.label}
                  </Text>
                </DragSurface>
              );
            })
        : null}
      {/* pointerEvents is forced to "none" while actively drawing (any mode
          but "view") - otherwise an existing label or marker sitting under
          where a technician is trying to draw a new wall/arrow/label
          silently claims that touch before the canvas's own PanResponder
          ever sees it, since a child Pressable wins the touch-responder
          negotiation by default. A technician hit exactly this: dragging
          through a label near the middle of the map did nothing, and
          placing a new marker in that same spot was just as stuck. */}
      {/* The selected label's own Pressable is skipped here - its
          DragSurface (renderLabelDragHandle, above) sits in the exact same
          spot and needs to win the touch, the same reasoning as the wall/
          annotation hit-areas above excluding their own selected item. */}
      {size.width > 0
        ? shownLabels.filter((l) => l.id !== selectedLabelId).map((l) => {
            const original = labels.find((x) => x.id === l.id) ?? l;
            return (
              // Press and drag a label anywhere to move it; a plain tap still
              // opens it for editing. Inert while a drawing tool is active, so
              // a label under the pen never steals the stroke.
              <DragSurface
                key={`label-${l.id}`}
                pointerEvents={mode === "view" ? "auto" : "none"}
                style={[
                  styles.structureLabel,
                  { left: Math.min(Math.max(l.x * size.width - 6, 4), size.width - 100), top: Math.min(Math.max(l.y * size.height - 10, 4), size.height - 22) },
                ]}
                onDrag={(dx, dy) => {
                  const g = applyDrag({ x1: original.x, y1: original.y }, "move", dx / size.width, dy / size.height);
                  setDraftLabel({ id: l.id, x: g.x1, y: g.y1 });
                }}
                onDrop={async (dx, dy) => {
                  if (Math.abs(dx) < 4 && Math.abs(dy) < 4) {
                    setDraftLabel(null);
                    onLabelPress?.(l.id); // a tap, not a drag
                    return;
                  }
                  const g = applyDrag({ x1: original.x, y1: original.y }, "move", dx / size.width, dy / size.height);
                  setDraftLabel({ id: l.id, x: g.x1, y: g.y1 });
                  try {
                    await onLabelChange?.(l.id, { x: g.x1, y: g.y1 });
                  } finally {
                    setDraftLabel(null);
                  }
                }}
                onCancel={() => setDraftLabel(null)}
              >
                <Text style={styles.structureLabelText} numberOfLines={1}>
                  {l.text}
                </Text>
              </DragSurface>
            );
          })
        : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Always square, whatever the screen: the PDF report prints this map on a
  // square page, so a map drawn on a wide iPad screen used to come out
  // squeezed sideways. Same shape everywhere = what you draw is what prints.
  container: {
    aspectRatio: 1,
    maxWidth: 560,
    alignSelf: "center",
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
  shapeCaption: {
    position: "absolute",
    maxWidth: 140,
    paddingHorizontal: 4,
    paddingVertical: 1,
    backgroundColor: "rgba(255,255,255,0.85)",
    borderRadius: 3,
  },
  shapeCaptionText: { fontSize: 11, fontWeight: "700", color: colors.text },
  wallHitArea: { position: "absolute" },
  handleTouch: { position: "absolute", width: 56, height: 56, alignItems: "center", justifyContent: "center" },
  handleDot: { width: 26, height: 26, borderRadius: 13, backgroundColor: "#fff", borderWidth: 4, borderColor: colors.primary },
});

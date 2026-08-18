import { useMemo, useRef, useState } from "react";
import { PanResponder } from "react-native";

type Point = { x: number; y: number };

function pointsToPath(points: Point[]): string {
  if (points.length === 0) return "";
  return points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
}

// Custom SVG + PanResponder signature pad (rather than a WebView-based
// library) so it renders consistently on native and on `expo start --web`
// with no extra native dependency. Strokes are stored as raw point data
// locally; sync rasterizes to PNG before uploading (see Phase 4).
export function useSignaturePad() {
  const [strokes, setStrokes] = useState<Point[][]>([]);
  const currentStroke = useRef<Point[]>([]);
  const [, bump] = useState(0);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (evt) => {
          currentStroke.current = [{ x: evt.nativeEvent.locationX, y: evt.nativeEvent.locationY }];
          bump((n) => n + 1);
        },
        onPanResponderMove: (evt) => {
          currentStroke.current = [...currentStroke.current, { x: evt.nativeEvent.locationX, y: evt.nativeEvent.locationY }];
          bump((n) => n + 1);
        },
        onPanResponderRelease: () => {
          setStrokes((prev) => [...prev, currentStroke.current]);
          currentStroke.current = [];
        },
      }),
    []
  );

  const paths = [...strokes, currentStroke.current].filter((s) => s.length > 0).map(pointsToPath);

  return {
    panHandlers: panResponder.panHandlers,
    paths,
    isEmpty: strokes.length === 0,
    clear: () => {
      setStrokes([]);
      currentStroke.current = [];
    },
    getPathData: () => JSON.stringify(strokes),
  };
}

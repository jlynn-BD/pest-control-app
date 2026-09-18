import React, { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { colors } from "./ui";
import type { SignaturePoint, SignatureSvgHandle } from "./signatureTypes";

export type { SignatureSvgHandle } from "./signatureTypes";

const STROKE_WIDTH = 2.5;

function toPath(points: SignaturePoint[]): string {
  return points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
}

// Web version of the signature pad. react-native-web's PanResponder derives
// touch positions from its own event plumbing, which left some browsers
// recording a stroke that was never drawn - so this uses plain pointer
// events (mouse, touch and pen alike) and rasterizes the PNG straight from
// the recorded points on a canvas instead of serializing the SVG.
export const SignatureBox = forwardRef<
  SignatureSvgHandle,
  {
    panHandlers: object;
    paths: string[];
    isEmpty: boolean;
    onClear: () => void;
    strokes?: SignaturePoint[][];
    onStroke?: (stroke: SignaturePoint[]) => void;
  }
>(function SignatureBox({ paths, isEmpty, onClear, strokes = [], onStroke }, ref) {
  const boxRef = useRef<HTMLDivElement>(null);
  const current = useRef<SignaturePoint[] | null>(null);
  const [live, setLive] = useState<SignaturePoint[]>([]);

  useImperativeHandle(ref, () => ({
    toDataURL: (callback) => {
      const el = boxRef.current;
      if (!el) return;
      const width = el.clientWidth;
      const height = el.clientHeight;
      const scale = 2;
      const canvas = document.createElement("canvas");
      canvas.width = width * scale;
      canvas.height = height * scale;
      const ctx = canvas.getContext("2d")!;
      ctx.scale(scale, scale);
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, width, height);
      ctx.strokeStyle = colors.text;
      ctx.lineWidth = STROKE_WIDTH;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (const stroke of strokes) {
        if (stroke.length === 0) continue;
        ctx.beginPath();
        ctx.moveTo(stroke[0].x, stroke[0].y);
        // A single tap has one point; a zero-length round-capped line
        // draws it as a dot.
        for (const p of stroke.length === 1 ? [stroke[0]] : stroke.slice(1)) ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }
      callback(canvas.toDataURL("image/png").replace("data:image/png;base64,", ""));
    },
  }));

  function point(e: React.PointerEvent<HTMLDivElement>): SignaturePoint {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function finish() {
    if (current.current && current.current.length > 0) onStroke?.(current.current);
    current.current = null;
    setLive([]);
  }

  return (
    <div>
      <div
        ref={boxRef}
        style={{
          position: "relative",
          height: 200,
          border: `1px solid ${colors.border}`,
          borderRadius: 10,
          backgroundColor: "#fff",
          overflow: "hidden",
          touchAction: "none",
          userSelect: "none",
          cursor: "crosshair",
        }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          current.current = [point(e)];
          setLive(current.current);
        }}
        onPointerMove={(e) => {
          if (!current.current) return;
          current.current = [...current.current, point(e)];
          setLive(current.current);
        }}
        onPointerUp={finish}
        onPointerCancel={finish}
      >
        <svg width="100%" height="100%" style={{ position: "absolute", top: 0, left: 0 }}>
          {[...paths, ...(live.length > 0 ? [toPath(live)] : [])].map((d, i) => (
            <path key={i} d={d} stroke={colors.text} strokeWidth={STROKE_WIDTH} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          ))}
          {live.length === 1 ? <circle cx={live[0].x} cy={live[0].y} r={STROKE_WIDTH / 2} fill={colors.text} /> : null}
        </svg>
        {isEmpty && live.length === 0 ? (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: colors.textMuted,
              fontSize: 14,
              pointerEvents: "none",
            }}
          >
            Sign here
          </div>
        ) : null}
      </div>
      <div
        onClick={onClear}
        style={{ color: colors.primary, fontWeight: 600, marginTop: 8, textAlign: "right", cursor: "pointer" }}
      >
        Clear signature
      </div>
    </div>
  );
});

export interface Point {
  x: number;
  y: number;
}

// Three points forming a small triangle at `end`, oriented along the
// start->end direction, for a hand-drawn-style arrowhead.
export function arrowHeadPoints(start: Point, end: Point, size = 10): string {
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const spread = Math.PI / 7;
  const p2 = { x: end.x - size * Math.cos(angle - spread), y: end.y - size * Math.sin(angle - spread) };
  const p3 = { x: end.x - size * Math.cos(angle + spread), y: end.y - size * Math.sin(angle + spread) };
  return `${end.x},${end.y} ${p2.x},${p2.y} ${p3.x},${p3.y}`;
}

export interface Line {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

// Graph-paper grid for properties without an uploaded photo, in pixel space
// (width/height of the canvas) - matches the backend's normalized-space
// version used for the PDF, just scaled for on-screen rendering.
export function gridLines(width: number, height: number, divisions = 10): Line[] {
  const lines: Line[] = [];
  for (let i = 1; i < divisions; i++) {
    const x = (i / divisions) * width;
    const y = (i / divisions) * height;
    lines.push({ x1: x, y1: 0, x2: x, y2: height });
    lines.push({ x1: 0, y1: y, x2: width, y2: y });
  }
  return lines;
}

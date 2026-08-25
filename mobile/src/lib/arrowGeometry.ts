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
// (width/height of the canvas). Same 40-minor / every-5th-major proportions
// as the PDF's 13.5pt/67.5pt print grid (see pdfTemplate.tsx), just scaled
// to whatever size the canvas actually renders at on screen instead of a
// fixed physical page size.
const GRID_MINOR_DIVISIONS = 40;
const GRID_MAJOR_EVERY = 5;

export function gridLines(width: number, height: number): { minor: Line[]; major: Line[] } {
  const minor: Line[] = [];
  const major: Line[] = [];
  for (let i = 1; i < GRID_MINOR_DIVISIONS; i++) {
    const x = (i / GRID_MINOR_DIVISIONS) * width;
    const y = (i / GRID_MINOR_DIVISIONS) * height;
    const bucket = i % GRID_MAJOR_EVERY === 0 ? major : minor;
    bucket.push({ x1: x, y1: 0, x2: x, y2: height });
    bucket.push({ x1: 0, y1: y, x2: width, y2: y });
  }
  return { minor, major };
}

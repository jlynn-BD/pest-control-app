// The map is an unbounded sheet (like a spreadsheet that never ends): drawings
// can extend past the original square, and what is shown is a window onto it.
// A view is that window: (x, y) is the point at its top-left corner and `zoom`
// how magnified it is (1 = the original square fills the screen, 0.5 = twice
// as much sheet is visible). Coordinates stay fractions of the original map
// width, so a sketch that never leaves the square looks exactly as before.
export interface SiteMapView {
  x: number;
  y: number;
  zoom: number;
}

export const DEFAULT_SITE_MAP_VIEW: SiteMapView = { x: 0, y: 0, zoom: 1 };
export const MIN_VIEW_ZOOM = 0.05;
export const MAX_VIEW_ZOOM = 4;

export function clampZoom(z: number): number {
  return Math.min(MAX_VIEW_ZOOM, Math.max(MIN_VIEW_ZOOM, z));
}

// The window that shows everything drawn: the original square when it all fits
// inside it, otherwise a larger (never smaller) square centred on the drawing
// with a little room around it.
export function fitView(points: { x: number; y: number }[]): SiteMapView {
  if (points.length === 0) return DEFAULT_SITE_MAP_VIEW;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  if (!Number.isFinite(minX)) return DEFAULT_SITE_MAP_VIEW;
  if (minX >= -0.001 && minY >= -0.001 && maxX <= 1.001 && maxY <= 1.001) return DEFAULT_SITE_MAP_VIEW;
  const MARGIN = 0.06;
  const side = Math.max(1, Math.max(maxX - minX, maxY - minY) + 2 * MARGIN);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return { x: cx - side / 2, y: cy - side / 2, zoom: clampZoom(1 / side) };
}

// Every point a level draws (wall ends, labels, shape / dimension corners),
// for working out its fit view.
export function levelPoints(level: {
  lines: { x1: number; y1: number; x2: number; y2: number }[];
  labels: { x: number; y: number }[];
  annotations: { x1: number; y1: number; x2?: number; y2?: number }[];
}): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  for (const l of level.lines) pts.push({ x: l.x1, y: l.y1 }, { x: l.x2, y: l.y2 });
  for (const l of level.labels) pts.push({ x: l.x, y: l.y });
  for (const a of level.annotations) pts.push({ x: a.x1, y: a.y1 }, { x: a.x2 ?? a.x1, y: a.y2 ?? a.y1 });
  return pts;
}

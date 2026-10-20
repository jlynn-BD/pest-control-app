import type { SiteMapGrid } from "../types";

// The grid every level starts with: 40 squares across (the same graph-paper
// proportions the report prints), each standing for 2 feet.
export const DEFAULT_SITE_MAP_GRID: SiteMapGrid = { cell: 1 / 40, ox: 0, oy: 0, feetPerCell: 2, showLengths: false };

export const MIN_GRID_CELL = 1 / 120;
export const MAX_GRID_CELL = 1 / 8;

// A stored grid made safe to draw with: missing/invalid parts fall back to the
// defaults, and the shift is kept within one square.
export function resolveGrid(g: Partial<SiteMapGrid> | null | undefined): SiteMapGrid {
  const d = DEFAULT_SITE_MAP_GRID;
  const cell = typeof g?.cell === "number" && Number.isFinite(g.cell) ? Math.min(MAX_GRID_CELL, Math.max(MIN_GRID_CELL, g.cell)) : d.cell;
  const wrap = (v: unknown) => {
    const n = typeof v === "number" && Number.isFinite(v) ? v : 0;
    return ((n % cell) + cell) % cell;
  };
  const feet = typeof g?.feetPerCell === "number" && g.feetPerCell > 0 && Number.isFinite(g.feetPerCell) ? g.feetPerCell : d.feetPerCell;
  return { cell, ox: wrap(g?.ox), oy: wrap(g?.oy), feetPerCell: feet, showLengths: Boolean(g?.showLengths), updatedAt: g?.updatedAt };
}

// Real-world length, in feet, of a line whose ends differ by (dx, dy) - both
// fractions of the map (the map is square, so they share one scale).
export function gridFeet(grid: SiteMapGrid, dx: number, dy: number): number {
  return (Math.hypot(dx, dy) / grid.cell) * grid.feetPerCell;
}

// 12.5 -> 12' 6"; under a foot -> 8". Rounded to the nearest inch.
export function formatFeet(feet: number): string {
  const totalInches = Math.round(feet * 12);
  const ft = Math.floor(totalInches / 12);
  const inch = totalInches % 12;
  if (ft === 0) return `${inch}\u2033`;
  return inch === 0 ? `${ft}\u2032` : `${ft}\u2032 ${inch}\u2033`;
}

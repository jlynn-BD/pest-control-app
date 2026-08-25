import type { SiteMapLevel, SiteMapSketch } from "@pest-app/shared";
import type { SiteMapArrow } from "../components/ArrowCanvas";

const EMPTY: SiteMapSketch = { levels: [] };

function isValidLevel(v: unknown): v is SiteMapLevel {
  return typeof v === "object" && v !== null && typeof (v as SiteMapLevel).id === "string" && typeof (v as SiteMapLevel).name === "string";
}

export function parseSiteMapSketch(json: string | null | undefined): SiteMapSketch {
  if (!json) return EMPTY;
  try {
    const parsed = JSON.parse(json);
    const levels = Array.isArray(parsed?.levels) ? parsed.levels.filter(isValidLevel) : [];
    return {
      levels: levels.map((l: SiteMapLevel) => ({
        id: l.id,
        name: l.name,
        sortOrder: l.sortOrder ?? 0,
        lines: Array.isArray(l.lines) ? l.lines : [],
        labels: Array.isArray(l.labels) ? l.labels : [],
      })),
    };
  } catch {
    return EMPTY;
  }
}

interface FindingLike {
  id: string;
  areaLocation: string;
  severity: string;
  floorPlanX?: number | null;
  floorPlanY?: number | null;
  siteMapArrowStartX?: number | null;
  siteMapArrowStartY?: number | null;
  siteMapLevel?: string | null;
}

export interface SiteMapPanel {
  title: string;
  imageUri: string | null;
  lines: SiteMapSketch["levels"][number]["lines"];
  labels: SiteMapSketch["levels"][number]["labels"];
  arrows: SiteMapArrow[];
}

// Mirrors the backend's buildReportData site-map-panel logic (see
// reports/routes.ts): photo mode is one flat panel with every placed
// finding; sketch mode is one panel per level, scoped to that level's own
// arrows. Used by both the local (offline) and synced inspection detail
// screens so their read-only view matches what's in the exported photo.
export function buildSiteMapPanels(imageUri: string | null, sketch: SiteMapSketch, findings: FindingLike[]): SiteMapPanel[] {
  const placed = findings.filter(
    (f) => f.floorPlanX != null && f.floorPlanY != null && f.siteMapArrowStartX != null && f.siteMapArrowStartY != null
  );
  const toArrow = (f: FindingLike): SiteMapArrow => ({
    id: f.id,
    startX: f.siteMapArrowStartX!,
    startY: f.siteMapArrowStartY!,
    endX: f.floorPlanX!,
    endY: f.floorPlanY!,
    label: f.areaLocation,
    severity: f.severity,
  });

  if (imageUri) {
    return [{ title: "Site Map", imageUri, lines: [], labels: [], arrows: placed.map(toArrow) }];
  }

  return [...sketch.levels]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((level) => ({
      title: `Site Map — ${level.name}`,
      imageUri: null,
      lines: level.lines,
      labels: level.labels,
      arrows: placed.filter((f) => f.siteMapLevel === level.id).map(toArrow),
    }))
    .filter((panel) => panel.lines.length > 0 || panel.labels.length > 0 || panel.arrows.length > 0);
}

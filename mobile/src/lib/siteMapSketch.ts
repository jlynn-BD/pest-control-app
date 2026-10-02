import { getSiteMapLevelRank, parseRawSketch, visibleSketch } from "@pest-app/shared";
import type { SiteMapSketch } from "@pest-app/shared";
import type { SiteMapArrow } from "../components/ArrowCanvas";

// What the app draws: the stored sketch (which also carries per-element
// timestamps and tombstones for deleted elements - see shared siteMapMerge)
// with deleted elements removed. Old-format elements without ids get stable
// synthetic ones inside parseRawSketch.
export function parseSiteMapSketch(json: string | null | undefined): SiteMapSketch {
  return visibleSketch(parseRawSketch(json));
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
  annotations: SiteMapSketch["levels"][number]["annotations"];
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
    return [{ title: "Site Map", imageUri, lines: [], labels: [], annotations: [], arrows: placed.map(toArrow) }];
  }

  return [...sketch.levels]
    .sort((a, b) => {
      const rankDiff = getSiteMapLevelRank(a.name) - getSiteMapLevelRank(b.name);
      return rankDiff !== 0 ? rankDiff : a.sortOrder - b.sortOrder;
    })
    .map((level) => ({
      title: `Site Map — ${level.name}`,
      imageUri: null,
      lines: level.lines,
      labels: level.labels,
      annotations: level.annotations,
      arrows: placed.filter((f) => f.siteMapLevel === level.id).map(toArrow),
    }))
    .filter((panel) => panel.lines.length > 0 || panel.labels.length > 0 || panel.annotations.length > 0 || panel.arrows.length > 0);
}

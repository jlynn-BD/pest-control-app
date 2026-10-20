// @ts-nocheck -- npm workspace hoisting resolves two different copies of
// @types/react (backend's own 18.x nested next to the mobile-driven 19.x at
// the workspace root), so @react-pdf/renderer's JSX components structurally
// conflict across the two copies at the type level only. Runtime is
// unaffected (this file runs through tsx, which strips types without
// checking); ReportData below stays fully typed and is what callers rely on.
import { Document, Image, Line, Page, Polygon, Rect, StyleSheet, Svg, Text, View } from "@react-pdf/renderer";
import React from "react";
import { CHECKLIST_CATEGORY_LABEL, formatFeet, gridFeet, resolveGrid } from "@pest-app/shared";

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 10, fontFamily: "Helvetica", color: "#1A2421" },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 },
  title: { fontSize: 20, fontWeight: 700 },
  subtitle: { fontSize: 10, color: "#5C6B65", marginTop: 2 },
  badge: { fontSize: 9, fontWeight: 700, padding: 4, backgroundColor: "#EAF3EF", borderRadius: 4 },
  section: { marginTop: 16 },
  sectionTitle: { fontSize: 13, fontWeight: 700, marginBottom: 8, borderBottomWidth: 1, borderBottomColor: "#E1E6E3", paddingBottom: 4 },
  infoGrid: { flexDirection: "row", flexWrap: "wrap", gap: 16 },
  infoBlock: { width: "45%", marginBottom: 8 },
  infoLabel: { fontSize: 8, color: "#5C6B65", textTransform: "uppercase" },
  infoValue: { fontSize: 10, marginTop: 2 },
  card: { borderWidth: 1, borderColor: "#E1E6E3", borderRadius: 6, padding: 10, marginBottom: 8 },
  cardHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardTitle: { fontSize: 11, fontWeight: 700 },
  cardMeta: { fontSize: 9, color: "#5C6B65", marginTop: 2 },
  cardBody: { fontSize: 9.5, marginTop: 4 },
  severityHigh: { color: "#C0392B", fontWeight: 700 },
  severityMedium: { color: "#B8860B", fontWeight: 700 },
  severityLow: { color: "#1F7A5C", fontWeight: 700 },
  checklistRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    borderBottomWidth: 1,
    borderBottomColor: "#F0F2F1",
    paddingVertical: 4,
  },
  checklistPrompt: { fontSize: 9.5, flexGrow: 1, flexBasis: "60%", paddingRight: 8 },
  // One checklist answer: the question on the left, the status in its own
  // fixed column on the right, and any note on its own line underneath.
  // (They used to share one wrapping row, so a note was squeezed in beside
  // the status and printed right up against it, e.g. "NEEDS ATTENTIONGaps near plumbing".)
  checklistItem: { borderBottomWidth: 1, borderBottomColor: "#F0F2F1", paddingVertical: 4 },
  checklistLine: { flexDirection: "row", alignItems: "flex-start" },
  checklistQuestion: { fontSize: 9.5, flex: 1, paddingRight: 12 },
  checklistStatus: { width: 100, fontSize: 9, textAlign: "right" },
  checklistNotes: { fontSize: 9, color: "#3B4741", marginTop: 3, marginLeft: 6, paddingLeft: 6, borderLeftWidth: 2, borderLeftColor: "#E1E6E3" },
  // Fixed at 540x540pt (7.5in x 7.5in at 72pt/in) to match a real printed
  // quad-ruled sketch page, not stretched to fill the column - see
  // gridLines() below for the 13.5pt minor / 67.5pt major square spacing.
  siteMapBox: { width: 540, height: 540, position: "relative", borderWidth: 1, borderColor: "#E1E6E3", borderRadius: 4, overflow: "hidden", backgroundColor: "#FFFFFF" },
  siteMapImage: { position: "absolute", top: 0, left: 0, width: "100%", height: "100%", objectFit: "cover" },
  siteMapLabel: {
    position: "absolute",
    width: 110,
    fontSize: 7.5,
    fontWeight: 700,
    backgroundColor: "rgba(255,255,255,0.9)",
    borderRadius: 3,
    borderWidth: 1,
    padding: 2,
  },
  // A length (wall or dimension line) printed beside its line.
  siteMapLength: {
    position: "absolute",
    fontSize: 7.5,
    fontWeight: 700,
    backgroundColor: "rgba(255,255,255,0.93)",
    borderRadius: 6,
    paddingVertical: 1,
    paddingHorizontal: 4,
    borderWidth: 0.75,
  },
  siteMapShapeCaption: {
    position: "absolute",
    fontSize: 8,
    fontWeight: 700,
    color: "#1A2421",
    backgroundColor: "rgba(255,255,255,0.9)",
    borderRadius: 2,
    paddingVertical: 1,
    paddingHorizontal: 3,
  },
  siteMapStructureLabel: {
    position: "absolute",
    fontSize: 8,
    fontWeight: 700,
    color: "#1F7A5C",
    backgroundColor: "#EAF3EF",
    borderRadius: 3,
    borderWidth: 1,
    borderColor: "#1F7A5C",
    paddingVertical: 1,
    paddingHorizontal: 4,
  },
  photoRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
  photo: { width: 90, height: 90, borderRadius: 4 },
  signatureRow: { flexDirection: "row", gap: 24, marginTop: 8 },
  signatureBlock: { flex: 1 },
  signatureImage: { width: 180, height: 70, borderWidth: 1, borderColor: "#E1E6E3", objectFit: "contain" },
  signatureLabel: { fontSize: 9, marginTop: 4, fontWeight: 700 },
  signatureMeta: { fontSize: 8, color: "#5C6B65" },
  footer: { position: "absolute", bottom: 24, left: 32, right: 32, fontSize: 8, color: "#5C6B65", textAlign: "center" },
});

function severityStyle(severity: string) {
  if (severity === "CRITICAL" || severity === "HIGH") return styles.severityHigh;
  if (severity === "MEDIUM") return styles.severityMedium;
  return styles.severityLow;
}

function checklistStatusStyle(status: string) {
  if (status === "NEEDS_ATTENTION") return styles.severityHigh;
  if (status === "NOT_APPLICABLE") return styles.cardMeta;
  return styles.severityLow;
}


const SEVERITY_ARROW_COLOR: Record<string, string> = {
  LOW: "#1F7A5C",
  MEDIUM: "#B8860B",
  HIGH: "#C0392B",
  CRITICAL: "#C0392B",
};

// Same construction as the mobile ArrowCanvas's arrowHeadPoints, but
// operating directly in the site map's normalized 0-1 coordinate space
// (matches the Svg's viewBox below) instead of on-screen pixels.
function arrowHeadPoints(start: { x: number; y: number }, end: { x: number; y: number }, size = 0.02): string {
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const spread = Math.PI / 7;
  const p2 = { x: end.x - size * Math.cos(angle - spread), y: end.y - size * Math.sin(angle - spread) };
  const p3 = { x: end.x - size * Math.cos(angle + spread), y: end.y - size * Math.sin(angle + spread) };
  return `${end.x},${end.y} ${p2.x},${p2.y} ${p3.x},${p3.y}`;
}

// Graph-paper background for properties with no uploaded photo, so a
// freehand structure sketch (walls drawn straight in the app) still reads
// as a deliberate diagram rather than lines floating on blank white.
//
// Matches a real printed quad-ruled sketch page: the siteMapBox is a fixed
// 540x540pt (7.5in x 7.5in). Minor squares are 13.5pt (3/16in) - 40 per
// side - with every 5th line drawn heavier to form 67.5pt (15/16in, ~0.94in)
// major squares, 8 per side. Lines are computed here in the same 0-1
// normalized space as everything else in the Svg (viewBox="0 0 1 1"), so
// 1/40 and 1/8 stand in for 13.5pt and 67.5pt respectively.
const GRID_MINOR_DIVISIONS = 40;
const GRID_MAJOR_EVERY = 5; // every 5th minor line is a major line (40/5 = 8 major squares/side)

// `grid` is the level's own grid (square size and shift) - the standard one
// when it never changed it. Every 5th line is heavier, counted from the grid's
// own origin.
function gridLines(grid = resolveGrid(null)): { minor: { x1: number; y1: number; x2: number; y2: number }[]; major: { x1: number; y1: number; x2: number; y2: number }[] } {
  const minor: { x1: number; y1: number; x2: number; y2: number }[] = [];
  const major: { x1: number; y1: number; x2: number; y2: number }[] = [];
  // The grid has no edge: lines are laid out across the whole page whatever
  // the grid's origin, and thinned out when the squares get tiny.
  const isMajor = (i: number) => ((i % GRID_MAJOR_EVERY) + GRID_MAJOR_EVERY) % GRID_MAJOR_EVERY === 0;
  const cellPt = grid.cell * 540;
  const drawMinor = cellPt >= 3;
  const drawMajor = cellPt * GRID_MAJOR_EVERY >= 4;
  for (let i = Math.ceil(-grid.ox / grid.cell - 1e-9), n = 0; grid.ox + i * grid.cell < 1 - 1e-6 && n < 400; i++, n++) {
    const t = grid.ox + i * grid.cell;
    if (t <= 1e-6) continue;
    if (isMajor(i) ? drawMajor : drawMinor) (isMajor(i) ? major : minor).push({ x1: t, y1: 0, x2: t, y2: 1 });
  }
  for (let i = Math.ceil(-grid.oy / grid.cell - 1e-9), n = 0; grid.oy + i * grid.cell < 1 - 1e-6 && n < 400; i++, n++) {
    const t = grid.oy + i * grid.cell;
    if (t <= 1e-6) continue;
    if (isMajor(i) ? drawMajor : drawMinor) (isMajor(i) ? major : minor).push({ x1: 0, y1: t, x2: 1, y2: t });
  }
  return { minor, major };
}

// Where a length tag goes (box is a fixed 540pt square): beside the middle of
// the line, on its upper side, kept on the page. Returns null for lines too
// short to label.
function lengthTagPosition(x1: number, y1: number, x2: number, y2: number, text: string): { left: number; top: number } | null {
  const BOX = 540;
  const px1 = x1 * BOX;
  const py1 = y1 * BOX;
  const px2 = x2 * BOX;
  const py2 = y2 * BOX;
  const len = Math.hypot(px2 - px1, py2 - py1);
  if (len < 28) return null;
  let nx = -(py2 - py1) / len;
  let ny = (px2 - px1) / len;
  if (ny > 0 || (ny === 0 && nx < 0)) {
    nx = -nx;
    ny = -ny;
  }
  const w = text.length * 4.6 + 10;
  // Far enough to the side that the tag clears the line, whichever way it runs.
  const d = 4 + (w / 2) * Math.abs(nx) + 7 * Math.abs(ny);
  const cx = (px1 + px2) / 2 + nx * d;
  const cy = (py1 + py2) / 2 + ny * d;
  return { left: Math.min(Math.max(cx - w / 2, 2), BOX - w - 2), top: Math.min(Math.max(cy - 6, 2), BOX - 16) };
}

export interface ReportChecklistItem {
  prompt: string;
  status: string;
  notes: string | null;
}

export interface ReportChecklistSection {
  category: string;
  items: ReportChecklistItem[];
}

export interface ReportSiteMapArrow {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  label: string;
  severity: string;
}

export interface ReportSiteMapLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface ReportSiteMapLabel {
  x: number;
  y: number;
  text: string;
}

export interface ReportSiteMapAnnotation {
  type: "x" | "arrow" | "rect" | "measure";
  color: string;
  x1: number;
  y1: number;
  x2?: number;
  y2?: number;
  // The name given to a shape ("Kitchen", "Bathroom"), printed on it.
  label?: string;
  labelDx?: number;
  labelDy?: number;
}

// One per level in sketch mode ("Site Map — Exterior", "Site Map — 1st
// Floor", ...), or a single panel titled "Site Map" in photo mode.
// Image bytes handed straight to react-pdf (files live in the database, not
// on disk, so there's no path to point at).
export interface ReportImage {
  data: Buffer;
  format: "png" | "jpg";
}

export interface ReportSiteMapPanel {
  title: string;
  imagePath: ReportImage | null;
  lines: ReportSiteMapLine[];
  labels: ReportSiteMapLabel[];
  annotations: ReportSiteMapAnnotation[];
  arrows: ReportSiteMapArrow[];
  // The level's layout grid / ruler (see SiteMapGrid in shared/types).
  grid?: import("@pest-app/shared").SiteMapGrid;
  // Which part of the (endless) sheet this page shows - everything drawn.
  view?: import("@pest-app/shared").SiteMapView;
}

// The sheet has no edge, so a drawing can run past the original square. The
// page shows a window onto it: everything is shifted and scaled into the
// page's own 0-1 square here, so the drawing code below never needs to know.
// With the default view this returns the panel unchanged in effect.
function transformPanel(panel: ReportSiteMapPanel): ReportSiteMapPanel {
  const v = panel.view ?? { x: 0, y: 0, zoom: 1 };
  const k = v.zoom;
  const tx = (n: number) => (n - v.x) * k;
  const ty = (n: number) => (n - v.y) * k;
  const g = resolveGrid(panel.grid);
  return {
    ...panel,
    grid: { ...g, cell: g.cell * k, ox: (g.ox - v.x) * k, oy: (g.oy - v.y) * k },
    lines: panel.lines.map((l) => ({ ...l, x1: tx(l.x1), y1: ty(l.y1), x2: tx(l.x2), y2: ty(l.y2) })),
    labels: panel.labels.map((l) => ({ ...l, x: tx(l.x), y: ty(l.y) })),
    annotations: panel.annotations.map((a) => ({
      ...a,
      x1: tx(a.x1),
      y1: ty(a.y1),
      ...(a.x2 !== undefined ? { x2: tx(a.x2) } : {}),
      ...(a.y2 !== undefined ? { y2: ty(a.y2) } : {}),
      ...(a.labelDx !== undefined ? { labelDx: a.labelDx * k } : {}),
      ...(a.labelDy !== undefined ? { labelDy: a.labelDy * k } : {}),
    })),
    arrows: panel.arrows.map((a) => ({ ...a, startX: tx(a.startX), startY: ty(a.startY), endX: tx(a.endX), endY: ty(a.endY) })),
  };
}

export interface ReportFinding {
  areaLocation: string;
  locationDetail: string | null;
  severity: string;
  description: string | null;
  photoPaths: ReportImage[];
  // The recommendation generated from this finding (Matt's "no second
  // entry" ask), shown on the finding's own card rather than in a
  // separate section that repeated it.
  recommendation: ReportRecommendation | null;
}

export interface ReportRecommendation {
  title: string;
  description: string | null;
  priority: string;
  status: string;
  deadline: string | null;
}

// Matt's accountability ask: a per-inspection audit entry for every
// conditional wizard step (Second/Third Floor, Basement, Crawl Space) the
// technician marked not present, with who signed off and when - see
// InspectionSectionSkip in schema.prisma.
export interface ReportSkippedSection {
  category: string;
  technicianName: string;
  initials: string;
  confirmedAt: string;
}

export interface ReportSignature {
  signerType: string;
  signerName: string;
  signedAt: string;
  imagePath: ReportImage | null;
}

export interface ReportData {
  inspectionId: string;
  customerName: string;
  propertyAddress: string;
  technicianName: string;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  generalNotes: string | null;
  generatedAt: string;
  followUpDate: string | null;
  siteMapPanels: ReportSiteMapPanel[];
  checklistSections: ReportChecklistSection[];
  skippedSections: ReportSkippedSection[];
  findings: ReportFinding[];
  // Recommendations not tied to any finding (created before they were
  // generated automatically) - the rest live on their finding above.
  standaloneRecommendations: ReportRecommendation[];
  signatures: ReportSignature[];
}

export function InspectionReportDocument({ data }: { data: ReportData }) {
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.title}>Pest Inspection Report</Text>
            <Text style={styles.subtitle}>Generated {new Date(data.generatedAt).toLocaleString()}</Text>
          </View>
          <Text style={styles.badge}>{data.status.replace(/_/g, " ")}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Inspection Details</Text>
          <View style={styles.infoGrid}>
            <View style={styles.infoBlock}>
              <Text style={styles.infoLabel}>Customer</Text>
              <Text style={styles.infoValue}>{data.customerName}</Text>
            </View>
            <View style={styles.infoBlock}>
              <Text style={styles.infoLabel}>Property</Text>
              <Text style={styles.infoValue}>{data.propertyAddress}</Text>
            </View>
            <View style={styles.infoBlock}>
              <Text style={styles.infoLabel}>Technician</Text>
              <Text style={styles.infoValue}>{data.technicianName}</Text>
            </View>
            <View style={styles.infoBlock}>
              <Text style={styles.infoLabel}>Completed</Text>
              <Text style={styles.infoValue}>{data.completedAt ? new Date(data.completedAt).toLocaleString() : "—"}</Text>
            </View>
          </View>
          {data.generalNotes ? (
            <View style={{ marginTop: 4 }}>
              <Text style={styles.infoLabel}>General Notes</Text>
              <Text style={styles.infoValue}>{data.generalNotes}</Text>
            </View>
          ) : null}
        </View>

        {data.siteMapPanels.map((rawPanel, pi) => {
          const panel = transformPanel(rawPanel);
          // Already in the page's own units (see transformPanel).
          const gridDef = panel.grid;
          const grid = gridLines(gridDef);
          const lengthTags = [
            ...(gridDef.showLengths ? panel.lines.map((l) => ({ x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2, color: "#1A2421" })) : []),
            ...panel.annotations
              .filter((a) => a.type === "measure")
              .map((a) => ({ x1: a.x1, y1: a.y1, x2: a.x2 ?? a.x1, y2: a.y2 ?? a.y1, color: a.color })),
          ]
            .map((t) => {
              // The PDF's built-in font has no prime marks, so plain ' and " are used.
              const text = formatFeet(gridFeet(gridDef, t.x2 - t.x1, t.y2 - t.y1)).replace(/\u2032/g, "'").replace(/\u2033/g, '"');
              return { ...t, text, pos: lengthTagPosition(t.x1, t.y1, t.x2, t.y2, text) };
            })
            .filter((t) => t.pos);
          return (
            <View style={styles.section} key={`site-map-${pi}`} wrap={false}>
              <Text style={styles.sectionTitle}>{panel.title}</Text>
              <View style={styles.siteMapBox}>
                {panel.imagePath ? <Image src={{ data: panel.imagePath.data, format: panel.imagePath.format }} style={styles.siteMapImage} /> : null}
                <Svg width="100%" height="100%" viewBox="0 0 1 1" preserveAspectRatio="none" style={{ position: "absolute", top: 0, left: 0 }}>
                  {!panel.imagePath ? (
                    <>
                      {grid.minor.map((g, i) => (
                        <Line key={`grid-minor-${i}`} x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2} stroke="#E1E6E3" strokeWidth={0.0007} />
                      ))}
                      {grid.major.map((g, i) => (
                        <Line key={`grid-major-${i}`} x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2} stroke="#B9C2BD" strokeWidth={0.0016} />
                      ))}
                    </>
                  ) : null}
                  {panel.lines.map((l, i) => (
                    <Line key={`wall-${i}`} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke="#1A2421" strokeWidth={0.008} />
                  ))}
                  {panel.arrows.map((a, i) => {
                    const start = { x: a.startX, y: a.startY };
                    const end = { x: a.endX, y: a.endY };
                    const color = SEVERITY_ARROW_COLOR[a.severity] ?? "#1A2421";
                    return (
                      <React.Fragment key={`arrow-${i}`}>
                        <Line x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke={color} strokeWidth={0.006} />
                        <Polygon points={arrowHeadPoints(start, end)} fill={color} />
                      </React.Fragment>
                    );
                  })}
                  {/* Lightweight X-mark/arrow/shape annotations - see
                      SiteMapAnnotation in shared/types. Coordinates are
                      already normalized 0-1, same as everything else in
                      this Svg (viewBox="0 0 1 1"). */}
                  {panel.annotations.map((a, i) => {
                    if (a.type === "x") {
                      const r = 0.012;
                      return (
                        <React.Fragment key={`annotation-${i}`}>
                          <Line x1={a.x1 - r} y1={a.y1 - r} x2={a.x1 + r} y2={a.y1 + r} stroke={a.color} strokeWidth={0.006} />
                          <Line x1={a.x1 - r} y1={a.y1 + r} x2={a.x1 + r} y2={a.y1 - r} stroke={a.color} strokeWidth={0.006} />
                        </React.Fragment>
                      );
                    }
                    if (a.type === "measure") {
                      // A dimension line: the line with a short tick at each end.
                      const x2 = a.x2 ?? a.x1;
                      const y2 = a.y2 ?? a.y1;
                      const len = Math.hypot(x2 - a.x1, y2 - a.y1) || 1;
                      const tx = (-(y2 - a.y1) / len) * 0.012;
                      const ty = ((x2 - a.x1) / len) * 0.012;
                      return (
                        <React.Fragment key={`annotation-${i}`}>
                          <Line x1={a.x1} y1={a.y1} x2={x2} y2={y2} stroke={a.color} strokeWidth={0.004} />
                          <Line x1={a.x1 - tx} y1={a.y1 - ty} x2={a.x1 + tx} y2={a.y1 + ty} stroke={a.color} strokeWidth={0.004} />
                          <Line x1={x2 - tx} y1={y2 - ty} x2={x2 + tx} y2={y2 + ty} stroke={a.color} strokeWidth={0.004} />
                        </React.Fragment>
                      );
                    }
                    if (a.type === "arrow") {
                      const start = { x: a.x1, y: a.y1 };
                      const end = { x: a.x2 ?? a.x1, y: a.y2 ?? a.y1 };
                      return (
                        <React.Fragment key={`annotation-${i}`}>
                          <Line x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke={a.color} strokeWidth={0.005} />
                          <Polygon points={arrowHeadPoints(start, end)} fill={a.color} />
                        </React.Fragment>
                      );
                    }
                    const x2 = a.x2 ?? a.x1;
                    const y2 = a.y2 ?? a.y1;
                    return (
                      <Rect
                        key={`annotation-${i}`}
                        x={Math.min(a.x1, x2)}
                        y={Math.min(a.y1, y2)}
                        width={Math.abs(x2 - a.x1)}
                        height={Math.abs(y2 - a.y1)}
                        stroke={a.color}
                        strokeWidth={0.004}
                        fill={a.color}
                        fillOpacity={0.15}
                      />
                    );
                  })}
                </Svg>
                {/* Distances: dimension lines always, walls when the level shows lengths. */}
                {lengthTags.map((t, i) => (
                  <Text key={`length-${i}`} style={[styles.siteMapLength, { left: t.pos.left, top: t.pos.top, color: t.color, borderColor: t.color }]}>
                    {t.text}
                  </Text>
                ))}
                {/* The names given to shapes, in the shape's top-left corner like on screen. */}
                {panel.annotations
                  .filter((a) => a.type === "rect" && a.label)
                  .map((a, i) => (
                    <Text
                      key={`shape-caption-${i}`}
                      style={[
                        styles.siteMapShapeCaption,
                        {
                          left: `${Math.min(Math.max((Math.min(a.x1, a.x2 ?? a.x1) + (a.labelDx ?? 0)) * 100 + 0.5, 0.5), 85)}%`,
                          top: `${Math.min(Math.max((Math.min(a.y1, a.y2 ?? a.y1) + (a.labelDy ?? 0)) * 100 + 0.5, 0.5), 96)}%`,
                        },
                      ]}
                    >
                      {a.label}
                    </Text>
                  ))}
                {panel.labels.map((l, i) => (
                  <Text
                    key={`structure-label-${i}`}
                    style={[
                      styles.siteMapStructureLabel,
                      { left: `${Math.min(Math.max(l.x * 100 - 5, 1), 85)}%`, top: `${Math.min(Math.max(l.y * 100 - 3, 1), 94)}%` },
                    ]}
                  >
                    {l.text}
                  </Text>
                ))}
                {panel.arrows.map((a, i) => (
                  <Text
                    key={`arrow-label-${i}`}
                    style={[
                      styles.siteMapLabel,
                      {
                        left: `${Math.min(Math.max(a.startX * 100 - 15, 1), 78)}%`,
                        top: `${Math.min(Math.max(a.startY * 100 - 4, 1), 92)}%`,
                        borderColor: SEVERITY_ARROW_COLOR[a.severity] ?? "#1A2421",
                      },
                    ]}
                  >
                    {a.label}
                  </Text>
                ))}
              </View>
            </View>
          );
        })}

        {data.checklistSections.map((section, si) => (
          <View style={styles.section} key={si}>
            <Text style={styles.sectionTitle}>{CHECKLIST_CATEGORY_LABEL[section.category] ?? section.category}</Text>
            {section.items.map((item, ii) => (
              <View key={ii} style={styles.checklistItem} wrap={false}>
                <View style={styles.checklistLine}>
                  <Text style={styles.checklistQuestion}>{item.prompt}</Text>
                  <Text style={[styles.checklistStatus, checklistStatusStyle(item.status)]}>{item.status.replace(/_/g, " ")}</Text>
                </View>
                {item.notes ? <Text style={styles.checklistNotes}>{item.notes}</Text> : null}
              </View>
            ))}
          </View>
        ))}

        {data.skippedSections.length > 0 ? (
          <View style={styles.section} wrap={false}>
            <Text style={styles.sectionTitle}>Skipped Sections</Text>
            {data.skippedSections.map((s, i) => (
              <View key={i} style={styles.checklistRow}>
                <Text style={styles.checklistPrompt}>{CHECKLIST_CATEGORY_LABEL[s.category] ?? s.category} — not present at this property</Text>
                <Text style={styles.cardMeta}>
                  Confirmed by {s.technicianName} ({s.initials}) · {new Date(s.confirmedAt).toLocaleString()}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            Findings & Recommendations ({data.findings.length + data.standaloneRecommendations.length})
          </Text>
          {data.findings.length === 0 && data.standaloneRecommendations.length === 0 ? (
            <Text style={styles.cardBody}>No findings or recommendations recorded.</Text>
          ) : null}
          {data.findings.map((f, i) => (
            <View key={i} style={styles.card} wrap={false}>
              <View style={styles.cardHeaderRow}>
                <Text style={styles.cardTitle}>
                  {f.areaLocation}
                  {f.locationDetail ? ` — ${f.locationDetail}` : ""}
                </Text>
                <Text style={severityStyle(f.severity)}>{f.severity}</Text>
              </View>
              {f.recommendation ? (
                <Text style={styles.cardMeta}>
                  Recommendation: {f.recommendation.priority} · {f.recommendation.status}
                  {f.recommendation.deadline ? ` · Deadline: ${new Date(f.recommendation.deadline).toLocaleDateString()}` : ""}
                </Text>
              ) : null}
              {f.description ? <Text style={styles.cardBody}>{f.description}</Text> : null}
              {f.photoPaths.length > 0 ? (
                <View style={styles.photoRow}>
                  {f.photoPaths.map((p, pi) => (
                    <Image key={pi} src={{ data: p.data, format: p.format }} style={styles.photo} />
                  ))}
                </View>
              ) : null}
            </View>
          ))}
          {data.standaloneRecommendations.map((r, i) => (
            <View key={`r${i}`} style={styles.card} wrap={false}>
              <View style={styles.cardHeaderRow}>
                <Text style={styles.cardTitle}>{r.title}</Text>
                <Text style={styles.cardMeta}>
                  {r.priority} · {r.status}
                </Text>
              </View>
              {r.description ? <Text style={styles.cardBody}>{r.description}</Text> : null}
              {r.deadline ? <Text style={styles.cardMeta}>Deadline: {new Date(r.deadline).toLocaleDateString()}</Text> : null}
            </View>
          ))}
        </View>

        {data.followUpDate ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Follow-Up</Text>
            <Text style={styles.cardBody}>Scheduled for {new Date(data.followUpDate).toLocaleDateString()}</Text>
          </View>
        ) : null}

        <View style={styles.section} wrap={false}>
          <Text style={styles.sectionTitle}>Signatures</Text>
          <View style={styles.signatureRow}>
            {data.signatures.map((s, i) => (
              <View key={i} style={styles.signatureBlock}>
                {s.imagePath ? <Image src={{ data: s.imagePath.data, format: s.imagePath.format }} style={styles.signatureImage} /> : <Text style={styles.signatureLabel}>(signature image unavailable)</Text>}
                <Text style={styles.signatureLabel}>
                  {s.signerName} ({s.signerType})
                </Text>
                <Text style={styles.signatureMeta}>{new Date(s.signedAt).toLocaleString()}</Text>
              </View>
            ))}
          </View>
        </View>

        <Text style={styles.footer} fixed>
          PestApp Field — Report for inspection {data.inspectionId}
        </Text>
      </Page>
    </Document>
  );
}

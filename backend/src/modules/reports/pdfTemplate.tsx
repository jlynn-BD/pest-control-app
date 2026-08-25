// @ts-nocheck -- npm workspace hoisting resolves two different copies of
// @types/react (backend's own 18.x nested next to the mobile-driven 19.x at
// the workspace root), so @react-pdf/renderer's JSX components structurally
// conflict across the two copies at the type level only. Runtime is
// unaffected (this file runs through tsx, which strips types without
// checking); ReportData below stays fully typed and is what callers rely on.
import { Document, Image, Line, Page, Polygon, StyleSheet, Svg, Text, View } from "@react-pdf/renderer";
import React from "react";

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
  productLine: { fontSize: 9.5, marginTop: 2 },
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

const CHECKLIST_CATEGORY_LABEL: Record<string, string> = {
  EXTERIOR: "Exterior Inspection Checklist",
  INTERIOR: "Interior Inspection Checklist",
  OTHER: "Additional Checklist Items",
};

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

function gridLines(): { minor: { x1: number; y1: number; x2: number; y2: number }[]; major: { x1: number; y1: number; x2: number; y2: number }[] } {
  const minor: { x1: number; y1: number; x2: number; y2: number }[] = [];
  const major: { x1: number; y1: number; x2: number; y2: number }[] = [];
  for (let i = 1; i < GRID_MINOR_DIVISIONS; i++) {
    const t = i / GRID_MINOR_DIVISIONS;
    const bucket = i % GRID_MAJOR_EVERY === 0 ? major : minor;
    bucket.push({ x1: t, y1: 0, x2: t, y2: 1 });
    bucket.push({ x1: 0, y1: t, x2: 1, y2: t });
  }
  return { minor, major };
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

// One per level in sketch mode ("Site Map — Exterior", "Site Map — 1st
// Floor", ...), or a single panel titled "Site Map" in photo mode.
export interface ReportSiteMapPanel {
  title: string;
  imagePath: string | null;
  lines: ReportSiteMapLine[];
  labels: ReportSiteMapLabel[];
  arrows: ReportSiteMapArrow[];
}

export interface ReportFinding {
  areaLocation: string;
  locationDetail: string | null;
  pestTypeName: string | null;
  severity: string;
  evidenceTypes: string[];
  riskFactors: string[];
  entryPoints: string[];
  description: string | null;
  photoPaths: string[];
}

export interface ReportRecommendation {
  title: string;
  description: string | null;
  priority: string;
  status: string;
  deadline: string | null;
}

export interface ReportTreatment {
  method: string;
  targetPest: string | null;
  areaTreated: string | null;
  appliedAt: string;
  safetyInstructions: string | null;
  products: { productName: string; quantity: number; unit: string; applicationMethod: string | null }[];
}

export interface ReportSignature {
  signerType: string;
  signerName: string;
  signedAt: string;
  imagePath: string;
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
  findings: ReportFinding[];
  recommendations: ReportRecommendation[];
  treatments: ReportTreatment[];
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

        {data.siteMapPanels.map((panel, pi) => {
          const grid = gridLines();
          return (
            <View style={styles.section} key={`site-map-${pi}`} wrap={false}>
              <Text style={styles.sectionTitle}>{panel.title}</Text>
              <View style={styles.siteMapBox}>
                {panel.imagePath ? <Image src={panel.imagePath} style={styles.siteMapImage} /> : null}
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
                </Svg>
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
              <View key={ii} style={styles.checklistRow}>
                <Text style={styles.checklistPrompt}>{item.prompt}</Text>
                <Text style={checklistStatusStyle(item.status)}>{item.status.replace(/_/g, " ")}</Text>
                {item.notes ? <Text style={styles.cardMeta}>{item.notes}</Text> : null}
              </View>
            ))}
          </View>
        ))}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Findings ({data.findings.length})</Text>
          {data.findings.length === 0 ? <Text style={styles.cardBody}>No findings recorded.</Text> : null}
          {data.findings.map((f, i) => (
            <View key={i} style={styles.card} wrap={false}>
              <View style={styles.cardHeaderRow}>
                <Text style={styles.cardTitle}>
                  {f.areaLocation}
                  {f.locationDetail ? ` — ${f.locationDetail}` : ""}
                </Text>
                <Text style={severityStyle(f.severity)}>{f.severity}</Text>
              </View>
              {f.pestTypeName ? <Text style={styles.cardMeta}>Pest: {f.pestTypeName}</Text> : null}
              {f.evidenceTypes.length > 0 ? <Text style={styles.cardMeta}>Evidence: {f.evidenceTypes.join(", ")}</Text> : null}
              {f.riskFactors.length > 0 ? <Text style={styles.cardMeta}>Risk factors: {f.riskFactors.join(", ")}</Text> : null}
              {f.entryPoints.length > 0 ? <Text style={styles.cardMeta}>Entry points: {f.entryPoints.join(", ")}</Text> : null}
              {f.description ? <Text style={styles.cardBody}>{f.description}</Text> : null}
              {f.photoPaths.length > 0 ? (
                <View style={styles.photoRow}>
                  {f.photoPaths.map((p, pi) => (
                    <Image key={pi} src={p} style={styles.photo} />
                  ))}
                </View>
              ) : null}
            </View>
          ))}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Recommendations ({data.recommendations.length})</Text>
          {data.recommendations.length === 0 ? <Text style={styles.cardBody}>No recommendations.</Text> : null}
          {data.recommendations.map((r, i) => (
            <View key={i} style={styles.card} wrap={false}>
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

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Treatments ({data.treatments.length})</Text>
          {data.treatments.length === 0 ? <Text style={styles.cardBody}>No treatments applied.</Text> : null}
          {data.treatments.map((t, i) => (
            <View key={i} style={styles.card} wrap={false}>
              <Text style={styles.cardTitle}>{t.method}</Text>
              <Text style={styles.cardMeta}>
                {t.targetPest ? `Target: ${t.targetPest} · ` : ""}
                {t.areaTreated ? `Area: ${t.areaTreated} · ` : ""}
                Applied {new Date(t.appliedAt).toLocaleDateString()}
              </Text>
              {t.safetyInstructions ? <Text style={styles.cardBody}>Safety: {t.safetyInstructions}</Text> : null}
              {t.products.map((p, pi) => (
                <Text key={pi} style={styles.productLine}>
                  • {p.productName} — {p.quantity} {p.unit}
                  {p.applicationMethod ? ` (${p.applicationMethod})` : ""}
                </Text>
              ))}
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
                <Image src={s.imagePath} style={styles.signatureImage} />
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

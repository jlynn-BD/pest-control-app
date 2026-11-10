import { renderToBuffer } from "@react-pdf/renderer";
import React from "react";
import { CHECKLIST_CATEGORY_DISPLAY_ORDER, CHECKLIST_CATEGORY_LABEL, carriedIssueItemIds, fitView, parseCarriedIssues, getSiteMapLevelRank, levelPoints, parseRawSketch, resolveGrid, visibleSketch } from "@pest-app/shared";
import { generateId } from "../../lib/id";
import { prisma } from "../../lib/prisma";
import { storage } from "../../lib/storage";
import { HttpError } from "../../middleware/error-handler";
import { InspectionReportDocument, ReportData, ReportImage, ReportSiteMapAnnotation, ReportSiteMapLabel, ReportSiteMapLine } from "./pdfTemplate";

const MEDIA_PREFIX = "/api/media/file/";

// Loads a stored image for the PDF. A file that's gone (or can't be read as
// PNG/JPEG) is skipped instead of failing the whole report.
async function loadReportImage(fileUrl: string): Promise<ReportImage | null> {
  const key = fileUrl.startsWith(MEDIA_PREFIX) ? fileUrl.slice(MEDIA_PREFIX.length) : fileUrl;
  const file = await storage.read(key);
  if (!file) return null;
  const isPng = file.data.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const isJpg = file.data.subarray(0, 2).equals(Buffer.from([0xff, 0xd8]));
  if (!isPng && !isJpg) return null;
  return { data: file.data, format: isPng ? "png" : "jpg" };
}

function toReportRecommendation(r: { title: string; description: string | null; priority: string; status: string; deadline: Date | null }) {
  return {
    title: r.title,
    description: r.description,
    priority: r.priority,
    status: r.status,
    deadline: r.deadline?.toISOString() ?? null,
  };
}

export async function buildReportData(inspectionId: string): Promise<ReportData> {
  const inspection = await prisma.inspection.findFirst({
    where: { id: inspectionId, deletedAt: null },
    include: {
      property: true,
      customer: true,
      technician: true,
      findings: { where: { deletedAt: null }, include: { photos: true } },
      recommendations: { where: { deletedAt: null } },
      signatures: true,
      followUpsFrom: { orderBy: { createdAt: "desc" }, take: 1 },
      checklistResponses: {
        where: { deletedAt: null },
        include: { templateItem: { include: { section: true } }, photos: { orderBy: { sortOrder: "asc" } } },
      },
      sectionSkips: { include: { technician: true } },
      photos: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!inspection) throw new HttpError(404, "Inspection not found");

  // Follow-up inspection: what the earlier inspection found, to say which issues remain.
  const carried = parseCarriedIssues(inspection.carriedIssues);
  const carriedItemIds = new Set(carried ? carriedIssueItemIds(carried) : []);
  const resolvedList: string[] = [];
  let stillPresent = 0;
  const checklistByCategory = new Map<string, { prompt: string; status: string; notes: string | null; photoPaths: ReportImage[]; carried?: "STILL_PRESENT" | "RESOLVED" }[]>();
  for (const r of inspection.checklistResponses) {
    const category = r.templateItem.section.category;
    const items = checklistByCategory.get(category) ?? [];
    // The pictures taken on this checklist item, shown under its answer.
    const photoPaths = (await Promise.all(r.photos.map((p) => loadReportImage(p.fileUrl)))).filter((img): img is ReportImage => img !== null);
    let carriedState: "STILL_PRESENT" | "RESOLVED" | undefined;
    if (carriedItemIds.has(r.templateItemId)) {
      if (r.status === "NEEDS_ATTENTION") {
        carriedState = "STILL_PRESENT";
        stillPresent += 1;
      } else if (r.status === "SATISFACTORY") {
        carriedState = "RESOLVED";
        resolvedList.push(r.templateItem.prompt);
      }
    }
    items.push({ prompt: r.templateItem.prompt, status: r.status, notes: r.notes, photoPaths, ...(carriedState ? { carried: carriedState } : {}) });
    checklistByCategory.set(category, items);
  }
  const checklistSections = CHECKLIST_CATEGORY_DISPLAY_ORDER.filter((c) => checklistByCategory.has(c)).map((category) => ({
    category,
    items: checklistByCategory.get(category)!,
  }));

  const placedFindings = inspection.findings.filter(
    (f) => f.floorPlanX != null && f.floorPlanY != null && f.siteMapArrowStartX != null && f.siteMapArrowStartY != null
  );
  const toArrow = (f: (typeof placedFindings)[number]) => ({
    startX: f.siteMapArrowStartX!,
    startY: f.siteMapArrowStartY!,
    endX: f.floorPlanX!,
    endY: f.floorPlanY!,
    label: f.areaLocation,
    severity: f.severity,
  });

  // Photo mode (one flat uploaded image) and grid/sketch mode (technician-
  // drawn, split into levels since a flat drawing can't show a multi-story
  // structure) are mutually exclusive per property - see SiteMapScreen.
  let siteMapPanels: ReportData["siteMapPanels"] = [];
  if (inspection.property.siteMapImageUrl) {
    siteMapPanels = [
      {
        title: "Site Map",
        imagePath: await loadReportImage(inspection.property.siteMapImageUrl),
        lines: [],
        labels: [],
        annotations: [],
        arrows: placedFindings.map(toArrow),
      },
    ];
  } else if (inspection.property.siteMapSketch) {
    // parseRawSketch tolerates old/malformed JSON (renders no map rather than
    // failing the report); visibleSketch drops deleted-element tombstones.
    const sketch = visibleSketch(parseRawSketch(inspection.property.siteMapSketch));
    siteMapPanels = [...sketch.levels]
      .sort((a, b) => {
        const rankDiff = getSiteMapLevelRank(a.name) - getSiteMapLevelRank(b.name);
        return rankDiff !== 0 ? rankDiff : a.sortOrder - b.sortOrder;
      })
      .map((level) => {
        const arrows = placedFindings.filter((f) => f.siteMapLevel === level.id).map(toArrow);
        return {
          title: `Site Map — ${level.name}`,
          imagePath: null,
          lines: level.lines as ReportSiteMapLine[],
          labels: level.labels as ReportSiteMapLabel[],
          // Sketches saved before annotations existed just have none.
          annotations: (level.annotations ?? []) as ReportSiteMapAnnotation[],
          grid: resolveGrid(level.grid),
          // The sheet has no edge: show everything drawn, even past the original square.
          view: fitView([...levelPoints(level), ...arrows.flatMap((a) => [{ x: a.startX, y: a.startY }, { x: a.endX, y: a.endY }])]),
          arrows,
        };
      })
      .filter((panel) => panel.lines.length > 0 || panel.labels.length > 0 || panel.annotations.length > 0 || panel.arrows.length > 0);
  }

  const standaloneStill = new Set((carried?.standalone ?? []).map((x) => x.newFindingId).filter((id): id is string => Boolean(id)));
  const stillItemResponseIds = new Set(
    inspection.checklistResponses.filter((r) => carriedItemIds.has(r.templateItemId) && r.status === "NEEDS_ATTENTION").map((r) => r.id)
  );
  const isCarriedFinding = (f: { id: string; checklistResponseId: string | null }) =>
    standaloneStill.has(f.id) || (f.checklistResponseId !== null && stillItemResponseIds.has(f.checklistResponseId));
  for (const x of carried?.standalone ?? []) {
    if (x.decision === "STILL_PRESENT") stillPresent += 1;
    else if (x.decision === "RESOLVED") resolvedList.push(`${x.areaLocation}${x.description ? ` - ${x.description}` : ""}`);
  }

  const report: ReportData = {
    inspectionId: inspection.id,
    customerName: inspection.customer.name,
    propertyAddress: `${inspection.property.addressLine1}, ${inspection.property.city}, ${inspection.property.state} ${inspection.property.postalCode}`,
    technicianName: `${inspection.technician.firstName} ${inspection.technician.lastName}`,
    status: inspection.status,
    startedAt: inspection.startedAt?.toISOString() ?? null,
    completedAt: inspection.completedAt?.toISOString() ?? null,
    generalNotes: inspection.generalNotes,
    generatedAt: new Date().toISOString(),
    followUpDate: inspection.followUpsFrom[0]?.scheduledDate?.toISOString() ?? null,
    siteMapPanels,
    propertyPhotos: (await Promise.all(inspection.photos.map((p) => loadReportImage(p.fileUrl)))).filter((img): img is ReportImage => img !== null),
    checklistSections,
    skippedSections: inspection.sectionSkips.map((s) => ({
      category: s.category,
      technicianName: `${s.technician.firstName} ${s.technician.lastName}`,
      initials: s.initials,
      confirmedAt: s.confirmedAt.toISOString(),
    })),
    findings: await Promise.all(inspection.findings.map(async (f) => {
      const rec = inspection.recommendations.find((r) => r.findingId === f.id);
      return {
        areaLocation: f.areaLocation,
        locationDetail: f.locationDetail,
        severity: f.severity,
        description: f.description,
        photoPaths: (await Promise.all(f.photos.map((p) => loadReportImage(p.fileUrl)))).filter((img): img is ReportImage => img !== null),
        recommendation: rec ? toReportRecommendation(rec) : null,
        ...(isCarriedFinding(f) ? { carried: true } : {}),
      };
    })),
    standaloneRecommendations: inspection.recommendations
      .filter((r) => !r.findingId || !inspection.findings.some((f) => f.id === r.findingId))
      .map(toReportRecommendation),
    signatures: await Promise.all(inspection.signatures.map(async (s) => ({
      signerType: s.signerType,
      signerName: s.signerName,
      signedAt: s.signedAt.toISOString(),
      imagePath: await loadReportImage(s.imageUrl),
    }))),
    gallery: [],
    previousInspection: carried ? { date: carried.sourceDate, stillPresent, resolved: resolvedList.length, resolvedList } : null,
  };

  // Number every photo in the order it appears in the report and list them for
  // the Photo Gallery at the end: tapping a thumbnail jumps to its large copy
  // there (and back) without leaving the PDF.
  const tag = (img: ReportImage, caption: string) => {
    img.id = `photo-${report.gallery.length + 1}`;
    img.caption = caption;
    report.gallery.push(img);
  };
  report.propertyPhotos.forEach((img) => tag(img, "Property photo"));
  report.checklistSections.forEach((section) =>
    section.items.forEach((item) => item.photoPaths.forEach((img) => tag(img, `${CHECKLIST_CATEGORY_LABEL[section.category] ?? section.category}: ${item.prompt}`)))
  );
  report.findings.forEach((f) => f.photoPaths.forEach((img) => tag(img, `Finding: ${f.areaLocation}${f.locationDetail ? ` — ${f.locationDetail}` : ""}`)));
  return report;
}

// Builds the PDF for a completed, signed inspection, stores it as the next
// version and records it. Used by the Generate / Regenerate button and by the
// automatic email to the customer.
export async function generateReportFor(inspectionId: string, generatedByUserId: string) {
  const inspection = await prisma.inspection.findFirst({
    where: { id: inspectionId, deletedAt: null },
    include: { signatures: true, report: true },
  });
  if (!inspection) throw new HttpError(404, "Inspection not found");
  if (inspection.status !== "COMPLETED") throw new HttpError(400, "Inspection must be completed before generating a report");
  if (inspection.signatures.length === 0) throw new HttpError(400, "At least one signature is required before generating a report");

  const data = await buildReportData(inspection.id);
  // renderToBuffer's typing wants a literal <Document> element; our
  // wrapper component always renders exactly one, so this cast is safe
  // (see the @ts-nocheck note in pdfTemplate.tsx for the underlying
  // duplicate @types/react cause).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buffer = await renderToBuffer(React.createElement(InspectionReportDocument, { data }) as any);

  const version = (inspection.report?.version ?? 0) + 1;
  const key = `reports/${inspection.id}/report-v${version}.pdf`;
  await storage.save(buffer, key);

  const reportId = inspection.report?.id ?? generateId();
  const downloadUrl = `/api/reports/${reportId}/download`;
  const report = await prisma.report.upsert({
    where: { inspectionId: inspection.id },
    create: {
      id: reportId,
      inspectionId: inspection.id,
      pdfUrl: downloadUrl,
      generatedByUserId,
      followUpDate: data.followUpDate ? new Date(data.followUpDate) : null,
      version,
    },
    update: {
      generatedAt: new Date(),
      generatedByUserId,
      followUpDate: data.followUpDate ? new Date(data.followUpDate) : null,
      version,
    },
  });
  return { report, buffer, data };
}

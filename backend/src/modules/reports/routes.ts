import { Router } from "express";
import { renderToBuffer } from "@react-pdf/renderer";
import React from "react";
import { generateId } from "../../lib/id";
import { prisma } from "../../lib/prisma";
import { storage } from "../../lib/storage";
import { asyncHandler, HttpError } from "../../middleware/error-handler";
import { requireAuth } from "../../middleware/auth";
import { InspectionReportDocument, ReportData, ReportSiteMapLabel, ReportSiteMapLine } from "./pdfTemplate";

export const reportsRouter = Router();
reportsRouter.use(requireAuth);

const MEDIA_PREFIX = "/api/media/file/";

function mediaUrlToAbsolutePath(fileUrl: string): string {
  const key = fileUrl.startsWith(MEDIA_PREFIX) ? fileUrl.slice(MEDIA_PREFIX.length) : fileUrl;
  return storage.getAbsolutePath(key);
}

async function buildReportData(inspectionId: string): Promise<ReportData> {
  const inspection = await prisma.inspection.findFirst({
    where: { id: inspectionId, deletedAt: null },
    include: {
      property: true,
      customer: true,
      technician: true,
      findings: { where: { deletedAt: null }, include: { photos: true, pestType: true } },
      recommendations: { where: { deletedAt: null } },
      treatmentRecords: { where: { deletedAt: null }, include: { products: true } },
      signatures: true,
      followUpsFrom: { orderBy: { createdAt: "desc" }, take: 1 },
      checklistResponses: {
        where: { deletedAt: null },
        include: { templateItem: { include: { section: true } } },
      },
    },
  });
  if (!inspection) throw new HttpError(404, "Inspection not found");

  const checklistByCategory = new Map<string, { prompt: string; status: string; notes: string | null }[]>();
  for (const r of inspection.checklistResponses) {
    const category = r.templateItem.section.category;
    const items = checklistByCategory.get(category) ?? [];
    items.push({ prompt: r.templateItem.prompt, status: r.status, notes: r.notes });
    checklistByCategory.set(category, items);
  }
  const CATEGORY_ORDER = ["EXTERIOR", "INTERIOR", "OTHER"];
  const checklistSections = CATEGORY_ORDER.filter((c) => checklistByCategory.has(c)).map((category) => ({
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
        imagePath: mediaUrlToAbsolutePath(inspection.property.siteMapImageUrl),
        lines: [],
        labels: [],
        arrows: placedFindings.map(toArrow),
      },
    ];
  } else if (inspection.property.siteMapSketch) {
    let sketch: { levels: { id: string; name: string; sortOrder: number; lines: unknown[]; labels: unknown[] }[] } = { levels: [] };
    try {
      const parsed = JSON.parse(inspection.property.siteMapSketch);
      // Guards against pre-levels sketch JSON (the flat { lines, labels }
      // shape this endpoint used before levels existed) - old data just
      // renders no site map rather than crashing report generation.
      if (Array.isArray(parsed?.levels)) sketch = parsed;
    } catch {
      // Malformed sketch JSON shouldn't block report generation - render without it.
    }
    siteMapPanels = [...sketch.levels]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((level) => ({
        title: `Site Map — ${level.name}`,
        imagePath: null,
        lines: level.lines as ReportSiteMapLine[],
        labels: level.labels as ReportSiteMapLabel[],
        arrows: placedFindings.filter((f) => f.siteMapLevel === level.id).map(toArrow),
      }))
      .filter((panel) => panel.lines.length > 0 || panel.labels.length > 0 || panel.arrows.length > 0);
  }

  return {
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
    checklistSections,
    findings: inspection.findings.map((f) => ({
      areaLocation: f.areaLocation,
      locationDetail: f.locationDetail,
      pestTypeName: f.pestType?.name ?? f.pestTypeOther,
      severity: f.severity,
      evidenceTypes: JSON.parse(f.evidenceTypes) as string[],
      riskFactors: JSON.parse(f.riskFactors) as string[],
      entryPoints: f.entryPoints ? (JSON.parse(f.entryPoints) as string[]) : [],
      description: f.description,
      photoPaths: f.photos.map((p) => mediaUrlToAbsolutePath(p.fileUrl)),
    })),
    recommendations: inspection.recommendations.map((r) => ({
      title: r.title,
      description: r.description,
      priority: r.priority,
      status: r.status,
      deadline: r.deadline?.toISOString() ?? null,
    })),
    treatments: inspection.treatmentRecords.map((t) => ({
      method: t.method,
      targetPest: t.targetPest,
      areaTreated: t.areaTreated,
      appliedAt: t.appliedAt.toISOString(),
      safetyInstructions: t.safetyInstructions,
      products: t.products.map((p) => ({
        productName: p.productName,
        quantity: p.quantity,
        unit: p.unit,
        applicationMethod: p.applicationMethod,
      })),
    })),
    signatures: inspection.signatures.map((s) => ({
      signerType: s.signerType,
      signerName: s.signerName,
      signedAt: s.signedAt.toISOString(),
      imagePath: mediaUrlToAbsolutePath(s.imageUrl),
    })),
  };
}

reportsRouter.post(
  "/inspections/:id/report/generate",
  asyncHandler(async (req, res) => {
    const inspection = await prisma.inspection.findFirst({
      where: { id: req.params.id, deletedAt: null },
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
        generatedByUserId: req.user!.id,
        followUpDate: data.followUpDate ? new Date(data.followUpDate) : null,
        version,
      },
      update: {
        generatedAt: new Date(),
        generatedByUserId: req.user!.id,
        followUpDate: data.followUpDate ? new Date(data.followUpDate) : null,
        version,
      },
    });

    res.status(201).json(report);
  })
);

reportsRouter.get(
  "/inspections/:id/report",
  asyncHandler(async (req, res) => {
    const report = await prisma.report.findUnique({ where: { inspectionId: req.params.id } });
    if (!report) throw new HttpError(404, "No report generated for this inspection yet");
    res.json(report);
  })
);

reportsRouter.get(
  "/reports/:id/download",
  asyncHandler(async (req, res) => {
    const report = await prisma.report.findUnique({ where: { id: req.params.id } });
    if (!report) throw new HttpError(404, "Report not found");
    const key = `reports/${report.inspectionId}/report-v${report.version}.pdf`;
    const exists = await storage.exists(key);
    if (!exists) throw new HttpError(404, "Report file not found in storage");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="inspection-report-${report.inspectionId}.pdf"`);
    res.sendFile(storage.getAbsolutePath(key));
  })
);

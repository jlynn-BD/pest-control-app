import { Router } from "express";
import { asyncHandler, HttpError } from "../../middleware/error-handler";
import { requireAuth } from "../../middleware/auth";
import { prisma } from "../../lib/prisma";
import { storage } from "../../lib/storage";
import { generateReportFor } from "./generate";
import { maybeEmailReportToCustomer } from "../../lib/customerReport";
import { maskEmail } from "../../lib/email";

export const reportsRouter = Router();
reportsRouter.use(requireAuth);

reportsRouter.post(
  "/inspections/:id/report/generate",
  asyncHandler(async (req, res) => {
    const { report } = await generateReportFor(req.params.id, req.user!.id);
    res.status(201).json(report);
  })
);

// "Email to customer": the same email that goes out automatically when both
// parties sign, sent again on request (or for the first time when the customer
// had no email address at signing).
reportsRouter.post(
  "/inspections/:id/report/email",
  asyncHandler(async (req, res) => {
    const outcome = await maybeEmailReportToCustomer(req, req.params.id, { force: true });
    if (outcome.sent) return res.json({ sent: true, to: outcome.to, maskedTo: maskEmail(outcome.to) });
    const message: Record<string, [number, string]> = {
      not_ready: [400, "The inspection must be completed and signed by both the technician and the customer first."],
      no_email: [400, "This customer has no email address on file. Add one to the customer, then try again."],
      not_configured: [503, "Email is not set up on the server yet."],
      too_soon: [429, "The report was just sent. Please wait a minute before sending it again."],
      already_sent: [409, "The report is already being sent."],
      failed: [502, "We couldn't send the email. Please try again in a moment."],
    };
    const [status, text] = message[outcome.reason];
    throw new HttpError(status, text);
  })
);

reportsRouter.get(
  "/inspections/:id/report",
  asyncHandler(async (req, res) => {
    const report = await prisma.report.findUnique({ where: { inspectionId: req.params.id } });
    if (!report) throw new HttpError(404, "No report generated for this inspection yet");
    const sent = await prisma.inspection.findUnique({ where: { id: req.params.id }, select: { reportEmailedAt: true, reportEmailedTo: true, companyCopiedAt: true } });
    res.json({ ...report, customerEmailedAt: sent?.reportEmailedAt ?? null, customerEmailedTo: sent?.reportEmailedTo ?? null, companyCopiedAt: sent?.companyCopiedAt ?? null });
  })
);

reportsRouter.get(
  "/reports/:id/download",
  asyncHandler(async (req, res) => {
    const report = await prisma.report.findUnique({ where: { id: req.params.id } });
    if (!report) throw new HttpError(404, "Report not found");
    const key = `reports/${report.inspectionId}/report-v${report.version}.pdf`;
    const file = await storage.read(key);
    if (!file) throw new HttpError(404, "Report file not found - regenerate the report");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="inspection-report-${report.inspectionId}.pdf"`);
    res.send(file.data);
  })
);

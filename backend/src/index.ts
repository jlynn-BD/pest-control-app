import "dotenv/config";
import express from "express";
import cors from "cors";
import { errorHandler, notFoundHandler } from "./middleware/error-handler";
import { authRouter } from "./modules/auth/routes";
import { usersRouter } from "./modules/users/routes";
import { customersRouter, contactsRouter } from "./modules/customers/routes";
import { propertiesRouter } from "./modules/properties/routes";
import { templatesRouter } from "./modules/templates/routes";
import { appointmentsRouter } from "./modules/appointments/routes";
import { inspectionsRouter } from "./modules/inspections/routes";
import { findingsOnInspectionRouter, findingsRouter } from "./modules/findings/routes";
import { checklistResponsesOnInspectionRouter } from "./modules/checklist/routes";
import { estimateDraftOnInspectionRouter, estimatesRouter } from "./modules/estimates/routes";
import { recommendationsOnInspectionRouter, recommendationsRouter } from "./modules/recommendations/routes";
import { treatmentsOnInspectionRouter, treatmentsRouter } from "./modules/treatments/routes";
import { signaturesOnInspectionRouter } from "./modules/signatures/routes";
import { followUpsOnInspectionRouter, followUpsRouter } from "./modules/followups/routes";
import { pestTypesRouter } from "./modules/pest-types/routes";
import { mediaRouter } from "./modules/media/routes";
import { syncRouter } from "./modules/sync/routes";
import { reportsRouter } from "./modules/reports/routes";

const app = express();

app.use(cors());
app.use(express.json({ limit: "5mb" }));

app.get("/api/health", (req, res) => res.json({ status: "ok", time: new Date().toISOString() }));

app.use("/api/auth", authRouter);
app.use("/api/users", usersRouter);
app.use("/api/customers", customersRouter);
app.use("/api/contacts", contactsRouter);
app.use("/api/properties", propertiesRouter);
app.use("/api/templates", templatesRouter);
app.use("/api/appointments", appointmentsRouter);
app.use("/api/inspections/:inspectionId/findings", findingsOnInspectionRouter);
app.use("/api/inspections/:inspectionId/checklist-responses", checklistResponsesOnInspectionRouter);
app.use("/api/inspections/:inspectionId/estimate-draft", estimateDraftOnInspectionRouter);
app.use("/api/estimates", estimatesRouter);
app.use("/api/inspections/:inspectionId/recommendations", recommendationsOnInspectionRouter);
app.use("/api/inspections/:inspectionId/treatments", treatmentsOnInspectionRouter);
app.use("/api/inspections/:inspectionId/signatures", signaturesOnInspectionRouter);
app.use("/api/inspections/:inspectionId/followups", followUpsOnInspectionRouter);
app.use("/api/inspections", inspectionsRouter);
app.use("/api", reportsRouter);
app.use("/api/findings", findingsRouter);
app.use("/api/recommendations", recommendationsRouter);
app.use("/api/treatments", treatmentsRouter);
app.use("/api/followups", followUpsRouter);
app.use("/api/pest-types", pestTypesRouter);
app.use("/api/media", mediaRouter);
app.use("/api/sync", syncRouter);

app.use(notFoundHandler);
app.use(errorHandler);

const PORT = Number(process.env.PORT) || 4000;
app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Pest control API listening on http://localhost:${PORT}`);
});

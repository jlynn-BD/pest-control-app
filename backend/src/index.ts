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
import { checklistResponsesOnInspectionRouter, checklistResponsesRouter } from "./modules/checklist/routes";
import { estimateDraftOnInspectionRouter, estimatesRouter } from "./modules/estimates/routes";
import { recommendationsOnInspectionRouter, recommendationsRouter } from "./modules/recommendations/routes";
import { signaturesOnInspectionRouter } from "./modules/signatures/routes";
import { followUpsOnInspectionRouter, followUpsRouter } from "./modules/followups/routes";
import { mediaRouter } from "./modules/media/routes";
import { syncRouter } from "./modules/sync/routes";
import { reportsRouter } from "./modules/reports/routes";

const app = express();

// Render terminates TLS in front of the API and forwards the real client
// address in X-Forwarded-For; trusting exactly one hop makes req.ip (used by
// the sign-in rate limiter and audit log) the caller, not Render's proxy.
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
  next();
});

// The API uses bearer tokens (no cookies), so CORS isn't the main defence,
// but there's no reason to answer browsers from arbitrary sites: only the
// deployed web app, local development, and native apps (which send no Origin).
const allowedOrigins = (process.env.CORS_ORIGINS || "https://pestapp-web.onrender.com").split(",").map((o) => o.trim()).filter(Boolean);
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) callback(null, true);
      else callback(null, false);
    },
  })
);
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
app.use("/api/inspections/:inspectionId/signatures", signaturesOnInspectionRouter);
app.use("/api/inspections/:inspectionId/followups", followUpsOnInspectionRouter);
app.use("/api/inspections", inspectionsRouter);
app.use("/api/findings", findingsRouter);
app.use("/api/checklist-responses", checklistResponsesRouter);
app.use("/api/recommendations", recommendationsRouter);
app.use("/api/followups", followUpsRouter);
app.use("/api/media", mediaRouter);
app.use("/api/sync", syncRouter);
// Mounted last and deliberately broad ("/api", not a specific resource
// path) since its own routes mix two prefixes (/inspections/:id/report...
// and /reports/:id/download). reportsRouter.use(requireAuth) has no path
// restriction, so it runs for every request that reaches this mount - if
// this were registered earlier in the stack (as it was until this fix), it
// would intercept and 401 requests to any path not yet claimed by a
// preceding router (e.g. a typo'd or removed route) instead of letting
// them fall through to notFoundHandler's proper 404.
app.use("/api", reportsRouter);

app.use(notFoundHandler);
app.use(errorHandler);

const PORT = Number(process.env.PORT) || 4000;
app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Pest control API listening on http://localhost:${PORT}`);
});

import type { NextFunction, Request, Response } from "express";
import { logActivity, diffRecords, snapshot, type Links } from "../lib/audit";
import { ENTITIES, buildSummary, inspectionInfo, modelFor, type EntityDef } from "../lib/auditEntities";
import { sketchChange } from "../lib/auditSketch";

// Records every successful change made through the REST API without each route
// having to remember to. A rule says which URL + method is which kind of
// action on which kind of record. For edits and deletes the record is read
// BEFORE the route runs, so the trail can show the previous value; the new
// value comes from what the route sends back. (Changes made by the app's
// offline sync go through sync/routes.ts, which records them itself.)

type Kind = "created" | "updated" | "deleted";

interface Rule {
  method: "POST" | "PATCH" | "DELETE" | "GET";
  re: RegExp;
  entity?: string;
  kind?: Kind;
  // regex group holding the record's own id (for edits/deletes)
  id?: number;
  // regex groups naming a parent the new record belongs to
  parent?: { inspectionId?: number; customerId?: number; propertyId?: number };
  // overrides the generated sentence and action name
  custom?: { action: string; summary: (label: string | undefined) => string; entity?: string };
  // special handling
  sketch?: boolean;
}

const R = (method: Rule["method"], path: string, rest: Omit<Rule, "method" | "re">): Rule => ({
  method,
  re: new RegExp(`^${path}/?$`),
  ...rest,
});

const ID = "([^/]+)";

const RULES: Rule[] = [
  // customers & contacts
  R("POST", "/customers", { entity: "Customer", kind: "created" }),
  R("PATCH", `/customers/${ID}`, { entity: "Customer", kind: "updated", id: 1 }),
  R("DELETE", `/customers/${ID}`, { entity: "Customer", kind: "deleted", id: 1 }),
  R("POST", `/customers/${ID}/contacts`, { entity: "Contact", kind: "created", parent: { customerId: 1 } }),
  R("PATCH", `/contacts/${ID}`, { entity: "Contact", kind: "updated", id: 1 }),
  R("DELETE", `/contacts/${ID}`, { entity: "Contact", kind: "deleted", id: 1 }),
  // properties & site map
  R("POST", "/properties", { entity: "Property", kind: "created" }),
  R("PATCH", `/properties/${ID}`, { entity: "Property", kind: "updated", id: 1 }),
  R("DELETE", `/properties/${ID}`, { entity: "Property", kind: "deleted", id: 1 }),
  R("POST", `/properties/${ID}/site-map`, {
    entity: "Property",
    id: 1,
    custom: { action: "property.site_plan_uploaded", summary: (l) => `uploaded a site-plan photo${l ? ` for ${l}` : ""}` },
  }),
  R("PATCH", `/properties/${ID}/site-map-sketch`, { entity: "Property", id: 1, sketch: true }),
  // appointments
  R("POST", "/appointments", { entity: "Appointment", kind: "created" }),
  R("PATCH", `/appointments/${ID}`, { entity: "Appointment", kind: "updated", id: 1 }),
  R("DELETE", `/appointments/${ID}`, { entity: "Appointment", kind: "deleted", id: 1 }),
  // inspections
  R("POST", "/inspections", { entity: "Inspection", kind: "created" }),
  R("PATCH", `/inspections/${ID}`, { entity: "Inspection", kind: "updated", id: 1 }),
  R("DELETE", `/inspections/${ID}`, { entity: "Inspection", kind: "deleted", id: 1 }),
  R("POST", `/inspections/${ID}/complete`, {
    entity: "Inspection",
    id: 1,
    custom: { action: "inspection.completed", summary: (l) => `completed the inspection${l ? `: ${l}` : ""}` },
  }),
  // findings & photos
  R("POST", `/inspections/${ID}/findings`, { entity: "Finding", kind: "created", parent: { inspectionId: 1 } }),
  R("PATCH", `/findings/${ID}`, { entity: "Finding", kind: "updated", id: 1 }),
  R("DELETE", `/findings/${ID}`, { entity: "Finding", kind: "deleted", id: 1 }),
  R("POST", `/findings/${ID}/photos`, { entity: "FindingPhoto", kind: "created" }),
  R("DELETE", `/findings/photos/${ID}`, { entity: "FindingPhoto", kind: "deleted", id: 1 }),
  // checklist
  R("POST", `/inspections/${ID}/checklist-responses`, { entity: "ChecklistResponse", kind: "created", parent: { inspectionId: 1 } }),
  R("DELETE", `/inspections/${ID}/checklist-responses/${ID}`, { entity: "ChecklistResponse", kind: "deleted", id: 2 }),
  R("POST", `/checklist-responses/${ID}/photos`, { entity: "ChecklistResponsePhoto", kind: "created" }),
  R("DELETE", `/checklist-responses/photos/${ID}`, { entity: "ChecklistResponsePhoto", kind: "deleted", id: 1 }),
  // recommendations & follow-ups
  R("POST", `/inspections/${ID}/recommendations`, { entity: "Recommendation", kind: "created", parent: { inspectionId: 1 } }),
  R("PATCH", `/recommendations/${ID}`, { entity: "Recommendation", kind: "updated", id: 1 }),
  R("DELETE", `/recommendations/${ID}`, { entity: "Recommendation", kind: "deleted", id: 1 }),
  R("POST", `/recommendations/${ID}/complete`, {
    entity: "Recommendation",
    id: 1,
    custom: { action: "recommendation.completed", summary: (l) => `marked a recommendation complete${l ? `: ${l}` : ""}` },
  }),
  R("POST", `/recommendations/${ID}/verify`, {
    entity: "Recommendation",
    id: 1,
    custom: { action: "recommendation.verified", summary: (l) => `verified a recommendation${l ? `: ${l}` : ""}` },
  }),
  R("POST", `/inspections/${ID}/followups`, { entity: "FollowUp", kind: "created", parent: { inspectionId: 1 } }),
  R("PATCH", `/followups/${ID}`, { entity: "FollowUp", kind: "updated", id: 1 }),
  // estimates
  R("POST", "/estimates", { entity: "Estimate", kind: "created" }),
  R("PATCH", `/estimates/${ID}`, { entity: "Estimate", kind: "updated", id: 1 }),
  R("DELETE", `/estimates/${ID}`, { entity: "Estimate", kind: "deleted", id: 1 }),
  R("POST", `/inspections/${ID}/estimate-draft`, { entity: "Estimate", kind: "created", parent: { inspectionId: 1 } }),
  R("GET", `/estimates/${ID}/pdf`, {
    entity: "Estimate",
    id: 1,
    custom: { action: "estimate.pdf_viewed", summary: () => "opened an estimate PDF" },
  }),
  // signatures & reports
  R("POST", `/inspections/${ID}/signatures`, { entity: "Signature", kind: "created", parent: { inspectionId: 1 } }),
  R("POST", `/inspections/${ID}/report/generate`, { entity: "Report", kind: "created", parent: { inspectionId: 1 } }),
  R("GET", `/reports/${ID}/download`, {
    entity: "Report",
    id: 1,
    custom: { action: "report.downloaded", summary: (l) => `downloaded the inspection report${l ? ` (${l})` : ""}` },
  }),
  // checklist templates
  R("POST", "/templates", { entity: "Template", kind: "created" }),
  R("PATCH", `/templates/${ID}`, { entity: "Template", kind: "updated", id: 1 }),
  R("DELETE", `/templates/${ID}`, { entity: "Template", kind: "deleted", id: 1 }),
  R("POST", `/templates/${ID}/sections`, { entity: "TemplateSection", kind: "created" }),
  R("PATCH", `/templates/sections/${ID}`, { entity: "TemplateSection", kind: "updated", id: 1 }),
  R("DELETE", `/templates/sections/${ID}`, { entity: "TemplateSection", kind: "deleted", id: 1 }),
  R("POST", `/templates/sections/${ID}/items`, { entity: "TemplateItem", kind: "created" }),
  R("PATCH", `/templates/items/${ID}`, { entity: "TemplateItem", kind: "updated", id: 1 }),
  R("DELETE", `/templates/items/${ID}`, { entity: "TemplateItem", kind: "deleted", id: 1 }),
];

type Rec = Record<string, unknown>;

function matchRule(method: string, path: string): { rule: Rule; m: RegExpMatchArray } | null {
  for (const rule of RULES) {
    if (rule.method !== method) continue;
    const m = path.match(rule.re);
    if (m) return { rule, m };
  }
  return null;
}

async function readBefore(def: EntityDef, id: string): Promise<Rec | null> {
  const model = modelFor(def);
  if (!model) return null;
  try {
    return (await model.findUnique({ where: { id } })) as Rec | null;
  } catch {
    return null;
  }
}

export function auditRequests(req: Request, res: Response, next: NextFunction) {
  if (req.method === "OPTIONS" || req.method === "HEAD") return next();
  const path = req.originalUrl.split("?")[0].replace(/^\/api/, "");
  const matched = matchRule(req.method, path);
  if (!matched || !req.headers.authorization) return next();
  const { rule, m } = matched;
  const def = rule.entity ? ENTITIES[rule.entity] : undefined;
  if (!def) return next();

  const recordId = rule.id ? m[rule.id] : undefined;

  // Capture what the route answers with (the new version of the record).
  let body: unknown;
  const originalJson = res.json.bind(res);
  res.json = (b?: unknown) => {
    body = b;
    return originalJson(b);
  };

  // Read the previous version before the route changes it.
  const needsBefore = Boolean(recordId) && (rule.kind === "updated" || rule.kind === "deleted" || rule.sketch || Boolean(rule.custom));
  const beforeReady: Promise<Rec | null> = needsBefore ? readBefore(def, recordId!) : Promise.resolve(null);

  beforeReady.then((before) => {
    res.on("finish", () => {
      if (res.statusCode < 200 || res.statusCode >= 300 || !req.user) return;
      record(req, rule, m, def, before, body).catch((err) => console.error("AUDIT CAPTURE FAILED", err));
    });
    next();
  });
}

async function record(req: Request, rule: Rule, m: RegExpMatchArray, def: EntityDef, before: Rec | null, body: unknown) {
  const after: Rec | null = body && typeof body === "object" && !Array.isArray(body) && "id" in (body as Rec) ? (body as Rec) : null;
  const subject = after ?? before;
  if (!subject && rule.kind !== "deleted") return;
  const id = (after?.id as string | undefined) ?? (rule.id ? m[rule.id] : undefined);

  let links: Links = subject ? await def.links(subject) : {};
  if (rule.parent?.inspectionId) {
    const inspectionId = m[rule.parent.inspectionId];
    const info = await inspectionInfo(inspectionId);
    links = { inspectionId, customerId: info?.customerId, propertyId: info?.propertyId, ...links };
  }
  if (rule.parent?.customerId) links = { ...links, customerId: links.customerId ?? m[rule.parent.customerId] };
  const label = subject ? await def.label(subject) : undefined;

  // The site map is one JSON document; describe what changed inside it.
  if (rule.sketch) {
    const change = sketchChange(before?.siteMapSketch, after?.siteMapSketch);
    if (!change) return; // nothing actually changed (e.g. a re-sent copy)
    await logActivity(req, {
      action: "property.site_map_edited",
      entityType: "Property",
      entityId: id,
      label,
      summary: `${change.summary}${label ? ` for ${label}` : ""}`,
      links,
      details: { sketch: change.details },
    });
    return;
  }

  if (rule.custom) {
    await logActivity(req, {
      action: rule.custom.action,
      entityType: rule.custom.entity ?? def.type,
      entityId: id,
      label,
      summary: rule.custom.summary(label),
      links,
    });
    return;
  }

  const kind = rule.kind!;
  let details: Rec | null = null;
  let changes: ReturnType<typeof diffRecords> | undefined;

  if (kind === "created") {
    details = { after: snapshot(after, def.ignore) };
  } else if (kind === "deleted") {
    details = { before: snapshot(before, def.ignore) };
  } else {
    changes = diffRecords(before, after, def.ignore);
    if (Object.keys(changes).length === 0) return; // saved with no real change
    details = { changes };
  }

  await logActivity(req, {
    action: `${def.type.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase()}.${kind}`,
    entityType: def.type,
    entityId: id,
    label,
    summary: buildSummary(def, kind, label, changes),
    links,
    details,
  });
}

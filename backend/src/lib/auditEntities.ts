import { prisma } from "./prisma";
import type { Links } from "./audit";

// How each kind of record is named in the trail: which table it lives in (to
// read the "before" version), what to call it, and which inspection / customer
// / property it belongs to (so the trail can be filtered by any of them).

type Rec = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const clip = (v: string, n = 80): string => (v.length > n ? `${v.slice(0, n)}…` : v);

export interface EntityDef {
  type: string;
  article: string; // "a" / "an"
  noun: string;
  // prisma delegate name used to read the record before it changes
  model?: string;
  createVerb?: string;
  // fields not worth listing as edits
  ignore?: string[];
  label: (rec: Rec) => Promise<string | undefined> | string | undefined;
  links: (rec: Rec) => Promise<Links> | Links;
}

// Short-lived cache: the name of an inspection ("Jordan Miles - 482 Maple
// Street") is looked up for nearly every entry about it.
const inspectionCache = new Map<string, { at: number; value: { label: string; customerId: string; propertyId: string } | null }>();

export async function inspectionInfo(id: string): Promise<{ label: string; customerId: string; propertyId: string } | null> {
  const hit = inspectionCache.get(id);
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.value;
  const insp = await prisma.inspection.findUnique({
    where: { id },
    select: { customerId: true, propertyId: true, customer: { select: { name: true } }, property: { select: { addressLine1: true, city: true } } },
  });
  const value = insp
    ? {
        label: [insp.customer?.name, insp.property?.addressLine1].filter(Boolean).join(" - ") || "Inspection",
        customerId: insp.customerId,
        propertyId: insp.propertyId,
      }
    : null;
  inspectionCache.set(id, { at: Date.now(), value });
  if (inspectionCache.size > 500) inspectionCache.delete(inspectionCache.keys().next().value as string);
  return value;
}

async function inspectionLinks(inspectionId: unknown): Promise<Links> {
  if (typeof inspectionId !== "string") return {};
  const info = await inspectionInfo(inspectionId);
  return { inspectionId, customerId: info?.customerId, propertyId: info?.propertyId };
}

async function promptOf(templateItemId: unknown): Promise<string | undefined> {
  if (typeof templateItemId !== "string") return undefined;
  const item = await prisma.templateItem.findUnique({ where: { id: templateItemId }, select: { prompt: true } });
  return item ? clip(item.prompt, 100) : undefined;
}

export const ENTITIES: Record<string, EntityDef> = {
  Customer: {
    type: "Customer",
    article: "a",
    noun: "customer",
    model: "customer",
    label: (r) => str(r.name) || undefined,
    links: (r) => ({ customerId: str(r.id) }),
  },
  Contact: {
    type: "Contact",
    article: "a",
    noun: "customer contact",
    model: "contact",
    label: (r) => [str(r.firstName), str(r.lastName)].filter(Boolean).join(" ") || undefined,
    links: (r) => ({ customerId: str(r.customerId) }),
  },
  Property: {
    type: "Property",
    article: "a",
    noun: "property",
    model: "property",
    ignore: ["siteMapSketch", "siteMapUpdatedAt", "siteMapImageUrl"],
    label: (r) => [str(r.addressLine1), str(r.city)].filter(Boolean).join(", ") || undefined,
    links: (r) => ({ propertyId: str(r.id), customerId: str(r.customerId) }),
  },
  Appointment: {
    type: "Appointment",
    article: "an",
    noun: "appointment",
    model: "appointment",
    label: (r) => (r.scheduledStart ? `${new Date(r.scheduledStart as string | Date).toISOString().slice(0, 16).replace("T", " ")} UTC` : undefined),
    links: (r) => ({ propertyId: str(r.propertyId), customerId: str(r.customerId), inspectionId: str(r.inspectionId) || undefined }),
  },
  Inspection: {
    type: "Inspection",
    article: "an",
    noun: "inspection",
    model: "inspection",
    createVerb: "created",
    label: async (r) => (await inspectionInfo(str(r.id)))?.label,
    links: (r) => inspectionLinks(r.id),
  },
  Finding: {
    type: "Finding",
    article: "a",
    noun: "finding",
    model: "finding",
    label: (r) => [str(r.areaLocation), clip(str(r.description), 60)].filter(Boolean).join(" - ") || undefined,
    links: (r) => inspectionLinks(r.inspectionId),
  },
  Recommendation: {
    type: "Recommendation",
    article: "a",
    noun: "recommendation",
    model: "recommendation",
    label: (r) => clip(str(r.title)) || undefined,
    links: (r) => inspectionLinks(r.inspectionId),
  },
  ChecklistResponse: {
    type: "ChecklistResponse",
    article: "a",
    noun: "checklist answer",
    model: "checklistResponse",
    label: (r) => promptOf(r.templateItemId),
    links: (r) => inspectionLinks(r.inspectionId),
  },
  InspectionSectionSkip: {
    type: "InspectionSectionSkip",
    article: "a",
    noun: "\"not applicable\" sign-off",
    model: "inspectionSectionSkip",
    label: (r) => str(r.category).replace(/_/g, " ").toLowerCase() || undefined,
    links: (r) => inspectionLinks(r.inspectionId),
  },
  FindingPhoto: {
    type: "FindingPhoto",
    article: "a",
    noun: "photo",
    model: "findingPhoto",
    createVerb: "uploaded",
    label: async (r) => {
      const f = await prisma.finding.findUnique({ where: { id: str(r.findingId) }, select: { areaLocation: true } });
      return f?.areaLocation ? `on finding: ${f.areaLocation}` : undefined;
    },
    links: async (r) => {
      const f = await prisma.finding.findUnique({ where: { id: str(r.findingId) }, select: { inspectionId: true } });
      return inspectionLinks(f?.inspectionId);
    },
  },
  ChecklistResponsePhoto: {
    type: "ChecklistResponsePhoto",
    article: "a",
    noun: "photo",
    model: "checklistResponsePhoto",
    createVerb: "uploaded",
    label: async (r) => {
      const c = await prisma.checklistResponse.findUnique({ where: { id: str(r.checklistResponseId) }, select: { templateItemId: true } });
      const p = await promptOf(c?.templateItemId);
      return p ? `on checklist item: ${p}` : undefined;
    },
    links: async (r) => {
      const c = await prisma.checklistResponse.findUnique({ where: { id: str(r.checklistResponseId) }, select: { inspectionId: true } });
      return inspectionLinks(c?.inspectionId);
    },
  },
  Estimate: {
    type: "Estimate",
    article: "an",
    noun: "estimate",
    model: "estimate",
    label: (r) => (r.total != null ? `total ${r.total}` : undefined),
    links: async (r) => ({
      customerId: str(r.customerId),
      propertyId: str(r.propertyId),
      inspectionId: str(r.inspectionId) || undefined,
    }),
  },
  FollowUp: {
    type: "FollowUp",
    article: "a",
    noun: "follow-up",
    model: "followUp",
    label: (r) => clip(str(r.reason)) || undefined,
    links: (r) => inspectionLinks(r.inspectionId),
  },
  Signature: {
    type: "Signature",
    article: "a",
    noun: "signature",
    model: "signature",
    createVerb: "captured",
    ignore: ["imageUrl"],
    label: (r) => [str(r.signerType).toLowerCase(), str(r.signerName)].filter(Boolean).join(": ") || undefined,
    links: (r) => inspectionLinks(r.inspectionId),
  },
  Report: {
    type: "Report",
    article: "an",
    noun: "inspection report",
    model: "report",
    createVerb: "generated",
    ignore: ["pdfUrl"],
    label: (r) => (r.version ? `version ${r.version}` : undefined),
    links: (r) => inspectionLinks(r.inspectionId),
  },
  Template: {
    type: "Template",
    article: "a",
    noun: "checklist template",
    model: "inspectionTemplate",
    label: (r) => str(r.name) || undefined,
    links: () => ({}),
  },
  TemplateSection: {
    type: "TemplateSection",
    article: "a",
    noun: "template section",
    model: "templateSection",
    label: (r) => str(r.name) || undefined,
    links: () => ({}),
  },
  TemplateItem: {
    type: "TemplateItem",
    article: "a",
    noun: "template item",
    model: "templateItem",
    label: (r) => clip(str(r.prompt)) || undefined,
    links: () => ({}),
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function modelFor(def: EntityDef): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return def.model ? (prisma as any)[def.model] : null;
}

const MARKER_FIELDS = ["floorPlanX", "floorPlanY", "siteMapArrowStartX", "siteMapArrowStartY", "siteMapLevel"];

// The sentence for an entry, without the person's name: "added a finding:
// Kitchen - moisture damage".
export function buildSummary(def: EntityDef, action: "created" | "updated" | "deleted", label: string | undefined, changes?: Record<string, { from: unknown; to: unknown }>): string {
  const tail = label ? `: ${label}` : "";
  if (action === "created") return `${def.createVerb ?? "added"} ${def.article} ${def.noun}${tail}`;
  if (action === "deleted") return `deleted ${def.article} ${def.noun}${tail}`;

  const changed = Object.keys(changes ?? {});
  if (def.type === "Finding" && changed.length > 0 && changed.every((k) => MARKER_FIELDS.includes(k))) {
    return `edited a site-map marker${tail}`;
  }
  if (def.type === "Inspection" && changes?.status) {
    const to = String(changes.status.to);
    if (to === "COMPLETED") return `completed the inspection${tail}`;
    if (to === "IN_PROGRESS") return `started the inspection${tail}`;
    return `changed the inspection status to ${to.toLowerCase().replace(/_/g, " ")}${tail}`;
  }
  if (def.type === "ChecklistResponse" && changes?.status) {
    return `answered a checklist item (${String(changes.status.to).toLowerCase().replace(/_/g, " ")})${tail}`;
  }
  const fields = changed.length > 0 && changed.length <= 3 ? ` (${changed.join(", ")})` : "";
  return `updated ${def.article} ${def.noun}${fields}${tail}`;
}

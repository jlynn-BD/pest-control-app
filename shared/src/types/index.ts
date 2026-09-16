import type {
  AppointmentStatus,
  AppointmentType,
  ChecklistResponseStatus,
  CorrectiveActionStatus,
  CustomerType,
  EstimateStatus,
  FollowUpStatus,
  InspectionStatus,
  PropertyType,
  RecommendationOwnerType,
  RecommendationPriority,
  RecommendationStatus,
  Severity,
  SignerType,
  TemplateItemType,
  TemplateSectionCategory,
  UserRole,
} from "../enums";

export interface BaseEntity {
  id: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface User extends BaseEntity {
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  phone?: string | null;
  active: boolean;
}

export interface Customer extends BaseEntity {
  type: CustomerType;
  name: string;
  email?: string | null;
  phone?: string | null;
  billingAddressLine1?: string | null;
  billingAddressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
  notes?: string | null;
}

export interface Contact extends BaseEntity {
  customerId: string;
  firstName: string;
  lastName: string;
  role?: string | null;
  email?: string | null;
  phone?: string | null;
  isPrimary: boolean;
}

export interface Property extends BaseEntity {
  customerId: string;
  label?: string | null;
  addressLine1: string;
  addressLine2?: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  lat?: number | null;
  lng?: number | null;
  propertyType: PropertyType;
  squareFootage?: number | null;
  yearBuilt?: number | null;
  accessNotes?: string | null;
  notes?: string | null;
  siteMapImageUrl?: string | null;
  siteMapSketch?: string | null; // JSON-encoded SiteMapSketch, see below
  siteMapUpdatedAt?: string | null;
  // Whether this property has each conditional inspection area - set once
  // (typically from the checklist wizard's "this property doesn't have
  // this" flow) and reused on every future inspection here, so the same
  // fact isn't re-asked every visit. null = never determined yet.
  hasSecondFloor?: boolean | null;
  hasThirdFloor?: boolean | null;
  hasBasement?: boolean | null;
  hasCrawlspace?: boolean | null;
}

export interface SiteMapSketchLine {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface SiteMapSketchLabel {
  id: string;
  x: number;
  y: number;
  text: string;
}

// Lightweight, color-coded markup that isn't tied to a full Finding - "not
// every annotation needs to become a full detailed finding, sometimes the
// technician simply needs to visually identify an area" (e.g. an X marking
// termite activity, an arrow or highlighted rectangle showing where
// treatment needs to occur). x2/y2 are only used by "arrow" and "rect" (the
// two opposite corners for rect); "x" is a single point at x1/y1.
export type SiteMapAnnotationType = "x" | "arrow" | "rect";

export interface SiteMapAnnotation {
  id: string;
  type: SiteMapAnnotationType;
  color: string;
  x1: number;
  y1: number;
  x2?: number;
  y2?: number;
}

// A sketch is split into technician-defined levels (e.g. "Exterior", "1st
// Floor", "2nd Floor", "Attic") since a single flat drawing can't represent
// a multi-story structure - not every property has every level, so the
// technician adds only the ones that apply rather than filling out a fixed
// set. Only meaningful in grid/sketch mode; a property using an uploaded
// photo as its site map instead has no levels.
export interface SiteMapLevel {
  id: string;
  name: string;
  sortOrder: number;
  lines: SiteMapSketchLine[];
  labels: SiteMapSketchLabel[];
  annotations: SiteMapAnnotation[];
}

export interface SiteMapSketch {
  levels: SiteMapLevel[];
}

// Suggested level names shown to the technician when adding one - not
// exhaustive, just the common cases so most inspections don't need to type
// a custom name.
// Same order as the checklist wizard's steps (checklistWizard.ts's
// WIZARD_STEPS) - Matt wanted the house walked in one consistent sequence,
// not just enforced in the checklist itself, so the site map's level tabs
// (a separate, freely-named drawing feature) shouldn't silently disagree
// with it just because levels happen to get added in whatever order a
// technician draws them.
export const SITE_MAP_LEVEL_SUGGESTIONS = ["Exterior", "1st Floor", "2nd Floor", "3rd Floor", "Basement", "Crawlspace", "Attic"] as const;

export interface InspectionTemplate extends BaseEntity {
  name: string;
  description?: string | null;
  pestCategory?: string | null;
  active: boolean;
}

export interface TemplateSection extends BaseEntity {
  templateId: string;
  name: string;
  category: TemplateSectionCategory;
  sortOrder: number;
}

export interface TemplateItem extends BaseEntity {
  sectionId: string;
  prompt: string;
  itemType: TemplateItemType;
  sortOrder: number;
  required: boolean;
}

export interface Appointment extends BaseEntity {
  propertyId: string;
  customerId: string;
  technicianId: string;
  inspectionId?: string | null;
  type: AppointmentType;
  scheduledStart: string;
  scheduledEnd?: string | null;
  status: AppointmentStatus;
  notes?: string | null;
  createdByUserId: string;
}

export interface Inspection extends BaseEntity {
  propertyId: string;
  customerId: string;
  templateId?: string | null;
  technicianId: string;
  appointmentId?: string | null;
  status: InspectionStatus;
  scheduledAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  generalNotes?: string | null;
  weatherConditions?: string | null;
  // Legacy: JSON-encoded array of category codes a technician used to
  // opt into per inspection, before the mandatory checklist wizard (see
  // shared/src/constants/checklistWizard.ts) replaced free category
  // selection with a forced sequence + per-property applicability. No
  // longer written by current clients; left populated on old rows only.
  checklistCategories?: string | null;
}

// Evidence observed, entry points, and risk factors are described in
// `description` (free-text Notes) rather than structured fields - Matt's
// ask: a finding shouldn't revolve around identifying a pest or force
// clicking through checkbox lists. See FINDING_NOTES_GUIDANCE.
export interface Finding extends BaseEntity {
  inspectionId: string;
  areaLocation: string;
  locationDetail?: string | null;
  severity: Severity;
  description?: string | null;
  lat?: number | null;
  lng?: number | null;
  floorPlanX?: number | null;
  floorPlanY?: number | null;
  siteMapArrowStartX?: number | null;
  siteMapArrowStartY?: number | null;
  siteMapLevel?: string | null;
}

export interface FindingPhoto extends BaseEntity {
  findingId: string;
  fileUrl: string;
  caption?: string | null;
  takenAt?: string | null;
  lat?: number | null;
  lng?: number | null;
  sortOrder: number;
}

export interface Recommendation extends BaseEntity {
  inspectionId: string;
  findingId?: string | null;
  title: string;
  description?: string | null;
  priority: RecommendationPriority;
  ownerType: RecommendationOwnerType;
  ownerUserId?: string | null;
  ownerContactId?: string | null;
  deadline?: string | null;
  status: RecommendationStatus;
  completedAt?: string | null;
  verifiedAt?: string | null;
  verifiedByFollowUpId?: string | null;
}

export interface Signature extends BaseEntity {
  inspectionId: string;
  signerType: SignerType;
  signerName: string;
  signerContactId?: string | null;
  signerUserId?: string | null;
  imageUrl: string;
  signedAt: string;
}

export interface Report extends BaseEntity {
  inspectionId: string;
  pdfUrl: string;
  generatedAt: string;
  generatedByUserId: string;
  followUpDate?: string | null;
  version: number;
}

export interface FollowUp extends BaseEntity {
  inspectionId: string;
  followUpInspectionId?: string | null;
  reason?: string | null;
  scheduledDate?: string | null;
  reminderSentAt?: string | null;
  warrantyExpiresAt?: string | null;
  correctiveActionStatus: CorrectiveActionStatus;
  status: FollowUpStatus;
  notes?: string | null;
}

export interface ChecklistResponse extends BaseEntity {
  inspectionId: string;
  templateItemId: string;
  status: ChecklistResponseStatus;
  notes?: string | null;
  photos?: ChecklistResponsePhoto[];
}

export interface ChecklistResponsePhoto extends BaseEntity {
  checklistResponseId: string;
  fileUrl: string;
  caption?: string | null;
  takenAt?: string | null;
  sortOrder: number;
}

export interface Estimate extends BaseEntity {
  inspectionId?: string | null;
  customerId: string;
  propertyId: string;
  createdByUserId: string;
  status: EstimateStatus;
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  total: number;
  notes?: string | null;
  validUntil?: string | null;
}

export interface EstimateLineItem extends BaseEntity {
  estimateId: string;
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  sortOrder: number;
}

export interface SyncChange {
  entity: string;
  op: "create" | "update" | "delete";
  id: string;
  data?: Record<string, unknown>;
  updatedAt: string;
}

export interface SyncPushResultItem {
  entity: string;
  id: string;
  result: "applied" | "conflict";
  serverRow?: Record<string, unknown>;
}

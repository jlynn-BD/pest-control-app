import type {
  ApprovalStatus,
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
}

export interface SiteMapSketchLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface SiteMapSketchLabel {
  x: number;
  y: number;
  text: string;
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
}

export interface SiteMapSketch {
  levels: SiteMapLevel[];
}

// Suggested level names shown to the technician when adding one - not
// exhaustive, just the common cases so most inspections don't need to type
// a custom name.
export const SITE_MAP_LEVEL_SUGGESTIONS = ["Exterior", "1st Floor", "2nd Floor", "3rd Floor", "Attic", "Basement", "Crawlspace"] as const;

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
}

export interface PestType extends BaseEntity {
  name: string;
  category?: string | null;
  active: boolean;
}

export interface Finding extends BaseEntity {
  inspectionId: string;
  pestTypeId?: string | null;
  pestTypeOther?: string | null;
  areaLocation: string;
  locationDetail?: string | null;
  evidenceTypes: string[];
  severity: Severity;
  riskFactors: string[];
  entryPoints: string[];
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

export interface TreatmentRecord extends BaseEntity {
  inspectionId: string;
  findingId?: string | null;
  technicianId: string;
  method: string;
  targetPest?: string | null;
  areaTreated?: string | null;
  appliedAt: string;
  safetyInstructions?: string | null;
  notes?: string | null;
  approvalStatus: ApprovalStatus;
  approvedByContactId?: string | null;
  approvedAt?: string | null;
}

export interface TreatmentProduct extends BaseEntity {
  treatmentRecordId: string;
  productName: string;
  epaRegistrationNumber?: string | null;
  activeIngredient?: string | null;
  quantity: number;
  unit: string;
  concentration?: string | null;
  applicationMethod?: string | null;
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

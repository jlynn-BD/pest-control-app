// Canonical string enum values. Mirrored by hand into backend/prisma/schema.prisma
// enums and into mobile/src/db/schema.ts — keep the string values identical everywhere.

export const UserRole = {
  ADMIN: "ADMIN",
  OFFICE: "OFFICE",
  TECHNICIAN: "TECHNICIAN",
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const CustomerType = {
  RESIDENTIAL: "RESIDENTIAL",
  COMMERCIAL: "COMMERCIAL",
} as const;
export type CustomerType = (typeof CustomerType)[keyof typeof CustomerType];

export const PropertyType = {
  RESIDENTIAL_SINGLE: "RESIDENTIAL_SINGLE",
  RESIDENTIAL_MULTI: "RESIDENTIAL_MULTI",
  COMMERCIAL: "COMMERCIAL",
  INDUSTRIAL: "INDUSTRIAL",
  OTHER: "OTHER",
} as const;
export type PropertyType = (typeof PropertyType)[keyof typeof PropertyType];

export const TemplateItemType = {
  CHECKBOX: "CHECKBOX",
  TEXT: "TEXT",
  NUMBER: "NUMBER",
  PHOTO: "PHOTO",
  PEST_FINDING: "PEST_FINDING",
} as const;
export type TemplateItemType = (typeof TemplateItemType)[keyof typeof TemplateItemType];

export const AppointmentType = {
  INITIAL_INSPECTION: "INITIAL_INSPECTION",
  FOLLOWUP_INSPECTION: "FOLLOWUP_INSPECTION",
  TREATMENT: "TREATMENT",
  OTHER: "OTHER",
} as const;
export type AppointmentType = (typeof AppointmentType)[keyof typeof AppointmentType];

export const AppointmentStatus = {
  SCHEDULED: "SCHEDULED",
  CONFIRMED: "CONFIRMED",
  IN_PROGRESS: "IN_PROGRESS",
  COMPLETED: "COMPLETED",
  CANCELED: "CANCELED",
  NO_SHOW: "NO_SHOW",
} as const;
export type AppointmentStatus = (typeof AppointmentStatus)[keyof typeof AppointmentStatus];

export const InspectionStatus = {
  SCHEDULED: "SCHEDULED",
  IN_PROGRESS: "IN_PROGRESS",
  COMPLETED: "COMPLETED",
  CANCELED: "CANCELED",
} as const;
export type InspectionStatus = (typeof InspectionStatus)[keyof typeof InspectionStatus];

export const Severity = {
  LOW: "LOW",
  MEDIUM: "MEDIUM",
  HIGH: "HIGH",
  CRITICAL: "CRITICAL",
} as const;
export type Severity = (typeof Severity)[keyof typeof Severity];

export const RecommendationPriority = {
  LOW: "LOW",
  MEDIUM: "MEDIUM",
  HIGH: "HIGH",
  URGENT: "URGENT",
} as const;
export type RecommendationPriority = (typeof RecommendationPriority)[keyof typeof RecommendationPriority];

export const RecommendationOwnerType = {
  CUSTOMER: "CUSTOMER",
  TECHNICIAN: "TECHNICIAN",
  THIRD_PARTY: "THIRD_PARTY",
} as const;
export type RecommendationOwnerType = (typeof RecommendationOwnerType)[keyof typeof RecommendationOwnerType];

export const RecommendationStatus = {
  OPEN: "OPEN",
  IN_PROGRESS: "IN_PROGRESS",
  COMPLETED: "COMPLETED",
  VERIFIED: "VERIFIED",
  WONT_FIX: "WONT_FIX",
} as const;
export type RecommendationStatus = (typeof RecommendationStatus)[keyof typeof RecommendationStatus];

export const ApprovalStatus = {
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  DECLINED: "DECLINED",
} as const;
export type ApprovalStatus = (typeof ApprovalStatus)[keyof typeof ApprovalStatus];

export const SignerType = {
  CUSTOMER: "CUSTOMER",
  TECHNICIAN: "TECHNICIAN",
} as const;
export type SignerType = (typeof SignerType)[keyof typeof SignerType];

export const CorrectiveActionStatus = {
  PENDING: "PENDING",
  VERIFIED: "VERIFIED",
  FAILED: "FAILED",
  NOT_APPLICABLE: "NOT_APPLICABLE",
} as const;
export type CorrectiveActionStatus = (typeof CorrectiveActionStatus)[keyof typeof CorrectiveActionStatus];

export const FollowUpStatus = {
  SCHEDULED: "SCHEDULED",
  COMPLETED: "COMPLETED",
  CANCELED: "CANCELED",
} as const;
export type FollowUpStatus = (typeof FollowUpStatus)[keyof typeof FollowUpStatus];

export const DeviceType = {
  TRAP: "TRAP",
  BAIT_STATION: "BAIT_STATION",
  SENSOR: "SENSOR",
} as const;
export type DeviceType = (typeof DeviceType)[keyof typeof DeviceType];

export const DeviceStatus = {
  ACTIVE: "ACTIVE",
  INACTIVE: "INACTIVE",
  REMOVED: "REMOVED",
} as const;
export type DeviceStatus = (typeof DeviceStatus)[keyof typeof DeviceStatus];

export const TemplateSectionCategory = {
  EXTERIOR: "EXTERIOR",
  INTERIOR: "INTERIOR",
  ATTIC: "ATTIC",
  CRAWLSPACE: "CRAWLSPACE",
  OTHER: "OTHER",
} as const;
export type TemplateSectionCategory = (typeof TemplateSectionCategory)[keyof typeof TemplateSectionCategory];

export const ChecklistResponseStatus = {
  SATISFACTORY: "SATISFACTORY",
  NEEDS_ATTENTION: "NEEDS_ATTENTION",
  NOT_APPLICABLE: "NOT_APPLICABLE",
} as const;
export type ChecklistResponseStatus = (typeof ChecklistResponseStatus)[keyof typeof ChecklistResponseStatus];

export const EstimateStatus = {
  DRAFT: "DRAFT",
  SENT: "SENT",
  APPROVED: "APPROVED",
  DECLINED: "DECLINED",
  EXPIRED: "EXPIRED",
} as const;
export type EstimateStatus = (typeof EstimateStatus)[keyof typeof EstimateStatus];

export const SyncOp = {
  CREATE: "create",
  UPDATE: "update",
  DELETE: "delete",
} as const;
export type SyncOp = (typeof SyncOp)[keyof typeof SyncOp];

export const SyncEntity = {
  Customer: "Customer",
  Contact: "Contact",
  Property: "Property",
  Inspection: "Inspection",
  Finding: "Finding",
  FindingPhoto: "FindingPhoto",
  Recommendation: "Recommendation",
  TreatmentRecord: "TreatmentRecord",
  TreatmentProduct: "TreatmentProduct",
  Signature: "Signature",
  FollowUp: "FollowUp",
  ChecklistResponse: "ChecklistResponse",
} as const;
export type SyncEntity = (typeof SyncEntity)[keyof typeof SyncEntity];

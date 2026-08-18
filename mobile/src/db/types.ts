export interface LocalCustomer {
  id: string;
  name: string;
  type: string;
  phone: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
}

export interface LocalProperty {
  id: string;
  customerId: string;
  label: string | null;
  addressLine1: string;
  city: string;
  state: string;
  postalCode: string;
  propertyType: string;
  accessNotes: string | null;
  siteMapImageUrl: string | null;
  siteMapLocalUri: string | null;
  siteMapSketchJson: string | null;
  siteMapUpdatedAt: string | null;
}

export interface LocalTemplate {
  id: string;
  name: string;
  description: string | null;
}

export interface LocalTemplateSection {
  id: string;
  templateId: string;
  name: string;
  category: string;
  sortOrder: number;
}

export interface LocalTemplateItem {
  id: string;
  sectionId: string;
  prompt: string;
  itemType: string;
  sortOrder: number;
  required: number;
}

export interface LocalPestType {
  id: string;
  name: string;
  category: string | null;
}

export interface LocalInspection {
  id: string;
  propertyId: string;
  customerId: string;
  templateId: string | null;
  technicianId: string;
  status: string;
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  generalNotes: string | null;
  weatherConditions: string | null;
  createdAt: string;
  updatedAt: string;
  syncStatus: "pending" | "synced";
}

export interface LocalFinding {
  id: string;
  inspectionId: string;
  pestTypeId: string | null;
  pestTypeOther: string | null;
  areaLocation: string;
  locationDetail: string | null;
  evidenceTypes: string; // JSON string[]
  severity: string;
  riskFactors: string; // JSON string[]
  entryPoints: string; // JSON string[]
  description: string | null;
  lat: number | null;
  lng: number | null;
  floorPlanX: number | null;
  floorPlanY: number | null;
  siteMapArrowStartX: number | null;
  siteMapArrowStartY: number | null;
  createdAt: string;
  updatedAt: string;
  syncStatus: "pending" | "synced";
}

export interface LocalFindingPhoto {
  id: string;
  findingId: string;
  localUri: string;
  remoteUrl: string | null;
  caption: string | null;
  takenAt: string | null;
  lat: number | null;
  lng: number | null;
  sortOrder: number;
  syncStatus: "pending" | "synced";
}

export interface LocalRecommendation {
  id: string;
  inspectionId: string;
  findingId: string | null;
  title: string;
  description: string | null;
  priority: string;
  ownerType: string;
  deadline: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  syncStatus: "pending" | "synced";
}

export interface LocalTreatmentRecord {
  id: string;
  inspectionId: string;
  findingId: string | null;
  technicianId: string;
  method: string;
  targetPest: string | null;
  areaTreated: string | null;
  appliedAt: string;
  safetyInstructions: string | null;
  notes: string | null;
  approvalStatus: string;
  createdAt: string;
  updatedAt: string;
  syncStatus: "pending" | "synced";
}

export interface LocalTreatmentProduct {
  id: string;
  treatmentRecordId: string;
  productName: string;
  epaRegistrationNumber: string | null;
  activeIngredient: string | null;
  quantity: number;
  unit: string;
  concentration: string | null;
  applicationMethod: string | null;
}

export interface LocalSignature {
  id: string;
  inspectionId: string;
  signerType: string;
  signerName: string;
  imageBase64: string;
  remoteUrl: string | null;
  signedAt: string;
  syncStatus: "pending" | "synced";
}

export interface LocalChecklistResponse {
  id: string;
  inspectionId: string;
  templateItemId: string;
  status: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  syncStatus: "pending" | "synced";
}

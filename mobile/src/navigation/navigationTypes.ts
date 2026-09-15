export type CustomersStackParamList = {
  CustomerList: undefined;
  CustomerDetail: { customerId: string };
  CustomerForm: undefined;
  PropertyDetail: { propertyId: string };
  PropertyForm: { customerId: string };
  EstimateList: { customerId: string };
  EstimateDetail: { estimateId: string };
  EstimateForm: { estimateId: string };
};

export type InspectionsStackParamList = {
  InspectionList: undefined;
  InspectionDetail: { inspectionId: string };
  LocalInspectionDetail: { inspectionId: string };
  NewInspection: undefined;
  InspectionWorkspace: { inspectionId: string };
  // The mandatory checklist wizard - Exterior -> First Floor -> Second Floor
  // (if applicable) -> Third Floor (if applicable) -> Basement (if
  // applicable) -> Crawl Space (if applicable) -> Attic, in that fixed
  // order (see shared/src/constants/checklistWizard.ts). Distinct from
  // Checklist below, which is a flat multi-category review of everything
  // already unlocked, not a step-by-step flow.
  InspectionWizard: { inspectionId: string };
  Checklist: { inspectionId: string };
  // fromChecklistResponseId: arriving here to place a marker for a checklist
  // item that's already been answered - see ChecklistScreen's "Add to Site
  // Map" action. Puts the screen straight into arrow-drawing mode instead
  // of requiring a separate "+Marker" tap.
  SiteMap: { inspectionId: string; fromChecklistResponseId?: string };
  FindingForm: {
    inspectionId: string;
    arrowStartX?: number;
    arrowStartY?: number;
    arrowEndX?: number;
    arrowEndY?: number;
    arrowLevel?: string;
    // Pre-fills area/description/photos from an already-answered checklist
    // item instead of making the technician retype what's already known -
    // see SiteMapScreen/ChecklistScreen.
    fromChecklistResponseId?: string;
    // Editing an existing finding (from the site map's marker detail card,
    // or the workspace Findings list) instead of creating a new one - loads
    // and pre-fills every field from this finding, and Save updates it in
    // place rather than inserting a second row.
    editingFindingId?: string;
  };
  RecommendationForm: { inspectionId: string };
  TreatmentForm: { inspectionId: string };
  SignatureCapture: { inspectionId: string; signerType: "CUSTOMER" | "TECHNICIAN" };
  EstimateDetail: { estimateId: string };
  EstimateForm: { estimateId: string };
};

export type ScheduleStackParamList = {
  Schedule: undefined;
};

export type SettingsStackParamList = {
  Settings: undefined;
};

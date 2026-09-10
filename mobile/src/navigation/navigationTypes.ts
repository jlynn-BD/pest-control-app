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
  };
  RecommendationForm: { inspectionId: string };
  TreatmentForm: { inspectionId: string };
  SignatureCapture: { inspectionId: string; signerType: "CUSTOMER" | "TECHNICIAN" };
  ScheduleFollowUp: { inspectionId: string };
  EstimateDetail: { estimateId: string };
  EstimateForm: { estimateId: string };
};

export type ScheduleStackParamList = {
  Schedule: undefined;
};

export type FollowUpsStackParamList = {
  FollowUpList: undefined;
  FollowUpDetail: { followUpId: string };
};

export type SettingsStackParamList = {
  Settings: undefined;
};

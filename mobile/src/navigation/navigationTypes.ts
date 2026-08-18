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
  SiteMap: { inspectionId: string };
  FindingForm: {
    inspectionId: string;
    arrowStartX?: number;
    arrowStartY?: number;
    arrowEndX?: number;
    arrowEndY?: number;
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
